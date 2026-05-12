// Edge TTS via msedge-tts — neural voices, free, no API key
const fs = require('node:fs');
const path = require('node:path');

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

// เขียนไป temp path ก่อน → rename atomic เป็น outPath
// → 2 instance ที่ทำ chunk เดียวกันจะไม่เปิด final path ทับกัน
//   ตัวที่ rename ทีหลังชนะ (ทั้งคู่เนื้อหาเดียวกันอยู่แล้ว ไม่ทำให้เพี้ยน)
// → ไม่มี writeStream ชนกันบนไฟล์เดียว
function makeTmpPath(outPath) {
  const dir = path.dirname(outPath);
  const base = path.basename(outPath);
  return path.join(dir, `${base}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`);
}

async function fetchChunk({ text, outPath, voice = 'th-TH-PremwadeeNeural', rate = '+30%' }) {
  if (!MsEdgeTTS) throw new Error('msedge-tts not installed');
  const tts = new MsEdgeTTS();
  // msedge-tts v2: setMetadata รับแค่ voice + format (ไม่มี rate ใน MetadataOptions)
  // rate / pitch / volume ต้องส่งให้ toStream(text, ProsodyOptions) ต่างหาก
  // ของเดิมส่ง rate ให้ setMetadata → ถูก ignore → Edge เร็วเท่า default ทุกครั้ง (bug v2.0.0)
  await tts.setMetadata(voice, 'audio-24khz-48kbitrate-mono-mp3');
  const result = await tts.toStream(text, { rate: rateToString(rate) });
  const stream = result?.audioStream || result;
  const tmpPath = makeTmpPath(outPath);
  await new Promise((resolve, reject) => {
    let ws;
    try {
      ws = fs.createWriteStream(tmpPath);
    } catch (err) {
      reject(err);
      return;
    }
    let received = 0;
    let settled = false;
    let t = null;
    const settle = (err) => {
      if (settled) return;
      settled = true;
      if (t) { clearTimeout(t); t = null; }
      try { stream.removeAllListeners(); } catch { /* noop */ }
      if (err) {
        try { ws.destroy(); } catch { /* noop */ }
        try { fs.unlinkSync(tmpPath); } catch { /* noop */ }
        reject(err);
        return;
      }
      ws.end(() => {
        if (received < 512) {
          try { fs.unlinkSync(tmpPath); } catch { /* noop */ }
          reject(new Error('empty audio'));
        } else resolve();
      });
    };
    ws.on('error', (err) => settle(err));
    stream.on('data', (chunk) => {
      if (settled) return;
      received += chunk.length;
      try {
        if (!ws.destroyed) ws.write(chunk);
      } catch (err) {
        settle(err);
      }
    });
    stream.on('end', () => settle());
    stream.on('close', () => settle());
    stream.on('error', (err) => settle(err));
    t = setTimeout(() => settle(new Error('edge tts timeout')), 30000);
  });
  // atomic rename — fs.renameSync บน Windows ใช้ MoveFileEx
  // ถ้า outPath มีอยู่แล้วจาก instance อื่น → rename overwrites ได้ (Node v20+)
  try {
    fs.renameSync(tmpPath, outPath);
  } catch (err) {
    // ถ้า rename fail (เช่นไฟล์ outPath โดน lock โดย instance อื่นที่กำลัง read) →
    // ลบ tmp ทิ้งแล้ว throw — runner รับ retry
    try { fs.unlinkSync(tmpPath); } catch { /* noop */ }
    throw err;
  }
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
