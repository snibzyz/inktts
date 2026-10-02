// natural sort ชื่อไฟล์ — "2" ต้องมาก่อน "10"
// (string sort ปกติได้ 1, 10, 100, 101 … 109, 11, 12 … → ทำเสียงผิดลำดับตอน)

const path = require('node:path');

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareNatural(a, b) {
  return collator.compare(a, b);
}

// เรียง path ตามชื่อไฟล์ก่อน (ไฟล์เลือกจากคนละโฟลเดอร์ก็ยังเรียงตามตอน) — ชื่อเท่ากันค่อยดู path เต็ม
function sortPathsNatural(paths) {
  return [...paths].sort((a, b) =>
    collator.compare(path.basename(a), path.basename(b))
    || collator.compare(a, b)
    || (a < b ? -1 : a > b ? 1 : 0));
}

module.exports = { compareNatural, sortPathsNatural };
