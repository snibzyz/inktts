// Edge TTS via msedge-tts — neural voices, free, no API key
const fs = require('node:fs');

let MsEdgeTTS;
try { ({ MsEdgeTTS } = require('msedge-tts')); } catch { MsEdgeTTS = null; }

function rateToString(rate) {
  // accept "+30%", "-10%", "1.3x", number
  if (typeof rate === 'string') return rate;
  if (typeof rate === 'number') {
    const pct = Math.round((rate - 1) * 100);
    return (pct >= 0 ? '+' : '') + pct + '%';
  }
  return '+0%';
}

async function fetchChunk({ text, outPath, voice = 'th-TH-PremwadeeNeural', rate = '+30%' }) {
  if (!MsEdgeTTS) throw new Error('msedge-tts not installed');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, 'audio-24khz-48kbitrate-mono-mp3', { rate: rateToString(rate) });
  const result = await tts.toStream(text);
  const stream = result?.audioStream || result;
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);
    let received = 0;
    let settled = false;
    let t = null;
    const settle = (err) => {
      if (settled) return;
      settled = true;
      if (t) { clearTimeout(t); t = null; }
      if (err) { try { ws.destroy(); } catch { /* noop */ } reject(err); return; }
      ws.end(() => {
        if (received < 512) reject(new Error('empty audio'));
        else resolve();
      });
    };
    stream.on('data', (chunk) => { received += chunk.length; ws.write(chunk); });
    stream.on('end', () => settle());
    stream.on('close', () => settle());
    stream.on('error', (err) => settle(err));
    t = setTimeout(() => settle(new Error('edge tts timeout')), 30000);
  });
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CONNECTIONS_PER_FILE = 4;
const API_MAX_CONNECTIONS = 56;

module.exports = {
  fetchChunk,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONNECTIONS_PER_FILE,
  API_MAX_CONNECTIONS,
  splitMode: 'lines', // splitter type
};
