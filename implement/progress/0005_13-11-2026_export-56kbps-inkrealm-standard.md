# 0005 — ไฟล์เสียงที่รวม/เปลี่ยนความเร็ว ส่งออกตามมาตรฐาน INKREALM (56 kbps โมโน 24 kHz) — 13-11-2026

**สั่ง:** Pete 13-11-2026 "แก้ inktts + release ได้เลย" (ต่อจากตรวจค่าใช้จ่าย R2 ของ INKREALM)

## ปัญหา

- `ffmpegConcat` (รวม chunk / เปลี่ยนความเร็ว / ส่งออก m4a) เข้ารหัสที่ `-b:a 128k` — AAC ของ ffmpeg ที่ 24 kHz โมโนออกจริง ~90 kbps
- เว็บ INKREALM รับไฟล์เสียงไม่เกิน 64 kbps โดยไม่ต้องแปลง → ไฟล์จาก INKTTS ทุกไฟล์ต้องให้เครื่องแปลงของเว็บแปลงใหม่
  (prod 7 วันถึง 12-11-2026: แปลง 101,501 ไฟล์ 802 → 517 GiB · กลุ่มต้นทาง 92 kbps หลายบัญชี ตรงกับค่าที่ INKTTS ส่งออก)

## แก้

- `electron/tts/ffmpeg.cjs`: `encodeArgs(fmt)` = `-ac 1 -ar 24000 -b:a 56k` (aac สำหรับ m4a · libmp3lame สำหรับ mp3) — ค่าเดียวกับตัวแปลงของเว็บ
  (INKREALM `scripts/audio-transcode/lib/encodeProfile.mjs` 56 kbps · 24 kHz)
- ทางคัดลอก (`ffmpegConcatCopy` · mp3 ไม่เปลี่ยนความเร็ว) ไม่แตะ — ต้นทาง Edge 48 kbps / Bing 32 kbps อยู่ในมาตรฐานอยู่แล้ว
- เทสต์ `electron/__tests__/exportProfile.test.mjs` (3 ข้อ) ตรึงค่า + ≤ 64 kbps · ≤ 32 kHz

## ตรวจ

| อะไร | ผล |
|---|---|
| `pnpm test` | 5 ไฟล์ · 34 ผ่าน |
| `pnpm smoke:merge` | 3 กลุ่ม ผ่าน 0 ล้ม |
| `pnpm smoke:tts edge` (ลบไฟล์เดิมก่อนให้สร้างใหม่) | `aac 24000 Hz 1 ch 52,314 bps` · 79,258 bytes (เดิม 89,657 bps · 134,462 bytes · −41%) |
