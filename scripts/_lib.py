"""
Shared orchestration for batch TTS scripts.

Each TTS script defines its own `fetch_chunk` (async) and `split_chunks` (sync),
then calls `run_batch(args, fetch_chunk, split_chunks)`. Everything else —
file collection, semaphore, retries, progress, ffmpeg concat, resume — lives
here so the API-specific files only contain the API call.

Concurrency model:
  files-per-batch (B)  : how many files processed together
  connections-per-file : how many simultaneous requests within each file
  total connections    : B × connections-per-file (must stay below API ceiling)

Files in a batch progress at the same rate (each gets its own semaphore) so
they finish together. Batches run sequentially until all files are done.
"""
import argparse
import asyncio
import glob
import os
import re
import shutil
import subprocess
import sys
import time

LETTER_RE = re.compile(r"\w", re.UNICODE)


class Stats:
    def __init__(self, total_files):
        self.total_files = total_files
        self.files_done = 0
        self.files_failed = 0
        self.files_skipped = 0
        self.chunks_done = 0
        self.chunks_total = 0
        self.start_time = time.time()
        self.failure_log = None


def emit_progress(file_base, status, chunks_done, chunks_total):
    """Emit a structured progress line that the UI parses."""
    print(f"PROG\t{file_base}\t{status}\t{chunks_done}\t{chunks_total}", flush=True)


def split_lines(text, lines_per_chunk):
    """Group N non-empty lines per chunk; merge any chunk with no synthesizable
    letters (e.g. only '…' or '—') into the previous one."""
    if lines_per_chunk <= 0:
        return [text]
    out, buf, nonempty = [], [], 0
    for line in text.split("\n"):
        buf.append(line)
        if line.strip():
            nonempty += 1
        if nonempty >= lines_per_chunk:
            out.append("\n".join(buf).strip())
            buf, nonempty = [], 0
    if buf:
        tail = "\n".join(buf).strip()
        if tail:
            if out and len(tail) < 200:
                out[-1] += "\n" + tail
            else:
                out.append(tail)
    merged = []
    for chunk in out:
        if LETTER_RE.search(chunk):
            merged.append(chunk)
        elif merged:
            merged[-1] += "\n" + chunk
    return merged


def _split_long_line(line, max_chars):
    """Split a single oversize line at the best boundary inside the limit:
    sentence punctuation > comma > space. Never mid-word unless the line has
    no boundary at all. Returns a list of chunks."""
    out = []
    while len(line) > max_chars:
        # Sentence-ending punctuation closest to but ≤ max_chars
        candidates = []
        for ch in ("。", "?", "!", "ฯ", "๛", "?", "!", "."):
            idx = line.rfind(ch, 0, max_chars + 1)
            if idx > 0:
                candidates.append(idx + 1)  # cut after the punctuation
        # Commas / colons / semicolons / dashes
        for ch in (",", ":", ";", "—", "…"):
            idx = line.rfind(ch, 0, max_chars + 1)
            if idx > 0:
                candidates.append(idx + 1)
        # Spaces (Thai uses these as phrase separators)
        sp = line.rfind(" ", 0, max_chars + 1)
        if sp > 0:
            candidates.append(sp)
        # Pick the latest cut that's at least 40% into max_chars (avoid tiny chunks)
        valid = [c for c in candidates if c >= max_chars * 0.4]
        if valid:
            cut = max(valid)
        else:
            # No good boundary — hard cut at max_chars (rare for normal Thai)
            cut = max_chars
        out.append(line[:cut].strip())
        line = line[cut:].lstrip()
    if line.strip():
        out.append(line.strip())
    return out


def split_chars(text, max_chars):
    """Line-first splitting: each input line becomes its own chunk; lines
    longer than `max_chars` are split at sentence/punctuation/space boundaries.
    Never splits mid-word for normal Thai text."""
    text = re.sub(r"[\"`]", "'", text)
    chunks = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        if len(line) <= max_chars:
            chunks.append(line)
        else:
            chunks.extend(_split_long_line(line, max_chars))
    return [c for c in chunks if LETTER_RE.search(c)]


