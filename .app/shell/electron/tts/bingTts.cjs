// Bing Translator TTS client (`bing.com/tfettts`) — เสียง Premwadee ตัวเดียวกับ Edge แต่คนละเครื่องสร้างเสียง
// port จาก INKIDEA `.app/shell/electron/audio/bingTts.cjs` (ตัดโหมด proxy ออก — INKTTS ไม่มี proxy)
//
// วัดจริง 30-09-2026: ช่วงที่ Edge Premwadee ช้าฝั่ง Microsoft (≈1x realtime + ตอบ 0 byte ~60%)
// Bing ตอบครบใน ~2 วิ/ประโยค ไม่เจอ 0 byte · แลกกับคุณภาพ mp3 16 kHz 32 kbps (Edge 24 kHz 48 kbps)
//
// ไม่ใช่ API ทางการ: key + token มาจากหน้า bing.com/translator — หมดอายุตามที่หน้าแจก
// session ผูกกับ cookie + IP ที่ขอ → ใช้ session เดียวต่อ client
// ใช้ global fetch ของ Node (Electron main / Node 20+) — ไม่ต้องพึ่ง undici แยก

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';
const PAGE_URL = 'https://www.bing.com/translator';
const TTS_URL = 'https://www.bing.com/tfettts';
const VOICE_DEFAULT = 'th-TH-PremwadeeNeural';
/** เผื่อก่อนหมดอายุจริง — ขอ token ใหม่ก่อนถึงเวลา */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const SESSION_TIMEOUT_MS = 20000;
const MIN_BYTES = 1500;
/** 16 kHz 32 kbps ≈ 4000 bytes/วิ · ~0.07 วิ/ตัวอักษรไทย → ต่ำกว่า 60 bytes/ตัว = เสียงขาด/ว่าง */
const MIN_BYTES_PER_CHAR = 60;

/** อักขระที่ XML 1.0 ห้าม (control chars ยกเว้น \t \n \r · U+FFFE/U+FFFF) */
// eslint-disable-next-line no-control-regex
const XML_INVALID_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]', 'g');

/** ข้อความพร้อมวางใน SSML — ตัดอักขระที่ XML ไม่รับ แล้ว escape & < > (ครั้งเดียว ห้ามซ้อน) */
function toSsmlText(s) {
  return String(s ?? '')
    .replace(XML_INVALID_RE, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** รับ "+30%" / "-10%" / number (% ตรง ๆ) → prosody rate string */
function toProsodyRate(rate) {
  if (typeof rate === 'string' && /^[-+]?\d+(?:\.\d+)?%$/.test(rate.trim())) {
    const v = Math.round(parseFloat(rate));
    return `${v >= 0 ? '+' : ''}${v}%`;
  }
  if (typeof rate === 'number' && Number.isFinite(rate)) {
    const v = Math.round(rate);
    return `${v >= 0 ? '+' : ''}${v}%`;
  }
  return '+0%';
}

/** ขั้นต่ำของขนาดเสียงตามความยาวข้อความ — ต่ำกว่านี้ = เสียงขาด/ว่าง */
function minBytesFor(text) {
  return Math.max(MIN_BYTES, String(text || '').replace(/\s/gu, '').length * MIN_BYTES_PER_CHAR);
}

function withTimeout(ms, signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error('timeout')), ms);
  const onAbort = () => ctl.abort(signal.reason);
  if (signal) {
    if (signal.aborted) ctl.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return { signal: ctl.signal, done: () => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); } };
}

/** แกะ IG / IID / key / token / อายุ จาก HTML หน้า translator — ไม่เจอ = null (ไม่เดาค่า) */
function parseSessionPage(html) {
  const IG = html.match(/IG:"([^"]+)"/)?.[1];
  const IID = html.match(/data-iid="([^"]+)"/)?.[1] || 'translator.5023';
  const m = html.match(/params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)/);
  if (!IG || !m) return null;
  return { IG, IID, key: m[1], token: m[2], ttlMs: Number(m[3]) || 3600000 };
}

/** client 1 session — ขอใหม่เมื่อหมดอายุ หรือโดนปฏิเสธ (401/403/429) */
function createBingClient({ fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  let session = null;
  let sessionPromise = null;
  let seq = 1;

  async function openSession(signal) {
    const to = withTimeout(SESSION_TIMEOUT_MS, signal);
    try {
      const r = await doFetch(PAGE_URL, { headers: { 'User-Agent': UA }, signal: to.signal });
      const html = await r.text();
      const parsed = parseSessionPage(html);
      if (!parsed) throw new Error(`bing: เปิด session ไม่ได้ (HTTP ${r.status})`);
      const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
      return { ...parsed, cookie, expiresAt: Date.now() + parsed.ttlMs - TOKEN_MARGIN_MS };
    } finally { to.done(); }
  }

  async function getSession(signal) {
    if (session && session.expiresAt > Date.now()) return session;
    if (!sessionPromise) {
      sessionPromise = openSession(signal)
        .then((s) => { session = s; return s; })
        .finally(() => { sessionPromise = null; });
    }
    return sessionPromise;
  }

  /** คืน Buffer mp3 · โยน error พร้อม status ให้ผู้เรียกตัดสิน retry */
  async function synth(text, { voice = VOICE_DEFAULT, rate = '+0%', timeoutMs = 60000, signal } = {}) {
    const s = await getSession(signal);
    const ssml = `<speak version='1.0' xml:lang='th-TH'><voice xml:lang='th-TH' name='${voice}'><prosody rate='${toProsodyRate(rate)}'>${toSsmlText(text)}</prosody></voice></speak>`;
    const body = new URLSearchParams({ ssml, token: s.token, key: s.key });
    const to = withTimeout(timeoutMs, signal);
    try {
      const r = await doFetch(`${TTS_URL}?isVertical=1&IG=${s.IG}&IID=${s.IID}.${seq++}`, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: s.cookie, Referer: PAGE_URL },
        body,
        signal: to.signal,
      });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.status === 401 || r.status === 403 || r.status === 429) session = null; // token หมด/โดนจำกัด → ขอใหม่รอบหน้า
      if (r.status !== 200 || !/audio/i.test(r.headers.get('content-type') || '')) {
        const err = new Error(`bing: HTTP ${r.status}`);
        err.status = r.status;
        throw err;
      }
      const need = minBytesFor(text);
      if (buf.length < need) throw new Error(`bing: too-small (${buf.length}/${need})`);
      return buf;
    } finally { to.done(); }
  }

  return { synth, resetSession: () => { session = null; } };
}

module.exports = {
  createBingClient,
  parseSessionPage,
  toSsmlText,
  toProsodyRate,
  minBytesFor,
  VOICE_DEFAULT,
};
