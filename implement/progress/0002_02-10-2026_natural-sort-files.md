# 0002 · 02-10-2026 · ไฟล์ตอนเรียงผิด (1, 10, 100 … 109, 11) → natural sort

## อาการ
ผู้ใช้สร้างเสียงด้วย Bing (บริการใหม่ v2.1.0) แล้วตอนถูกทำ/แสดงเรียงเป็น 1 → 10 → 100 → 101 … 109 → 11.
ไม่ใช่บั๊กเฉพาะ Bing — ทุกบริการโดนเหมือนกัน แต่เห็นชัดตอนใช้ Bing (ไฟล์เยอะ + ทำหลายตอนพร้อมกัน).

## สาเหตุ
list ไฟล์ `.txt` ใช้ `.sort()` เปล่า (เรียงแบบตัวอักษร) ใน `tts/queue.cjs` `listTxt` + `ipc/fs.cjs` `fs:listInputFiles` / `fs:listGlob`.
ไฟล์ที่เลือกรายตัว (`fs:chooseFiles` / `inputFiles` ของคิว) ไม่ได้เรียงเลย — dialog คืนตามลำดับที่คลิก.
runner แจก slot ตามลำดับ `files` ที่ได้รับ (Semaphore FIFO) → ลำดับทำงาน + แถวใน UI ผิดตามไปด้วย.
(merge ใช้ natural sort อยู่แล้ว — ไม่โดน)

## สิ่งที่เปลี่ยน
- ใหม่ `.app/shell/electron/helpers/naturalSort.cjs` — `compareNatural` (Intl.Collator numeric) + `sortPathsNatural` (เรียงตามชื่อไฟล์ก่อน แล้วค่อย path เต็ม · ไม่แก้ array ต้นฉบับ)
- `tts/runner.cjs` — `TTSJob` เรียง `files` เองเสมอ (จุดเดียวที่ครอบทุกทาง: แท็บบริการ + คิว)
- `tts/queue.cjs` — `listTxt` + `resolveFiles` (inputFiles) ใช้ natural sort · `recordFileTime` เรียง `times` ตามตอน (มุมมองกาง)
- `ipc/fs.cjs` — `fs:listInputFiles`, `fs:listGlob`, `fs:chooseFiles` คืนแบบ natural sort (จำกัดจำนวนไฟล์ `limitN` จึงตัดได้ตอนที่ถูก)
- `tts/merge.cjs` — ใช้ `compareNatural` จาก helper แทน collator ของตัวเอง (พฤติกรรมเดิม)
- เทส: ใหม่ `electron/__tests__/naturalSort.test.mjs` (4 tests)

## ตรวจแล้ว
- `vitest run` 18/18 ผ่าน (naturalSort 4 + bing 14)
- `node --check` ไฟล์ที่แก้ทั้งหมดผ่าน
- `smoke-merge-cases.cjs` ผ่าน · `smoke-queue.cjs` 19/19 ผ่าน (edge/google/rv จริง)

## ยังไม่ได้ตรวจ
- ยังไม่ได้เปิดแอป Electron จริงดูลำดับแถวใน UI — ตรวจผ่านลำดับ `TTSJob.files` + FIFO slot แทน

## Release
- v2.1.1 (bump 2.1.0 -> 2.1.1 · auto-update ถึงผู้ใช้)

## INKIDEA (ตรวจคู่)
แท็บเสียงของ INKIDEA ไม่โดน — `useAudio.ts` `refreshFiles` เรียงด้วย `localeCompare('th', { numeric: true })` และ orchestrator ทำตามลำดับนั้น · chunk ใช้ `padStart(4)` · merge (`audioNames.cjs`) เรียงตามเลขตอน
