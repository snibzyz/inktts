const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getFfmpegPath } = require('../helpers/paths.cjs');

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    p.stderr.on('data', (c) => { stderr += c.toString(); });
    p.on('close', (code) => resolve({ code, stderr }));
    p.on('error', (err) => resolve({ code: -1, stderr: err.message }));
  });
}

// ffmpeg concat demuxer format: file 'path' — single quote เป็น quote เดียวที่รองรับ
// ถ้า path เองมี ' ต้อง escape เป็น '\'' (close-escape-open) → ไม่งั้น syntax error
// + กรอง chunk ที่หายไป/ขนาดเล็กเกินไป กัน ffmpeg fail ทั้งไฟล์เพราะ chunk เดียว
function buildConcatLines(chunkPaths) {
  const valid = [];
  for (const p of chunkPaths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 1024) valid.push(p);
    } catch { /* noop */ }
  }
  const escape = (p) => path.resolve(p).replace(/\\/g, '/').replace(/'/g, "'\\''");
  return { lines: valid.map((p) => `file '${escape(p)}'`).join('\n'), validCount: valid.length };
}

// Atomic output: ให้ ffmpeg เขียนไป tmp ก่อน → rename เป็น outputPath
// → ถ้าไฟดับ/kill ระหว่าง concat: tmp เหลือเป็นเศษ (next run ไม่อ่าน)
// → outputPath สมบูรณ์เสมอ — resume เช็คขนาดได้ปกติ ไม่มีเคสไฟล์ครึ่ง ๆ
// ต้องรักษานามสกุลเดิมไว้เพื่อให้ ffmpeg เดา muxer ได้ (m4a/mp3 ใช้คนละ muxer)
function makeOutTmp(outputPath) {
  const dir = path.dirname(outputPath);
  const ext = path.extname(outputPath); // .m4a / .mp3 (รวมจุดด้วย)
  const stem = path.basename(outputPath, ext);
  const token = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(dir, `${stem}.partial-${token}${ext}`);
}

// คืน { ok, error } — error เป็น string สั้นๆ บอกเหตุที่ fail
// (ก่อนหน้านี้คืน bool → user เห็นแค่ "รวมเสียงพลาด" ไม่รู้ว่าเพราะอะไร
//  ทุกเหตุ fail กลืน log หมด ต้องเปิด inktts.log ที่ %APPDATA% ดู)
async function ffmpegConcat(chunkPaths, listPath, outputPath, fmt, tempo = 1.0) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) return { ok: false, error: 'ffmpeg binary ไม่พบในแอป (asar.unpacked หาย/antivirus ลบ)' };
  if (!fs.existsSync(ffmpeg)) return { ok: false, error: `ffmpeg.exe ไม่อยู่ที่ ${ffmpeg}` };
  const { lines, validCount } = buildConcatLines(chunkPaths);
  if (!validCount) return { ok: false, error: 'ไม่มี chunk ที่ใช้ได้ (ทั้งหมดหายหรือเล็กกว่า 1KB)' };
  try {
    fs.writeFileSync(listPath, lines + '\n', 'utf-8');
  } catch (err) {
    return { ok: false, error: `เขียน list.txt ไม่ได้: ${err && err.message}` };
  }

  const outTmp = makeOutTmp(outputPath);
  const baseArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath];
  const needsAtempo = Math.abs(tempo - 1.0) >= 0.001;
  let args;
  if (fmt === 'mp3' && !needsAtempo) {
    args = [...baseArgs, '-c', 'copy', outTmp];
  } else {
    const codec = fmt === 'm4a' ? ['-c:a', 'aac', '-b:a', '128k'] : ['-c:a', 'libmp3lame', '-b:a', '128k'];
    const atempo = needsAtempo ? ['-filter:a', `atempo=${tempo}`] : [];
    args = [...baseArgs, ...atempo, ...codec, outTmp];
  }
  const { code, stderr } = await run(ffmpeg, args);
  if (code !== 0) {
    if (process.env.INKTTS_DEBUG_FFMPEG) console.error('[ffmpeg] failed', { code, stderr, args });
    try { fs.unlinkSync(outTmp); } catch { /* noop */ }
    // ตัด stderr แค่ 400 ตัว — เก็บข้อมูลพอวินิจฉัย แต่ไม่บวมจน UI โชว์ไม่ไหว
    const tail = (stderr || '').trim().slice(-400) || 'ไม่มี stderr';
    return { ok: false, error: `ffmpeg exit ${code}: ${tail}` };
  }
  try {
    fs.renameSync(outTmp, outputPath);
  } catch (err) {
    try { fs.unlinkSync(outTmp); } catch { /* noop */ }
    if (process.env.INKTTS_DEBUG_FFMPEG) console.error('[ffmpeg] rename failed', { err: err && err.message });
    return { ok: false, error: `rename output failed: ${err && err.message}` };
  }
  return { ok: true };
}

async function ffmpegConcatCopy(chunkPaths, listPath, outputPath) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) return { ok: false, error: 'ffmpeg binary ไม่พบในแอป' };
  if (!fs.existsSync(ffmpeg)) return { ok: false, error: `ffmpeg.exe ไม่อยู่ที่ ${ffmpeg}` };
  const { lines, validCount } = buildConcatLines(chunkPaths);
  if (!validCount) return { ok: false, error: 'ไม่มี chunk ที่ใช้ได้' };
  try {
    fs.writeFileSync(listPath, lines + '\n', 'utf-8');
  } catch (err) {
    return { ok: false, error: `เขียน list.txt ไม่ได้: ${err && err.message}` };
  }
  const outTmp = makeOutTmp(outputPath);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outTmp];
  const { code, stderr } = await run(ffmpeg, args);
  if (code !== 0) {
    try { fs.unlinkSync(outTmp); } catch { /* noop */ }
    const tail = (stderr || '').trim().slice(-400) || 'ไม่มี stderr';
    return { ok: false, error: `ffmpeg exit ${code}: ${tail}` };
  }
  try { fs.renameSync(outTmp, outputPath); }
  catch (err) {
    try { fs.unlinkSync(outTmp); } catch { /* noop */ }
    return { ok: false, error: `rename failed: ${err && err.message}` };
  }
  return { ok: true };
}

module.exports = { ffmpegConcat, ffmpegConcatCopy };