def collect_files(patterns):
    files = []
    for pattern in patterns:
        matches = sorted(glob.glob(pattern))
        if matches:
            files.extend(matches)
        elif os.path.isfile(pattern):
            files.append(pattern)
    return list(dict.fromkeys(files))


def ffmpeg_concat(chunk_paths, list_path, output_path, fmt, tempo=1.0):
    with open(list_path, "w", encoding="utf-8") as f:
        for path in chunk_paths:
            f.write(f"file '{os.path.abspath(path).replace(chr(92), '/')}'\n")
    base_cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-f", "concat", "-safe", "0", "-i", list_path]
    needs_atempo = abs(tempo - 1.0) >= 0.001
    if fmt == "mp3" and not needs_atempo:
        cmd = base_cmd + ["-c", "copy", output_path]
    else:
        codec = ["-c:a", "aac", "-b:a", "128k"] if fmt == "m4a" else ["-c:a", "libmp3lame", "-b:a", "128k"]
        atempo = ["-filter:a", f"atempo={tempo}"] if needs_atempo else []
        cmd = base_cmd + atempo + codec + [output_path]
    return subprocess.run(cmd).returncode == 0


async def fetch_with_retry(text, output_path, fetch_fn, args):
    last_err = None
    for attempt in range(args.retries):
        try:
            await fetch_fn(text, output_path, args)
            if os.path.getsize(output_path) > 1024:
                return
            raise RuntimeError("empty audio")
        except Exception as e:
            last_err = e
        if attempt < args.retries - 1:
            await asyncio.sleep(2 ** attempt)
    raise last_err


def prepare_file(path, args, stats, split_fn):
    """Read text, split into chunks, prepare working state. Returns dict
    or None if the file is skipped (already-done) or empty."""
    base = os.path.splitext(os.path.basename(path))[0]
    output_path = os.path.join(args.output_dir, f"{base}.{args.fmt}")
    if os.path.exists(output_path) and os.path.getsize(output_path) > 1024:
        stats.files_skipped += 1
        emit_progress(base, "SKIP", 1, 1)
        return None
    with open(path, encoding="utf-8-sig") as f:
        text = f.read().replace("\r\n", "\n").strip()
    if not text:
        stats.files_skipped += 1
        emit_progress(base, "EMPTY", 0, 0)
        return None
    chunks = split_fn(text)
    stats.chunks_total += len(chunks)
    workdir = os.path.join(args.workdir, base)
    os.makedirs(workdir, exist_ok=True)
    chunk_paths = [os.path.join(workdir, f"{i:04d}.mp3") for i in range(len(chunks))]
    emit_progress(base, "WORK", 0, len(chunks))
    return {
        "input_path": path, "base": base, "output_path": output_path,
        "chunks": chunks, "chunk_paths": chunk_paths, "workdir": workdir,
        "remaining": len(chunks), "failed": False,
    }


def finalize_file(file_state, args, stats):
    """Run ffmpeg concat once all chunks of a file are ready, clean up cache."""
    if file_state["failed"]:
        return
    tempo = getattr(args, "tempo", 1.0)
    list_path = os.path.join(file_state["workdir"], "list.txt")
    total = len(file_state["chunks"])
    ok = ffmpeg_concat(file_state["chunk_paths"], list_path,
                       file_state["output_path"], args.fmt, tempo)
    if not ok:
        stats.files_failed += 1
        emit_progress(file_state["base"], "FFMPEG_FAIL", total, total)
        return
    if not args.keep_chunks:
        shutil.rmtree(file_state["workdir"], ignore_errors=True)
    stats.files_done += 1
    emit_progress(file_state["base"], "DONE", total, total)


