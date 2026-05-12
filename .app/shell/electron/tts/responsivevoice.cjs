// ResponsiveVoice TTS via texttospeech.responsivevoice.org
const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');

const ENDPOINT = 'https://texttospeech.responsivevoice.org/v1/text:synthesize';
const HOMEPAGE = 'https://responsivevoice.org/';
const KEY_RE = /key=([a-zA-Z0-9]{6,12})/;
const FALLBACK_KEYS = ['b08U7IYJ', 'FQ9r4hgY', 'HY7lTyiS'];
const MP3_MAGIC = [Buffer.from([0xff, 0xfb]), Buffer.from([0xff, 0xf3]), Buffer.from([0xff, 0xf2])];
const ID3 = Buffer.from('ID3');

const USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 4.1.2; SGH-T599N Build/JZO54K) AppleWebKit/535.19 (KHTML, like Gecko) Chrome/18.0.1025.166 Mobile Safari/535.19',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
];

let liveKey = null;

function pickUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

function fetchText(url, headers, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    Object.entries(headers).forEach(([k, v]) => req.setHeader(k, v));
    let body = '';
    let settled = false;
    const settle = (err, val) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (err) reject(err); else resolve(val);
    };
    let timer = setTimeout(() => {
      try { req.abort(); } catch { /* noop */ }
      settle(new Error('homepage fetch timeout'));
    }, timeoutMs);
    req.on('response', (res) => {
      if (res.statusCode >= 400) {
        settle(new Error(`HTTP ${res.statusCode}`));
        res.on('data', () => {});
        return;
      }
      res.on('data', (c) => { body += c.toString('utf-8'); });
      res.on('end', () => settle(null, body));
      res.on('error', (err) => settle(err));
    });
    req.on('error', (err) => settle(err));
    req.end();
  });
}

function downloadToBuffer(url, headers, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    Object.entries(headers).forEach(([k, v]) => req.setHeader(k, v));
    const chunks = [];
    let settled = false;
    const settle = (err, buf) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (err) reject(err); else resolve(buf);
    };
    // กัน RV server hang → retry รอบใหม่แทนที่จะรอ chunk เดียวไม่จบ
    let timer = setTimeout(() => {
      try { req.abort(); } catch { /* noop */ }
      settle(new Error('request timeout'));
    }, timeoutMs);
    req.on('response', (res) => {
      if (res.statusCode >= 400) {
        settle(new Error(`HTTP ${res.statusCode}`));
        res.on('data', () => {});
        return;
      }
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => settle(null, Buffer.concat(chunks)));
      res.on('error', (err) => settle(err));
    });
    req.on('error', (err) => settle(err));
    req.end();
  });
}

async function getLiveKey() {
  if (liveKey) return liveKey;
  try {
    const html = await fetchText(HOMEPAGE, {
      'User-Agent': pickUA(),
      'Accept-Encoding': 'gzip, deflate',
    });
    const m = html.match(KEY_RE);
    if (m) {
      liveKey = m[1];
      return liveKey;
    }
  } catch { /* noop */ }
  liveKey = FALLBACK_KEYS[0];
  return liveKey;
}

function isValidMp3(buf) {
  if (!buf || buf.length < 8) return false;
  if (buf.slice(0, 3).equals(ID3)) return true;
  for (const m of MP3_MAGIC) if (buf.slice(0, 2).equals(m)) return true;
  return false;
}

async function fetchChunk({ text, outPath, lang = 'th', gender = 'female', rate = 0.5, jitter = 0.5 }) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const key = await getLiveKey();
  const qs = new URLSearchParams({
    text: cleaned,
    lang,
    engine: 'g1',
    pitch: '0.5',
    rate: String(rate),
    volume: '1.0',
    key,
    gender,
  });
  const url = `${ENDPOINT}?${qs.toString()}`;
  if (jitter > 0) {
    const ms = Math.random() * jitter * 1000;
    await new Promise((r) => setTimeout(r, ms));
  }
  const data = await downloadToBuffer(url, {
    'User-Agent': pickUA(),
    'referer': 'https://responsivevoice.org/',
    'sec-fetch-dest': 'audio',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  });
  if (!isValidMp3(data)) throw new Error(`invalid mp3 (${data.length} bytes)`);
  // atomic write — เหมือนกับ google/edge: tmp file → rename
  const tmpPath = path.join(path.dirname(outPath), `${path.basename(outPath)}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`);
  fs.writeFileSync(tmpPath, data);
  try { fs.renameSync(tmpPath, outPath); }
  catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* noop */ }
    throw err;
  }
}

const DEFAULT_BATCH_SIZE = 6;
const DEFAULT_CONNECTIONS_PER_FILE = 1;
const API_MAX_CONNECTIONS = 8;

module.exports = {
  fetchChunk,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONNECTIONS_PER_FILE,
  API_MAX_CONNECTIONS,
  splitMode: 'chars',
};
