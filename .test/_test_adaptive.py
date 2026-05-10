"""Unit-level test for AdaptiveLimiter — verifies shrink-on-fail and
grow-on-recover without burning real API calls.

Strategy: instantiate the limiter, simulate outcomes by calling
report_outcome() in an asyncio loop, capture printed LIMIT lines, assert
the cap halved after fail_threshold consecutive fails and recovered after
recover_threshold consecutive successes.
"""
import asyncio
import io
import sys
from contextlib import redirect_stdout
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from _lib import AdaptiveLimiter


async def main():
    out = io.StringIO()
    with redirect_stdout(out):
        lim = AdaptiveLimiter(initial=20, minimum=1, fail_threshold=3,
                              recover_threshold=10, label="test")
        # 3 consecutive fails → cap should halve (20 → 10)
        for _ in range(3):
            await lim.report_outcome(False)
        assert lim.current_max == 10, f"expected 10, got {lim.current_max}"

        # 3 more fails → 10 → 5
        for _ in range(3):
            await lim.report_outcome(False)
        assert lim.current_max == 5, f"expected 5, got {lim.current_max}"

        # 3 more fails → 5 → 2
        for _ in range(3):
            await lim.report_outcome(False)
        assert lim.current_max == 2, f"expected 2, got {lim.current_max}"

        # 3 more fails → 2 → 1 (clamped at minimum)
        for _ in range(3):
            await lim.report_outcome(False)
        assert lim.current_max == 1, f"expected 1, got {lim.current_max}"

        # 1 ok then resume failing — counter must reset, no further shrink below 1
        await lim.report_outcome(True)
        for _ in range(3):
            await lim.report_outcome(False)
        assert lim.current_max == 1

        # 10 consecutive oks → grow by 1 (1 → 2)
        for _ in range(10):
            await lim.report_outcome(True)
        assert lim.current_max == 2, f"expected 2 after 10 oks, got {lim.current_max}"

        # 10 more oks → 2 → 3
        for _ in range(10):
            await lim.report_outcome(True)
        assert lim.current_max == 3

    output = out.getvalue()
    shrinks = [l for l in output.splitlines() if "shrink" in l]
    grows = [l for l in output.splitlines() if "grow" in l]
    assert len(shrinks) == 4, f"expected 4 shrink events, got {len(shrinks)}"
    assert len(grows) == 2, f"expected 2 grow events, got {len(grows)}"
    print(f"shrinks: {shrinks}")
    print(f"grows:   {grows}")
    print("AdaptiveLimiter unit test ok")


if __name__ == "__main__":
    asyncio.run(main())
