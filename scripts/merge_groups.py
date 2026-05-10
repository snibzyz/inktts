"""Merge m4a chapters into groups of N (default 5).

Usage:
  python scripts/merge_groups.py --src output/google --dst output/google_merged \
      --prefix "ติดหนี้สามสิบล้าน " --start 401 --end 600 --group 5
"""
import argparse
import os
import subprocess
import sys
import tempfile


def merge_one(src_files, out_path):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        list_path = f.name
        for p in src_files:
            f.write(f"file '{os.path.abspath(p).replace(chr(92), '/')}'\n")
    try:
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
               "-f", "concat", "-safe", "0", "-i", list_path,
               "-c", "copy", out_path]
        return subprocess.run(cmd).returncode == 0
    finally:
        try:
            os.remove(list_path)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--prefix", required=True, help='e.g. "ติดหนี้สามสิบล้าน "')
    ap.add_argument("--start", type=int, required=True)
    ap.add_argument("--end", type=int, required=True)
    ap.add_argument("--group", type=int, default=5)
    ap.add_argument("--ext", default="m4a")
    args = ap.parse_args()

    os.makedirs(args.dst, exist_ok=True)
    total_groups = 0
    failed = 0
    i = args.start
    while i <= args.end:
        j = min(i + args.group - 1, args.end)
        group_files = []
        missing = []
        for k in range(i, j + 1):
            p = os.path.join(args.src, f"{args.prefix}{k}.{args.ext}")
            if os.path.exists(p):
                group_files.append(p)
            else:
                missing.append(k)
        if not group_files:
            print(f"[skip] {i}-{j} no files")
            i = j + 1
            continue
        out_name = f"{args.prefix}{i}-{j}.{args.ext}"
        out_path = os.path.join(args.dst, out_name)
        if missing:
            print(f"[warn] {i}-{j} missing chapters: {missing}")
        ok = merge_one(group_files, out_path)
        if ok:
            print(f"[ok] {out_name} ({len(group_files)} files)")
            total_groups += 1
        else:
            print(f"[fail] {out_name}")
            failed += 1
        i = j + 1
    print(f"\n=== merged {total_groups} groups, {failed} failed ===")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
