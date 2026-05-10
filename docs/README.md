# TTS API Reference

เอกสารวิธีเรียก TTS API ต่างๆ — เน้นภาษาไทย, batch processing, ใช้ฟรี

> 🚀 **อ่านนี่ก่อน**: [optimal_strategy.md](optimal_strategy.md) — วิธีเร็วที่สุด ทดสอบจริงแล้ว (54× realtime)
>
> 🔍 **Reverse-engineering**: [balabolka_internals.md](balabolka_internals.md) — วิเคราะห์ balabolka/bal4web ด้วย Fiddler+Wireshark
>
> ⚙️ **ตาราง settings**: [best_settings.md](best_settings.md) — ค่า batch/conn ที่ดีที่สุดต่อ API

## 3 API ที่รองรับ

| API | คุณภาพ | ฟรี | Script |
|-----|--------|-----|--------|
| [edge_tts.md](edge_tts.md) ⭐ | **Neural** (Premwadee/Niwat) | ✅ ไม่ต้อง key | [`scripts/edge_tts.py`](../scripts/edge_tts.py) |
| [google_translate_tts.md](google_translate_tts.md) | Standard | ✅ ไม่ต้อง key | [`scripts/google_tts.ps1`](../scripts/google_tts.ps1) |
| [responsivevoice.md](responsivevoice.md) | Standard | ✅ (demo key) | [`scripts/responsivevoice.py`](../scripts/responsivevoice.py) |

## Backend ที่อยู่เบื้องหลัง

```
                ┌──────────────────────┐
                │  Google Translate    │  ← standard quality, ฟรี
                │  TTS endpoint        │
                └──────────┬───────────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
     ResponsiveVoice              google_tts.ps1
     (proxy ผ่าน getvoice.php)    (เรียกตรง)


                ┌──────────────────────┐
                │  Azure Speech        │  ← neural quality (Premwadee)
                │  Service             │
                └──────────┬───────────┘
                           │
                edge-tts (Edge Read Aloud)
                (ฟรี ผ่าน TrustedClientToken)
```

## Dependencies

| Tool | จำเป็นสำหรับ |
|------|------------|
| Python 3.8+ | `edge_tts.py`, `responsivevoice.py` |
| `pip install edge-tts` | `edge_tts.py` |
| ffmpeg (ใน PATH) | ทุก script |
| PowerShell 5+ | `google_tts.ps1` |

## คำสั่งเริ่มต้น

```bash
# 🚀 วิธีดีที่สุด — Premwadee neural, 54× realtime
python scripts/edge_tts.py "input/*.txt" -o output

# ทดสอบเร็วๆ ไม่ต้องติดตั้งอะไร (PowerShell)
.\scripts\google_tts.ps1 -MaxFiles 1
```

## โครงสร้างโปรเจกต์

```
balabolka/
├── scripts/         ← script ทั้งหมด
├── docs/            ← เอกสารนี้
├── input/           ← ไฟล์ .txt ต้นฉบับ
└── output/          ← ไฟล์ .m4a ผลลัพธ์
```
