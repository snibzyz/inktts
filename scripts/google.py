"""
Batch TTS via Google Translate's unofficial public TTS endpoint.

Free, no API key, but rate-limited per IP (~6-8 concurrent max).
Lower quality (standard, not neural) — prefer edge.py unless you specifically
want this backend.

Hardened with:
  - rotating User-Agent
  - random jitter before each request

Requires: pip install aiohttp ; ffmpeg in PATH
"""
import asyncio
import random
import sys
import urllib.parse
import warnings

import aiohttp

from _lib import base_argparser, run_batch, split_chars

warnings.filterwarnings("ignore", message="Unclosed client session")
warnings.filterwarnings("ignore", message="Unclosed connector")

ENDPOINT = "https://translate.google.com/translate_tts"
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
]
_session = None


def _get_session():
    """Lazy-init a shared aiohttp session — reusing TLS connections cuts
    handshake overhead (~200-500ms per chunk) by ~80%."""
    global _session
    if _session is None or _session.closed:
        connector = aiohttp.TCPConnector(limit=64, limit_per_host=64, ttl_dns_cache=300)
        _session = aiohttp.ClientSession(
            connector=connector,
            timeout=aiohttp.ClientTimeout(total=45, connect=10),
        )
    return _session


async def fetch_chunk(text, out_path, args):
    qs = urllib.parse.urlencode({
        "ie": "UTF-8", "client": "tw-ob",
        "tl": args.lang, "q": text,
    })
    url = f"{ENDPOINT}?{qs}"
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Referer": "https://translate.google.com/",
    }
    if args.jitter > 0:
        await asyncio.sleep(random.uniform(0, args.jitter))
    session = _get_session()
    async with session.get(url, headers=headers) as response:
        response.raise_for_status()
        data = await response.read()
    if len(data) < 512:
        raise RuntimeError(f"too small ({len(data)} bytes)")
    with open(out_path, "wb") as f:
        f.write(data)


def main():
    ap = base_argparser(
        __doc__, default_output="output/google", default_workdir="_cache/google",
        default_batch_size=6, default_connections_per_file=1, api_max_connections=8,
    )
    ap.add_argument("--lang", default="th")
    ap.add_argument("--tempo", type=float, default=1.3,
                    help="speed multiplier applied via ffmpeg atempo")
    ap.add_argument("--chunk-chars", type=int, default=180,
                    help="max chars per chunk (Google limit ~200)")
    ap.add_argument("--jitter", type=float, default=0.3,
                    help="random delay (seconds) before each request, 0 = none")
    args = ap.parse_args()

    print(f"[google] lang={args.lang} tempo={args.tempo} chunk_chars={args.chunk_chars} "
          f"jitter={args.jitter}")

    split_fn = lambda text: split_chars(text, args.chunk_chars)
    failed = asyncio.run(run_batch(args, fetch_chunk, split_fn))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
