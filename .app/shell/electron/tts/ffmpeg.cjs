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

async function ffmpegConcat(chunkPaths, listPath, outputPath, fmt, tempo = 1.0) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) throw new Error('ffmpeg not bundled');
  const lines = chunkPaths
    .map((p) => `file '${path.resolve(p).replace(/\\/g, '/')}'`)
    .join('\n');
  fs.writeFileSync(listPath, lines + '\n', 'utf-8');

  const baseArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath];
  const needsAtempo = Math.abs(tempo - 1.0) >= 0.001;
  let args;
  if (fmt === 'mp3' && !needsAtempo) {
    args = [...baseArgs, '-c', 'copy', outputPath];
  } else {
    const codec = fmt === 'm4a' ? ['-c:a', 'aac', '-b:a', '128k'] : ['-c:a', 'libmp3lame', '-b:a', '128k'];
    const atempo = needsAtempo ? ['-filter:a', `atempo=${tempo}`] : [];
    args = [...baseArgs, ...atempo, ...codec, outputPath];
  }
  const { code, stderr } = await run(ffmpeg, args);
  if (code !== 0 && process.env.INKTTS_DEBUG_FFMPEG) {
    console.error('[ffmpeg] failed', { code, stderr, args });
  }
  return code === 0;
}

async function ffmpegConcatCopy(chunkPaths, listPath, outputPath) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) throw new Error('ffmpeg not bundled');
  const lines = chunkPaths
    .map((p) => `file '${path.resolve(p).replace(/\\/g, '/')}'`)
    .join('\n');
  fs.writeFileSync(listPath, lines + '\n', 'utf-8');
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath];
  const { code } = await run(ffmpeg, args);
  return code === 0;
}

module.exports = { ffmpegConcat, ffmpegConcatCopy };
