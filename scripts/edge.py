"""
Batch TTS via Microsoft Edge "Read Aloud" — neural voices, free, no API key.

Voice: th-TH-PremwadeeNeural (default), th-TH-NiwatNeural, etc.
Throttle ceiling: ~56 concurrent WebSockets per IP.

Requires: pip install edge-tts ; ffmpeg in PATH
"""
import asyncio
import sys

import edge_tts

from _lib import base_argparser, run_batch, split_lines


async def fetch_chunk(text, out_path, args):
    comm = edge_tts.Communicate(text, voice=args.voice, rate=args.rate)
    await comm.save(out_path)


def main():
    ap = base_argparser(
        __doc__, default_output="output/edge", default_workdir="_cache/edge",
        default_batch_size=10, default_connections_per_file=4, api_max_connections=56,
    )
    ap.add_argument("--voice", default="th-TH-PremwadeeNeural")
    ap.add_argument("--rate", default="+30%", help="e.g. +30%% for 1.3x")
    ap.add_argument("--lines-per-chunk", type=int, default=1)
    args = ap.parse_args()

    print(f"[edge] voice={args.voice} rate={args.rate} lines/chunk={args.lines_per_chunk}")

    split_fn = lambda text: split_lines(text, args.lines_per_chunk)
    failed = asyncio.run(run_batch(args, fetch_chunk, split_fn))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
