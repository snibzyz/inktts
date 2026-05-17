// Port ของ merge_groups.py — รวม .m4a เป็นกลุ่มย่อย

const fs = require('node:fs');
const path = require('node:path');
const { ffmpegConcatCopy } = require('./ffmpeg.cjs');

// Anchor ที่ "เลขชุดแรก" ของชื่อไฟล์ (หลังตัด extension ออก)
// — รองรับทุก position ของ index: ขึ้นต้น (0001_xxx.m4a), กลาง (ep01_v2.m4a),
//   หรือท้าย (chapter 1.m4a) ก็ได้ ทำให้ filename ที่มีเลขอยู่หัวไม่ถูกจับเลขทิ้งท้ายเป็น index ผิด
// — group ด้วย "ส่วนที่อยู่ก่อนเลขชุดแรก" (prefix) เท่านั้น suffix หลังเลขปล่อยให้ต่างได้
//   เช่น `0001_NNN NNNN_text.m4a` กับ `0002_NNN NNNN_text.m4a` group เดียวกัน prefix=''
function parseIndex(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 1) return null;
  const stem = name.slice(0, dot);
  const ext = name.slice(dot + 1);
  // หา first digit run ใน stem
  const m = /^(\D*?)(\d+)(.*)$/.exec(stem);
  if (!m) return null;
  return { prefix: m[1], numStr: m[2], num: parseInt(m[2], 10), suffix: m[3], ext };
}

async function mergeGroups({ srcDir, dstDir, prefix, start, end, group, ext = 'm4a', onLog }) {
  const log = onLog || (() => {});
  fs.mkdirSync(dstDir, { recursive: true });

  if (!Number.isFinite(group) || group < 1) group = 10;
  start = Math.max(1, Math.floor(Number(start) || 1));
  end = Math.max(start, Math.floor(Number(end) || start));

  // สแกนโฟลเดอร์ต้นทาง สร้าง map number → actual filename โดยใช้ index = เลขชุดแรก
  // ตรง prefix → ใช้ได้ทุกแบบ padding (001.m4a, EP01.m4a, 0001_xxx.m4a, บทที่ 001.m4a)
  const numToFile = new Map();
  try {
    for (const name of fs.readdirSync(srcDir)) {
      const info = parseIndex(name);
      if (!info) continue;
      if (info.prefix !== prefix) continue;
      if (info.ext.toLowerCase() !== ext.toLowerCase()) continue;
      if (!numToFile.has(info.num)) numToFile.set(info.num, path.join(srcDir, name));
    }
  } catch { /* noop */ }

  let totalGroups = 0;
  let failed = 0;
  let i = start;
  while (i <= end) {
    const j = Math.min(i + group - 1, end);
    const groupFiles = [];
    const missing = [];
    for (let k = i; k <= j; k += 1) {
      const p = numToFile.get(k);
      if (p) groupFiles.push(p);
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
    let result = { ok: false, error: 'unknown' };
    try {
      result = await ffmpegConcatCopy(groupFiles, listPath, outPath);
    } catch (err) {
      result = { ok: false, error: err && err.message };
    } finally {
      try { fs.unlinkSync(listPath); } catch { /* noop */ }
    }
    if (result.ok) {
      log('ok', `${outName} (${groupFiles.length} files)`);
      totalGroups += 1;
    } else {
      log('error', `${outName} failed — ${result.error}`);
      failed += 1;
    }
    i = j + 1;
  }
  log('info', `merged ${totalGroups} groups, ${failed} failed`);
  return { totalGroups, failed };
}

// Auto-detect prefix + range จากไฟล์ <prefix><num><suffix>.<ext>
// — group โดย prefix (ก่อนเลขชุดแรก) เท่านั้น ไม่ต้องสนใจ suffix
// — ปกป้องเคส suffix ต่างกันต่อไฟล์ (เช่น 0001_aaa.m4a + 0002_bbb.m4a) ให้ยัง group เดียวกัน
function detectPrefixRange(srcDir, ext = 'm4a') {
  if (!fs.existsSync(srcDir)) return null;
  const lcExt = ext.toLowerCase();
  const all = fs.readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith(`.${lcExt}`));
  if (!all.length) return null;
  const groups = new Map();
  for (const name of all) {
    const info = parseIndex(name);
    if (!info) continue;
    if (info.ext.toLowerCase() !== lcExt) continue;
    if (!groups.has(info.prefix)) groups.set(info.prefix, []);
    groups.get(info.prefix).push(info.num);
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
