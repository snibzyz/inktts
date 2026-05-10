"""
Batch TTS via ResponsiveVoice's getvoice.php proxy (backend = Google Translate TTS).

Free demo keys + 100-char chunk limit. Lower quality than edge.py — prefer that
script unless you specifically want this backend.

Hardened with:
  - rotating User-Agent
  - rotating demo key (FQ9r4hgY / HY7lTyiS)
  - random jitter before each request

Requires: pip install aiohttp ; ffmpeg in PATH
"""
import asyncio
import random
import re
import sys
import urllib.parse
import warnings

import aiohttp

try:
    from fake_useragent import UserAgent
    _ua_gen = UserAgent(platforms=["mobile"], browsers=["Safari", "Chrome"])
except Exception:
    _ua_gen = None

from _lib import base_argparser, run_batch, split_chars

warnings.filterwarnings("ignore", message="Unclosed client session")
warnings.filterwarnings("ignore", message="Unclosed connector")

ENDPOINT = "https://texttospeech.responsivevoice.org/v1/text:synthesize"
HOSTNAME = "texttospeech.responsivevoice.org"
HOMEPAGE = "https://responsivevoice.org/"
KEY_RE = re.compile(r"key=([a-zA-Z0-9]{6,12})")
FALLBACK_KEYS = ["b08U7IYJ", "FQ9r4hgY", "HY7lTyiS"]
_live_key = None

FALLBACK_USER_AGENTS = [
    # bal4web's exact UA + a couple of mobile fallbacks if fake-useragent isn't installed.
    "Mozilla/5.0 (Linux; Android 4.1.2; SGH-T599N Build/JZO54K) AppleWebKit/535.19 (KHTML, like Gecko) Chrome/18.0.1025.166 Mobile Safari/535.19",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
]


def random_user_agent():
    if _ua_gen is not None:
        try:
            return _ua_gen.random
        except Exception:
            pass
    return random.choice(FALLBACK_USER_AGENTS)
MP3_MAGIC_BYTES = (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")
_session = None


def _get_session():
    global _session
    if _session is None or _session.closed:
        connector = aiohttp.TCPConnector(limit=64, limit_per_host=64, ttl_dns_cache=300)
        _session = aiohttp.ClientSession(
            connector=connector,
            timeout=aiohttp.ClientTimeout(total=45, connect=10),
        )
    return _session


async def _get_live_key():
    """Scrape the active key from the responsivevoice.org main page,
    falling back to known keys if scraping fails."""
    global _live_key
    if _live_key:
        return _live_key
    try:
        session = _get_session()
        # Skip brotli (aiohttp doesn't decode it without the brotli package)
        async with session.get(HOMEPAGE, headers={
            "User-Agent": random_user_agent(),
            "Accept-Encoding": "gzip, deflate",
        }) as r:
            html = await r.text()
        m = KEY_RE.search(html)
        if m:
            _live_key = m.group(1)
            print(f"[rv] scraped key={_live_key}", flush=True)
            return _live_key
    except Exception as e:
        print(f"[rv] key scrape failed: {e} — falling back", flush=True)
    _live_key = FALLBACK_KEYS[0]
    return _live_key


async def fetch_chunk(text, out_path, args):
    # Newlines/tabs within a single chunk make the API return errors;
    # collapse to single spaces.
    text = re.sub(r"\s+", " ", text).strip()
    key = await _get_live_key()
    qs = urllib.parse.urlencode({
        "text": text, "lang": args.lang, "engine": "g1",
        "pitch": 0.5, "rate": args.rate, "volume": 1.0,
        "key": key, "gender": args.gender,
    })
    url = f"{ENDPOINT}?{qs}"
    headers = {
        "User-Agent": random_user_agent(),
        "referer": "https://responsivevoice.org/",
        "sec-fetch-dest": "audio",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
    }
    if args.jitter > 0:
        await asyncio.sleep(random.uniform(0, args.jitter))
    # IP rotation per request was tried and reverted — it killed TCP keep-alive
    # (every request needed a fresh TLS handshake), making throughput 4× slower.
    # Keeping the hostname URL lets aiohttp reuse one TCP connection per host.
    session = _get_session()
    async with session.get(url, headers=headers) as response:
        response.raise_for_status()
        data = await response.read()
    if not data or (data[:3] != b"ID3" and data[:2] not in MP3_MAGIC_BYTES):
        raise RuntimeError(f"invalid mp3 ({len(data)} bytes)")
    with open(out_path, "wb") as f:
        f.write(data)


def main():
    ap = base_argparser(
        __doc__, default_output="output/responsivevoice", default_workdir="_cache/responsivevoice",
        default_batch_size=6, default_connections_per_file=1, api_max_connections=8,
    )
    ap.add_argument("--lang", default="th")
    ap.add_argument("--gender", default="female", choices=["female", "male"])
    ap.add_argument("--rate", type=float, default=0.5,
                    help="0..1 server-side rate (0.5 = normal)")
    ap.add_argument("--tempo", type=float, default=1.3,
                    help="speed multiplier applied via ffmpeg atempo")
    ap.add_argument("--chunk-chars", type=int, default=100)
    ap.add_argument("--jitter", type=float, default=0.5,
                    help="random delay (seconds) before each request, 0 = none")
    args = ap.parse_args()

    print(f"[responsivevoice] lang={args.lang} gender={args.gender} tempo={args.tempo} "
          f"jitter={args.jitter}")

    split_fn = lambda text: split_chars(text, args.chunk_chars)
    failed = asyncio.run(run_batch(args, fetch_chunk, split_fn))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
