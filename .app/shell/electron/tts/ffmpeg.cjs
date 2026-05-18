const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getFfmpegPath, getFfmpegPathDiagnostic } = require('../helpers/paths.cjs');
const { createLogger } = require('../helpers/logger.cjs');

const log = createLogger('ffmpeg');

function run(cmd, args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    p.stderr.on('data', (c) => { stderr += c.toString(); });
    p.on('close', (code) => resolve({ code, stderr, durationMs: Date.now() - t0, spawnError: null }));
    p.on('error', (err) => resolve({ code: -1, stderr: err.message, durationMs: Date.now() - t0, spawnError: err.code || err.message }));
  });
}

// ffmpeg concat demuxer format: file 'path' — single quote เป็น quote เดียวที่รองรับ
// ถ้า path เองมี ' ต้อง escape เป็น '\'' (close-escape-open) → ไม่งั้น syntax error
// + กรอง chunk ที่หายไป/ขนาดเล็กเกินไป กัน ffmpeg fail ทั้งไฟล์เพราะ chunk เดียว
function buildConcatLines(chunkPaths) {
  const valid = [];
  const rejected = []; // เก็บไว้ส่งกลับใน diagnostic เผื่อ user ต้องดู
  for (const p of chunkPaths) {
    try {
      const st = fs.statSync(p);
      if (st.size > 1024) valid.push(p);
      else rejected.push({ path: p, reason: `size ${st.size} < 1024` });
    } catch (err) {
      rejected.push({ path: p, reason: err && err.code ? err.code : (err && err.message) });
    }
  }
  const escape = (p) => path.resolve(p).replace(/\\/g, '/').replace(/'/g, "'\\''");
  return { lines: valid.map((p) => `file '${escape(p)}'`).join('\n'), validCount: valid.length, rejected };
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

// short preview ของ list.txt: บรรทัดแรก 5 + บรรทัดสุดท้าย 5 + total — กัน log บวมเมื่อ 1000 chunks
function previewLines(text, head = 5, tail = 5) {
  const all = text.split('\n').filter(Boolean);
  if (all.length <= head + tail) return all;
  return [...all.slice(0, head), `... (${all.length - head - tail} more) ...`, ...all.slice(-tail)];
}

// คืน { ok, error, details? } — error เป็น string สั้น ๆ บอกเหตุที่ fail
// details = { reason, ffmpegPath, argv, listPreview, validChunks, rejectedSample, stderr, exitCode, durationMs, spawnError }
// (ก่อนหน้านี้คืน bool → user เห็นแค่ "รวมเสียงพลาด" ไม่รู้ว่าเพราะอะไร)
async function ffmpegConcat(chunkPaths, listPath, outputPath, fmt, tempo = 1.0) {
  const t0 = Date.now();
  const ffmpeg = getFfmpegPath();
  const stem = path.basename(outputPath, path.extname(outputPath));
  if (!ffmpeg) {
    const diag = getFfmpegPathDiagnostic();
    const error = 'ffmpeg binary ไม่พบในแอป (asar.unpacked หาย/antivirus ลบ)';
    log.error('concat: no ffmpeg path resolved', { stem, diagnostic: diag });
    return { ok: false, error, details: { reason: 'ffmpeg-path-null', ffmpegPath: null, diagnostic: diag } };
  }
  let ffmpegStat = null;
  try { ffmpegStat = fs.statSync(ffmpeg); }
  catch (err) {
    const error = `ffmpeg.exe ไม่อยู่ที่ ${ffmpeg}`;
    const diag = getFfmpegPathDiagnostic();
    log.error('concat: ffmpeg path not stat-able', { stem, ffmpeg, statErr: err && err.message, diagnostic: diag });
    return { ok: false, error, details: { reason: 'ffmpeg-stat-failed', ffmpegPath: ffmpeg, statError: err && err.message, diagnostic: diag } };
  }
  if (!ffmpegStat.isFile()) {
    const error = `ffmpeg path ไม่ใช่ไฟล์ปกติ: ${ffmpeg}`;
    log.error('concat: ffmpeg not a regular file', { stem, ffmpeg, mode: ffmpegStat.mode });
    return { ok: false, error, details: { reason: 'ffmpeg-not-file', ffmpegPath: ffmpeg, mode: ffmpegStat.mode } };
  }
  const { lines, validCount, rejected } = buildConcatLines(chunkPaths);
  log.info('concat: prepare', {
    stem, ffmpeg, ffmpegSize: ffmpegStat.size, totalChunks: chunkPaths.length,
    validChunks: validCount, rejectedChunks: rejected.length,
    rejectedSample: rejected.slice(0, 3),
  });
  if (!validCount) {
    const error = 'ไม่มี chunk ที่ใช้ได้ (ทั้งหมดหายหรือเล็กกว่า 1KB)';
    log.error('concat: no valid chunks', { stem, totalChunks: chunkPaths.length, rejectedSample: rejected.slice(0, 10) });
    return { ok: false, error, details: { reason: 'no-valid-chunks', ffmpegPath: ffmpeg, totalChunks: chunkPaths.length, rejectedSample: rejected.slice(0, 10) } };
  }
  try {
    fs.writeFileSync(listPath, lines + '\n', 'utf-8');
  } catch (err) {
    const error = `เขียน list.txt ไม่ได้: ${err && err.message}`;
    log.error('concat: write list.txt failed', { stem, listPath, err: err && err.message });
    return { ok: false, error, details: { reason: 'list-write-failed', ffmpegPath: ffmpeg, listPath, writeError: err && err.message } };
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
  const listPreview = previewLines(lines);
  const { code, stderr, durationMs, spawnError } = await run(ffmpeg, args);
  if (code !== 0) {
    if (process.env.INKTTS_DEBUG_FFMPEG) console.error('[ffmpeg] failed', { code, stderr, args });
    try { fs.unlinkSync(outTmp); } catch { /* noop */ }
    const tail = (stderr || '').trim().slice(-400) || 'ไม่มี stderr';
    const error = spawnError
      ? `ffmpeg spawn ล้มเหลว (${spawnError}): ${tail}`
      : `ffmpeg exit ${code}: ${tail}`;
    log.error('concat: ffmpeg failed', {
      stem, ffmpeg, exitCode: code, spawnError, durationMs,
      argv: args, listPreview, stderr: (stderr || '').trim().slice(-1200),
      validChunks: validCount,
    });
    return {
      ok: false,
      error,
      details: {
        reason: spawnError ? 'ffmpeg-spawn-failed' : 'ffmpeg-nonzero-exit',
        ffmpegPath: ffmpeg, ffmpegSize: ffmpegStat.size,
        exitCode: code, spawnError, durationMs,
        argv: args, listPreview, validChunks: validCount,
        stderr: (stderr || '').trim(),
      },
    };
  }
  try {
    fs.renameSync(outTmp, outputPath);
  } catch (err) {
    try { fs.unlinkSync(outTmp); } catch { /* noop */ }
    if (process.env.INKTTS_DEBUG_FFMPEG) console.error('[ffmpeg] rename failed', { err: err && err.message });
    const error = `rename output failed: ${err && err.message}`;
    log.error('concat: rename output failed', { stem, outTmp, outputPath, err: err && err.message });
    return { ok: false, error, details: { reason: 'rename-failed', ffmpegPath: ffmpeg, outTmp, outputPath, renameError: err && err.message } };
  }
  let outSize = 0;
  try { outSize = fs.statSync(outputPath).size; } catch { /* noop */ }
  log.info('concat: ok', {
    stem, fmt, validChunks: validCount, outputSize: outSize,
    ffmpegDurationMs: durationMs, totalDurationMs: Date.now() - t0,
  });
  return { ok: true };
}

async function ffmpegConcatCopy(chunkPaths, listPath, outputPath) {
  const t0 = Date.now();
  const ffmpeg = getFfmpegPath();
  const stem = path.basename(outputPath, path.extname(outputPath));
  if (!ffmpeg) {
    const diag = getFfmpegPathDiagnostic();
    log.error('concatCopy: no ffmpeg path resolved', { stem, diagnostic: diag });
    return { ok: false, error: 'ffmpeg binary ไม่พบในแอป', details: { reason: 'ffmpeg-path-null', ffmpegPath: null, diagnostic: diag } };
  }
  let ffmpegStat = null;
  try { ffmpegStat = fs.statSync(ffmpeg); }
  catch (err) {
    log.error('concatCopy: ffmpeg not stat-able', { stem, ffmpeg, err: err && err.message });
    return { ok: false, error: `ffmpeg.exe ไม่อยู่ที่ ${ffmpeg}`, details: { reason: 'ffmpeg-stat-failed', ffmpegPath: ffmpeg, statError: err && err.message } };
  }
  const { lines, validCount, rejected } = buildConcatLines(chunkPaths);
  log.info('concatCopy: prepare', { stem, ffmpeg, totalChunks: chunkPaths.length, validChunks: validCount, rejectedChunks: rejected.length });
  if (!validCount) {
    log.error('concatCopy: no valid chunks', { stem, totalChunks: chunkPaths.length });
    return { ok: false, error: 'ไม่มี chunk ที่ใช้ได้', details: { reason: 'no-valid-chunks', ffmpegPath: ffmpeg, totalChunks: chunkPaths.length, rejectedSample: rejected.slice(0, 10) } };
  }
  try {
    fs.writeFileSync(listPath, lines + '\n', 'utf-8');
  } catch (err) {
    log.error('concatCopy: write list.txt failed', { stem, listPath, err: err && err.message });
    return { ok: false, error: `เขียน list.txt ไม่ได้: ${err && err.message}`, details: { reason: 'list-write-failed', ffmpegPath: ffmpeg, listPath, writeError: err && err.message } };
  }
  const outTmp = makeOutTmp(outputPath);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outTmp];
  const listPreview = previewLines(lines);
  const { code, stderr, durationMs, spawnError } = await run(ffmpeg, args);
  if (code !== 0) {
    try { fs.unlinkSync(outTmp); } catch { /* noop */ }
    const tail = (stderr || '').trim().slice(-400) || 'ไม่มี stderr';
    const error = spawnError ? `ffmpeg spawn ล้มเหลว (${spawnError}): ${tail}` : `ffmpeg exit ${code}: ${tail}`;
    log.error('concatCopy: ffmpeg failed', { stem, ffmpeg, exitCode: code, spawnError, durationMs, argv: args, listPreview, stderr: (stderr || '').trim().slice(-1200) });
    return {
      ok: false,
      error,
      details: {
        reason: spawnError ? 'ffmpeg-spawn-failed' : 'ffmpeg-nonzero-exit',
        ffmpegPath: ffmpeg, ffmpegSize: ffmpegStat.size,
        exitCode: code, spawnError, durationMs,
        argv: args, listPreview, validChunks: validCount, stderr: (stderr || '').trim(),
      },
    };
  }
  try { fs.renameSync(outTmp, outputPath); }
  catch (err) {
    try { fs.unlinkSync(outTmp); } catch { /* noop */ }
    log.error('concatCopy: rename failed', { stem, outTmp, outputPath, err: err && err.message });
    return { ok: false, error: `rename failed: ${err && err.message}`, details: { reason: 'rename-failed', ffmpegPath: ffmpeg, outTmp, outputPath, renameError: err && err.message } };
  }
  let outSize = 0;
  try { outSize = fs.statSync(outputPath).size; } catch { /* noop */ }
  log.info('concatCopy: ok', { stem, validChunks: validCount, outputSize: outSize, ffmpegDurationMs: durationMs, totalDurationMs: Date.now() - t0 });
  return { ok: true };
}

module.exports = { ffmpegConcat, ffmpegConcatCopy };
