// Bing TTS engine — เสียง Premwadee/Niwat ผ่าน Bing Translator (bingTts.cjs)
// อินเทอร์เฟซเดียวกับ edge.cjs / google.cjs: fetchChunk({ text, outPath, voice, rate })
//
// ใช้ตอน Edge ช้าฝั่ง Microsoft (วัด 30-09-2026) — เสียงเดียวกัน คุณภาพ 16 kHz 32 kbps
// จาก IP เดียว: ~10 คำขอพร้อมกันไม่เจอ error · ~40 พร้อมกันเจอ HTTP 500 ~11% (ลองใหม่ผ่าน)
// → ลองใหม่ในตัวแบบเว้นสั้น ๆ ก่อนโยนให้ runner (runner backoff 1,2,4 วิ... ช้าเกินสำหรับ 500 แบบสุ่ม)
// ไม่มี WordBoundary → กันเสียงขาดด้วย byte floor (minBytesFor) อย่างเดียว

const fsp = require('node:fs/promises');
const path = require('node:path');
const { createBingClient, VOICE_DEFAULT } = require('./bingTts.cjs');

/** จำนวนครั้งที่ลองต่อท่อน (ภายใน 1 attempt ของ runner) */
const BING_TRIES = 8;
const TRY_GAP_MS = 200;
/** token หมด/โดนจำกัด → รอนานกว่าก่อนขอ session ใหม่ */
const SESSION_GAP_MS = 1500;
/** งบเวลารวมต่อท่อน — ต้องต่ำกว่า fetchAttemptTimeoutMs ของ runner (60 วิ) ไม่งั้น runner ยิงซ้อน */
const TOTAL_BUDGET_MS = 50000;

/** Bing สุ่มล้ม/เส้นหลุด — ลองใหม่ทันที */
const RETRY_RE = /HTTP 5\d\d|too-small|timeout|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|fetch failed|terminated|UND_ERR/i;
/** session หมด/โดนปฏิเสธ — client ล้าง session แล้ว → ลองใหม่หลังพักสั้น */
const SESSION_RE = /HTTP 40[13]|HTTP 429|เปิด session ไม่ได้/;

/** เพดานต่อคำขอ — Bing ตอบทั้งไฟล์ทีเดียว ~2 วิ/ประโยค (ไม่ stream) */
function requestTimeoutFor(text) {
  return 20000 + String(text || '').length * 40;
}

function errorText(e) {
  const cause = e?.cause ? ` ${e.cause.code || ''} ${e.cause.message || ''}` : '';
  return `${String(e?.message || e)}${cause}`;
}

/** 'retry' = ลองใหม่เร็ว · 'session' = พักแล้วลองใหม่ · 'fatal' = โยนให้ runner ทันที */
function classifyError(e) {
  const msg = errorText(e);
  if (SESSION_RE.test(msg)) return 'session';
  if (RETRY_RE.test(msg)) return 'retry';
  return 'fatal';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** เขียนไฟล์แบบ atomic (tmp → rename) — กันไฟล์ครึ่งท่อนค้างใน cache */
async function writeAtomic(outPath, buf) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, outPath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

// client เดียวทั้ง process — session (cookie + token) ใช้ร่วมกันทุกท่อน
let _client = null;
function client() {
  if (!_client) _client = createBingClient();
  return _client;
}

/**
 * @param {{ text: string, outPath: string, voice?: string, rate?: string|number,
 *           tries?: number, gapMs?: number, synth?: Function }} args
 *   synth: ฉีดตัวสร้างเสียงแทน client จริง (ใช้ในเทส)
 */
async function fetchChunk({ text, outPath, voice = VOICE_DEFAULT, rate = '+0%', tries = BING_TRIES, gapMs = TRY_GAP_MS, synth }) {
  const doSynth = synth || ((t, o) => client().synth(t, o));
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let lastErr = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 1000) break;
    try {
      const buf = await doSynth(text, { voice, rate, timeoutMs: Math.min(requestTimeoutFor(text), remaining) });
      await writeAtomic(outPath, buf);
      return;
    } catch (e) {
      lastErr = e;
      const kind = classifyError(e);
      if (kind === 'fatal') throw e;
      if (attempt < tries - 1) await sleep(kind === 'session' ? SESSION_GAP_MS : gapMs);
    }
  }
  throw lastErr || new Error('bing: หมดเวลาต่อท่อน');
}

// คำขอรวม = batch × conn · 10 = จุดที่ไม่เจอ error จาก IP เดียว
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_CONNECTIONS_PER_FILE = 2;
const API_MAX_CONNECTIONS = 24;

module.exports = {
  fetchChunk,
  classifyError,
  requestTimeoutFor,
  writeAtomic,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONNECTIONS_PER_FILE,
  API_MAX_CONNECTIONS,
  splitMode: 'lines', // เสียงเดียวกับ Edge → splitter เดียวกัน
};
