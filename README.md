# INKTTS — แปลงข้อความภาษาไทยเป็นเสียง

โปรแกรม batch TTS ภาษาไทย Electron + React UI ตระกูลเดียวกับ INKIDEA / INKCRAW
แปลงไฟล์ `.txt` → `.m4a` ผ่าน 3 บริการฟรี ไม่ต้องใช้ API key

![INKTTS](inktts.png)

## การใช้งาน (Dev)

```bash
pnpm install   # หรือ install.bat
pnpm dev       # หรือ start.bat
```

ต้องมี Node.js 20+ และ pnpm

## บริการ TTS

| บริการ | คุณภาพ | ความเสถียร | หมายเหตุ |
|--------|--------|------------|----------|
| ⭐ Microsoft Edge | Neural (Premwadee / Niwat) | ปานกลาง | คุณภาพดีที่สุด |
| 🌐 Google Translate | Standard | เสถียรที่สุด | ใช้งานต่อเนื่องได้นาน |
| 🎙 ResponsiveVoice | Standard | ปานกลาง | เลือกเพศชาย/หญิงได้ |

## โครงสร้าง

```
INKTTS/
├── .app/
│   └── shell/             ← Electron + React (1 เดียว)
│       ├── electron/      ← main process + IPC + TTS engine
│       └── src/           ← renderer (React)
├── input/                 ← วาง .txt ที่จะแปลง
├── output/                ← .m4a ที่แปลงเสร็จ
├── inktts.ico / inktts.png
├── start.bat / install.bat
└── package.json (workspace)
```

## Build

```bash
pnpm package:win   # → release/INKTTS-Portable-<version>.exe
```

## Auto-update

Portable .exe รองรับ auto-update ผ่าน custom helper-cmd swap
(เช็ค GitHub release ใหม่ทุก 30 นาที — ถ้ามีจะดาวน์โหลดและ swap แทนตัวเองอัตโนมัติ)

## หลัก 3 ปุ่มหลัก (ตั้งค่าขั้นสูง)

| ปุ่ม | ความหมาย | ค่าแนะนำ |
|------|----------|----------|
| จำนวนไฟล์ต่อรอบ | กี่ไฟล์ที่ทำงานพร้อมกันใน 1 รอบ | 10 (Edge) / 1 (Google, RV) |
| การเชื่อมต่อต่อไฟล์ | กี่ HTTP requests ต่อ 1 ไฟล์พร้อมกัน | 2-4 |
| พรีเซต | ค่าผสมที่ปรับมาแล้ว (เร็วสุด / batch / ปลอดภัย) | ⭐ ที่เลือกตอนเริ่ม |
