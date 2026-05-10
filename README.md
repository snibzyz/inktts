# INKTTS — แปลงข้อความภาษาไทยเป็นเสียง

โปรแกรม batch TTS ภาษาไทย หน้าตา VS Code Dark+ แปลงไฟล์ `.txt` เป็น `.m4a`
ใช้บริการ cloud TTS ฟรี 3 ตัว ไม่ต้องใช้ API key.

![INKTTS](inktts.png)

## ใช้งานคลิกเดียว (.exe)

1. โหลด `INKTTS.exe` (build แล้วใน `dist/INKTTS.exe`)
2. วางไว้ที่โฟลเดอร์ไหนก็ได้ — โปรแกรมจะใช้โฟลเดอร์ข้าง ๆ มันเป็น working dir
3. เอาไฟล์ `.txt` ภาษาไทยใส่ในโฟลเดอร์ `input/` (สร้างให้อัตโนมัติ)
4. ดับเบิลคลิก `INKTTS.exe` → เลือกบริการ → กด **เริ่มแปลงเสียง**
5. ผลลัพธ์ `.m4a` อยู่ใน `output/<service>/`

ไม่ต้องลง Python, ไม่ต้องลง ffmpeg — ฝังมาในตัว `.exe` หมดแล้ว.

## บริการ TTS

| บริการ | คุณภาพ | ความเสถียร | หมายเหตุ |
|--------|--------|------------|----------|
| ⭐ **Microsoft Edge** | Neural (Premwadee / Niwat) | ปานกลาง | คุณภาพดีที่สุด |
| 🌐 **Google Translate** | Standard | **เสถียรที่สุด** | ใช้งานต่อเนื่องได้นาน |
| 🎙 **ResponsiveVoice** | Standard | ปานกลาง | เลือกเพศชาย/หญิงได้ |

## โหมดนักพัฒนา (รัน Python)

```bash
pip install -r requirements.txt   # customtkinter, edge-tts, aiohttp, pillow
python main.py                    # หรือ python app.py
```

ต้องมี `ffmpeg` ใน PATH (โหมด dev เท่านั้น — .exe ฝังมาในตัว)

## Build .exe เอง

```bash
pip install pyinstaller pillow
python -m PyInstaller INKTTS.spec --noconfirm
# ได้ dist/INKTTS.exe ขนาด ~78 MB
```

PyInstaller จะหา `ffmpeg.exe` จาก `PATH` ของเครื่องที่ build อัตโนมัติ
(ถ้าเป็น chocolatey shim 392 KB จะไปดึงตัวจริงจาก
`C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe`)

## โครงสร้างโปรเจ็กต์

```
INKTTS/
├── app.py              GUI หลัก (CustomTkinter, dark theme)
├── main.py             entry-point สำหรับ python main.py
├── INKTTS.spec         PyInstaller config — ฝัง ffmpeg + scripts
├── inktts.ico/.png     ไอคอนโปรแกรม
├── scripts/            สคริปต์ TTS แต่ละบริการ
│   ├── _lib.py           orchestration ร่วม (split, concat, retry)
│   ├── edge.py           Microsoft Edge Read Aloud
│   ├── google.py         Google Translate TTS
│   ├── responsivevoice.py
│   └── merge_groups.py   tool รวม chunk เก่า
├── docs/               เอกสารอ้างอิงเชิงลึก
├── input/              ไฟล์ .txt ที่ต้องการแปลง (gitignored)
├── output/             ไฟล์เสียง .m4a (gitignored)
├── _cache/             chunk ระหว่าง process (gitignored)
└── .test/              smoke tests + fixtures
```

## หลัก 3 ปุ่มหลัก

| ปุ่ม | ความหมาย | ค่าแนะนำ |
|------|----------|----------|
| **จำนวนไฟล์ต่อรอบ** | กี่ไฟล์ที่ทำงานพร้อมกันใน 1 รอบ | 10 (Edge) / 1 (Google, RV) |
| **การเชื่อมต่อต่อไฟล์** | กี่ HTTP requests ต่อ 1 ไฟล์พร้อมกัน | 2-4 |
| **พรีเซต** | ค่าผสมที่ปรับมาแล้ว (เร็วสุด / batch / ปลอดภัย) | ⭐ ที่เลือกตอนเริ่ม |

อ่านรายละเอียดในเอกสาร [`docs/terminology.md`](docs/terminology.md) และ
[`docs/optimal_strategy.md`](docs/optimal_strategy.md).
