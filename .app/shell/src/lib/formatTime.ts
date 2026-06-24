// แปลงเวลาให้อ่านง่าย — แสดงเป็นนาฬิกา HH:MM:SS + แบบเต็มภาษาไทย (วิ/นาที/ชม.)
// (เลิกโชว์ "187.3s" ดิบ ๆ ที่อ่านยาก)
//
// formatClock(ms)    → "00:03:07" / "01:05:07"  (HH:MM:SS เสมอ — สำหรับ timer ที่เดินอยู่)
// formatDuration(ms) → "1 ชม. 5 นาที 7 วิ" / "3 นาที 7 วิ" / "45 วิ"  (ภาษาไทยเต็ม)
// formatEta(ms)      → "~3 นาที 7 วิ"  (เวลาที่คาดว่าเหลือ)

const pad = (n: number) => String(n).padStart(2, '0');

function parts(ms: number) {
  const totalSec = Math.round(ms / 1000);
  return {
    h: Math.floor(totalSec / 3600),
    m: Math.floor((totalSec % 3600) / 60),
    s: totalSec % 60,
    totalSec,
  };
}

// HH:MM:SS เสมอ — tabular-nums อ่านง่าย ใช้กับ timer ที่เดินสด
export function formatClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const { h, m, s } = parts(ms);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ภาษาไทยเต็ม — แยก ชม./นาที/วิ ให้ครบ เข้าใจง่าย
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const { h, m, s, totalSec } = parts(ms);
  if (totalSec === 0) return '<1 วิ';
  const out: string[] = [];
  if (h > 0) out.push(`${h} ชม.`);
  if (m > 0) out.push(`${m} นาที`);
  if (s > 0) out.push(`${s} วิ`);
  return out.join(' ');
}

export function formatEta(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  return `~${formatDuration(ms)}`;
}

/** คำนวณเวลาที่คาดว่าเหลือ จาก elapsed + จำนวนที่เสร็จ/ทั้งหมด (เฉลี่ยต่อชิ้น × ที่เหลือ) */
export function estimateRemaining(elapsedMs: number, done: number, total: number): number | null {
  if (done <= 0 || total <= 0 || done >= total) return null;
  const perItem = elapsedMs / done;
  return perItem * (total - done);
}
