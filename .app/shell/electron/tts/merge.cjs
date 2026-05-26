// รวมไฟล์เสียงเป็นกลุ่มย่อย
//
// หลักการ: ไม่ parse / ไม่ match ชื่อไฟล์ — แค่ "นับไฟล์ + เรียงตามชื่อ (natural sort) + แบ่งกลุ่ม"
//   · ไฟล์ต้นทางชื่ออะไรก็ได้ — เอาทุกไฟล์ที่นามสกุลตรง มาเรียงแล้วแบ่งกลุ่มตามจำนวน
//   · ชื่อไฟล์ผลลัพธ์ผู้ใช้กำหนดเอง — outPrefix + เลขเริ่ม (start)
//   · detectAudioFiles = autodetect "เดา" ค่าเริ่มต้นให้ UI (count + start + prefix)
//     เป็นแค่ค่าแนะนำ — ผู้ใช้แก้ได้ทุกค่า และ mergeGroups ไม่ได้พึ่งค่าเดาเหล่านี้

const fs = require('node:fs');
const path = require('node:path');
const { ffmpegConcatCopy } = require('./ffmpeg.cjs');

// natural sort — "ตอน 2" ต้องมาก่อน "ตอน 10" (string sort ปกติจะได้ 10 ก่อน 2)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// คืน list ชื่อไฟล์ที่นามสกุลตรง เรียงแบบ natural sort
function listAudioFiles(srcDir, ext) {
  const suffix = `.${String(ext || 'm4a').toLowerCase()}`;
  let names;
  try {
    names = fs.readdirSync(srcDir);
  } catch {
    return [];
  }
  return names
    .filter((f) => f.toLowerCase().endsWith(suffix))
    // ข้าม macOS AppleDouble metadata files (._*) ที่ Finder สร้างบน exFAT/FAT32
    // ไฟล์พวกนี้ไม่มี audio data จริง ffmpeg จะฟ้อง "moov atom not found"
    .filter((f) => !f.startsWith('._'))
    .sort((a, b) => collator.compare(a, b));
}

// autodetect — best-effort เดาค่าเริ่มต้นให้ UI จากไฟล์แรก (หลังเรียงแล้ว)
//   count  = จำนวนไฟล์จริง (แน่นอน)
//   start  = เลขชุดแรกที่เจอในชื่อไฟล์แรก (เดา) — ไม่เจอ → 1
//   prefix = ข้อความก่อนเลขนั้น (เดาเป็นค่าเริ่มต้นของ outPrefix) — ไม่เจอ → ''
// ทุกค่าเป็นแค่ "ค่าแนะนำ" ผู้ใช้แก้ทับได้ — merge จริงไม่พึ่งค่าเหล่านี้
function detectAudioFiles(srcDir, ext = 'm4a') {
  const files = listAudioFiles(srcDir, ext);
  if (!files.length) return null;
  const firstStem = files[0].replace(/\.[^.]+$/, '');
  const m = /^(.*?)(\d+)/.exec(firstStem);
  const start = m ? parseInt(m[2], 10) : 1;
  const prefix = m ? m[1] : '';
  return { count: files.length, start, end: start + files.length - 1, prefix };
}

async function mergeGroups({ srcDir, dstDir, outPrefix, prefix, start, end, group, ext = 'm4a', onLog }) {
  const log = onLog || (() => {});
  fs.mkdirSync(dstDir, { recursive: true });

  // outPrefix = คำนำหน้าไฟล์ผลลัพธ์ (รับ `prefix` เป็น fallback เพื่อ backward-compat)
  const namePrefix = outPrefix != null ? outPrefix : (prefix != null ? prefix : '');
  if (!Number.isFinite(group) || group < 1) group = 10;
  start = Math.max(1, Math.floor(Number(start) || 1));
  end = Math.floor(Number(end) || 0);

  // เอาทุกไฟล์ที่นามสกุลตรง เรียงตามชื่อ — ไม่สนใจว่าชื่ออะไร
  const files = listAudioFiles(srcDir, ext);
  if (!files.length) {
    log('info', `ไม่พบไฟล์ .${ext} ในโฟลเดอร์`);
    log('info', 'merged 0 groups, 0 failed');
    return { totalGroups: 0, failed: 0 };
  }

  // end เป็นตัวจำกัดจำนวนแบบไม่บังคับ: รวม (end-start+1) ไฟล์แรก
  // ถ้า end ไม่ valid (เช่น ผู้ใช้แก้ start แล้วลืมแก้ end) → รวมทุกไฟล์
  const wanted = end >= start ? end - start + 1 : files.length;
  const selected = files.slice(0, Math.min(wanted, files.length));
  log('info', `พบ ${files.length} ไฟล์ — จะรวม ${selected.length} ไฟล์ กลุ่มละ ${group} ตอน`);

  let totalGroups = 0;
  let failed = 0;
  for (let offset = 0; offset < selected.length; offset += group) {
    const chunk = selected.slice(offset, offset + group);
    const n1 = start + offset;
    const n2 = start + offset + chunk.length - 1;
    const outName = `${namePrefix}${n1}-${n2}.${ext}`;
    const outPath = path.join(dstDir, outName);
    const listPath = path.join(dstDir, `.list-${n1}-${n2}.txt`);
    const groupFiles = chunk.map((name) => path.join(srcDir, name));
    let result = { ok: false, error: 'unknown' };
    try {
      result = await ffmpegConcatCopy(groupFiles, listPath, outPath);
    } catch (err) {
      result = { ok: false, error: err && err.message };
    } finally {
      try { fs.unlinkSync(listPath); } catch { /* noop */ }
    }
    if (result.ok) {
      log('ok', `${outName} (${chunk.length} files)`);
      totalGroups += 1;
    } else {
      log('error', `${outName} failed — ${result.error}`);
      failed += 1;
    }
  }
  log('info', `merged ${totalGroups} groups, ${failed} failed`);
  return { totalGroups, failed };
}

module.exports = { mergeGroups, detectAudioFiles };
