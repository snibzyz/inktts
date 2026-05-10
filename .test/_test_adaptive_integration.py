"""Integration test: run google.py with a fetch_chunk that always fails,
verify the orchestrator emits LIMIT shrink events as the AdaptiveLimiter
back-tracks. Doesn't touch the network."""
import asyncio
import io
import sys
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import _lib

# Force every chunk fetch to fail. fetch_with_retry will call fetch_fn
# args.retries times then raise.
async def always_fail(text, out_path, args):
    raise RuntimeError("simulated rate-limit")


def make_args():
    """Build an argparse.Namespace mirroring what google.py passes."""
    import argparse
    return argparse.Namespace(
        inputs=[str(ROOT / ".test" / "fixtures" / "_test_short.txt")],
        output_dir=str(ROOT / "_cache" / "_adaptive_test_out"),
        fmt="m4a",
        batch_size=1,
        connections_per_file=12,
        retries=1,  # fail fast
        fail_tolerance=1.0,  # don't bail on file-level failure
        workdir=str(ROOT / "_cache" / "_adaptive_test_workdir"),
        keep_chunks=False,
        log_failures=None,
    )


def split_chars_simple(text):
    return _lib.split_chars(text, 100)


async def main():
    # Generate a longer input so we have enough chunks to trigger shrink
    big_input = ROOT / "_cache" / "_adaptive_test_input.txt"
    big_input.parent.mkdir(parents=True, exist_ok=True)
    big_input.write_text("\n".join([f"บรรทัดที่ {i} ทดสอบการแปลงเสียงภาษาไทยให้ยาวพอที่จะแบ่ง chunk ได้หลายตัว"
                                   for i in range(20)]), encoding="utf-8")

    out = io.StringIO()
    with redirect_stdout(out):
        args = make_args()
        args.inputs = [str(big_input)]
        await _lib.run_batch(args, always_fail, split_chars_simple)

    output = out.getvalue()
    limit_lines = [l for l in output.splitlines() if l.startswith("LIMIT\t")]
    prog_lines = [l for l in output.splitlines() if l.startswith("PROG\t")]
    print(f"PROG events: {len(prog_lines)}")
    print(f"LIMIT events: {len(limit_lines)}")
    for l in limit_lines:
        print(f"  {l}")
    assert limit_lines, "expected at least one LIMIT shrink event after consecutive fails"
    assert any("shrink" in l for l in limit_lines), "no shrink event"
    print("Adaptive integration test ok")


if __name__ == "__main__":
    asyncio.run(main())