async def synth_one_file(file_state, args, fetch_fn, stats, total_connections):
    """Synthesize one file — its chunks fetched in parallel, capped by
    `connections_per_file` (per-file) AND `total_connections` (global)."""
    file_sem = asyncio.Semaphore(args.connections_per_file)
    total = len(file_state["chunks"])
    failed_chunks = []

    def maybe_finalize():
        """Called whenever remaining hits 0 — could be from success or failure path."""
        if file_state["remaining"] != 0:
            return
        if failed_chunks and len(failed_chunks) > total * args.fail_tolerance:
            file_state["failed"] = True
            stats.files_failed += 1
            emit_progress(file_state["base"], "FAIL", total - len(failed_chunks), total)
            if stats.failure_log:
                stats.failure_log.write(f"{file_state['input_path']}\t{len(failed_chunks)} chunks failed\n")
                stats.failure_log.flush()
            return
        if failed_chunks:
            file_state["chunk_paths"] = [
                p for i, p in enumerate(file_state["chunk_paths"])
                if i not in failed_chunks
            ]
            print(f"[warn] {file_state['base']}: {len(failed_chunks)} chunks missing, "
                  f"concatenating {len(file_state['chunk_paths'])}/{total}", flush=True)
        finalize_file(file_state, args, stats)

    async def fetch_one(chunk_idx):
        chunk_path = file_state["chunk_paths"][chunk_idx]
        if not (os.path.exists(chunk_path) and os.path.getsize(chunk_path) > 1024):
            try:
                async with file_sem, total_connections:
                    await fetch_with_retry(file_state["chunks"][chunk_idx], chunk_path, fetch_fn, args)
            except Exception:
                failed_chunks.append(chunk_idx)
                file_state["remaining"] -= 1
                done = total - file_state["remaining"]
                emit_progress(file_state["base"], "WORK", done, total)
                maybe_finalize()
                return
        stats.chunks_done += 1
        file_state["remaining"] -= 1
        done = total - file_state["remaining"]
        if file_state["remaining"] == 0:
            maybe_finalize()
        else:
            emit_progress(file_state["base"], "WORK", done, total)

    await asyncio.gather(*(fetch_one(i) for i in range(total)))


def base_argparser(description, default_output, default_workdir,
                   default_batch_size, default_connections_per_file, api_max_connections):
    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("inputs", nargs="+", help="text file(s) or glob(s)")
    ap.add_argument("-o", "--output-dir", default=default_output)
    ap.add_argument("--fmt", choices=["m4a", "mp3"], default="m4a")
    ap.add_argument("--batch-size", type=int, default=default_batch_size,
                    help="how many files processed together (finish at same time)")
    ap.add_argument("--connections-per-file", type=int, default=default_connections_per_file,
                    help=f"connections per file (batch-size × this ≤ API ceiling ~{api_max_connections})")
    ap.add_argument("--retries", type=int, default=4)
    ap.add_argument("--fail-tolerance", type=float, default=0.05,
                    help="fraction of chunks allowed to fail (0.05 = 5%%); over this = mark file failed")
    ap.add_argument("--workdir", default=default_workdir)
    ap.add_argument("--keep-chunks", action="store_true")
    ap.add_argument("--log-failures", default=None)
    ap._api_max_connections = api_max_connections
    return ap


async def run_batch(args, fetch_fn, split_fn):
    files = collect_files(args.inputs)
    if not files:
        sys.exit("no input files")
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not in PATH")
    os.makedirs(args.output_dir, exist_ok=True)
    os.makedirs(args.workdir, exist_ok=True)

    total_conn = args.batch_size * args.connections_per_file
    print(f"[plan] batch_size={args.batch_size} connections_per_file={args.connections_per_file} "
          f"total_connections={total_conn}", flush=True)

    stats = Stats(len(files))
    if args.log_failures:
        stats.failure_log = open(args.log_failures, "w", encoding="utf-8")
        stats.failure_log.write("path\terror\n")

    file_states = [s for s in (prepare_file(p, args, stats, split_fn) for p in files) if s]
    total_sem = asyncio.Semaphore(total_conn)
    file_slot_sem = asyncio.Semaphore(args.batch_size)

    async def synth_with_slot(file_state):
        async with file_slot_sem:
            await synth_one_file(file_state, args, fetch_fn, stats, total_sem)

    try:
        await asyncio.gather(*(synth_with_slot(f) for f in file_states))
    finally:
        if stats.failure_log:
            stats.failure_log.close()

    elapsed = time.time() - stats.start_time
    print(f"\n=== done in {elapsed/60:.1f} min  |  "
          f"ok={stats.files_done}  fail={stats.files_failed}  skip={stats.files_skipped} ===")
    return stats.files_failed
