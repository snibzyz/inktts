// Port ของ merge_groups.py — รวม .m4a เป็นกลุ่มย่อย

const fs = require('node:fs');
const path = require('node:path');
const { ffmpegConcatCopy } = require('./ffmpeg.cjs');

async function mergeGroups({ srcDir, dstDir, prefix, start, end, group, ext = 'm4a', onLog }) {
  const log = onLog || (() => {});
  fs.mkdirSync(dstDir, { recursive: true });

  if (!Number.isFinite(group) || group < 1) group = 10;
  start = Math.max(1, Math.floor(Number(start) || 1));
  end = Math.max(start, Math.floor(Number(end) || start));

  let totalGroups = 0;
  let failed = 0;
  let i = start;
  while (i <= end) {
    const j = Math.min(i + group - 1, end);
    const groupFiles = [];
    const missing = [];
    for (let k = i; k <= j; k += 1) {
      const p = path.join(srcDir, `${prefix}${k}.${ext}`);
      if (fs.existsSync(p)) groupFiles.push(p);
      else missing.push(k);
    }
    if (!groupFiles.length) {
      log('skip', `${i}-${j} no files`);
      i = j + 1;
      continue;
    }
    const outName = `${prefix}${i}-${j}.${ext}`;
    const outPath = path.join(dstDir, outName);
    if (missing.length) log('warn', `${i}-${j} missing: ${missing.join(', ')}`);
    const listPath = path.join(dstDir, `.list-${i}-${j}.txt`);
    let ok = false;
    try {
      ok = await ffmpegConcatCopy(groupFiles, listPath, outPath);
    } catch (err) {
      log('error', `${outName}: ${err.message}`);
    } finally {
      try { fs.unlinkSync(listPath); } catch { /* noop */ }
    }
    if (ok) {
      log('ok', `${outName} (${groupFiles.length} files)`);
      totalGroups += 1;
    } else {
      log('error', `${outName} failed`);
      failed += 1;
    }
    i = j + 1;
  }
  log('info', `merged ${totalGroups} groups, ${failed} failed`);
  return { totalGroups, failed };
}

// Auto-detect prefix and range from a folder of <prefix><num>.<ext> files
function detectPrefixRange(srcDir, ext = 'm4a') {
  if (!fs.existsSync(srcDir)) return null;
  const all = fs.readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith(`.${ext}`));
  if (!all.length) return null;
  // Match the trailing number before extension
  const re = /^(.*?)(\d+)\.[^.]+$/;
  const groups = new Map();
  for (const name of all) {
    const m = re.exec(name);
    if (!m) continue;
    const [, pref, numStr] = m;
    if (!groups.has(pref)) groups.set(pref, []);
    groups.get(pref).push(parseInt(numStr, 10));
  }
  if (!groups.size) return null;
  let bestPrefix = null;
  let bestNums = [];
  for (const [pref, nums] of groups.entries()) {
    if (nums.length > bestNums.length) {
      bestPrefix = pref;
      bestNums = nums;
    }
  }
  bestNums.sort((a, b) => a - b);
  return {
    prefix: bestPrefix,
    start: bestNums[0],
    end: bestNums[bestNums.length - 1],
    count: bestNums.length,
  };
}

module.exports = { mergeGroups, detectPrefixRange };
