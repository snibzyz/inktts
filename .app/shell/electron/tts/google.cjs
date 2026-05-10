// Google Translate TTS — public unofficial endpoint
const fs = require('node:fs');
const { net } = require('electron');

const ENDPOINT = 'https://translate.google.com/translate_tts';
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
];

function pickUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

function buildUrl({ text, lang }) {
  const qs = new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: lang, q: text });
  return `${ENDPOINT}?${qs.toString()}`;
}

function downloadToBuffer(url, headers) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    Object.entries(headers).forEach(([k, v]) => req.setHeader(k, v));
    const chunks = [];
    req.on('response', (res) => {
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.on('data', () => {});
        return;
      }
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchChunk({ text, outPath, lang = 'th', jitter = 0.1 }) {
  if (jitter > 0) {
    const ms = Math.random() * jitter * 1000;
    await new Promise((r) => setTimeout(r, ms));
  }
  const url = buildUrl({ text, lang });
  const headers = {
    'User-Agent': pickUA(),
    'Referer': 'https://translate.google.com/',
  };
  const data = await downloadToBuffer(url, headers);
  if (data.length < 512) throw new Error(`too small (${data.length} bytes)`);
  fs.writeFileSync(outPath, data);
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
