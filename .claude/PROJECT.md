# Project: Thai TTS Batch

แปลงไฟล์ .txt ภาษาไทย → .m4a โดยใช้ cloud TTS แบบฟรี (ไม่ต้องใช้ key, ไม่หนักเครื่อง)

## 3 service ที่รองรับ

| Service | Quality | Free | Speed (10 files) | Notes |
|---------|---------|------|------------------|-------|
| **Edge** ⭐ | Neural (Premwadee) | ✅ | **1:22** | แนะนำ — เร็วและคุณภาพสูงสุด |
| Google Translate | Standard | ✅ | 2:13 | shared session + chunk-chars=120 |
| ResponsiveVoice | Standard | ✅ scraped key | 7:48 (9/10) | scrape key + bal4web headers |

## Architecture สำคัญ

- **`_lib.py`** = orchestration ร่วม (batch_size, connections_per_file, rolling worker pool)
- **3 scripts** = `edge.py`, `google.py`, `responsivevoice.py` ใน `scripts/`
- **`ui/`** = Tkinter UI พร้อม preset (Tahoma font, modern theme)
- **`main.py`** = entry point เปิด UI

## Reverse-engineering breakthrough (สำหรับ RV)

ใช้ Wireshark + Fiddler ค้นพบว่า balabolka:
1. ใช้ endpoint `texttospeech.responsivevoice.org/v1/text:synthesize` (ไม่ใช่ `code.responsivevoice.org/getvoice.php` เก่า)
2. **Scrape API key สดจาก `responsivevoice.org/`** (ไม่ใช้ demo key)
3. ส่ง **User-Agent Android 4.1.2 มือถือเก่า** (rate limit ผ่อนกว่า)
4. ส่ง `Sec-Fetch-*` headers เลียนแบบ HTML5 audio request

แก้ตามนี้ทุกข้อ → RV ทำงานได้ที่ 9/10 success rate (จาก 0/10 เดิม)

## ดูเพิ่ม

- [docs/balabolka_internals.md](../docs/balabolka_internals.md) — analysis เต็ม
- [docs/best_settings.md](../docs/best_settings.md) — ค่า settings
- [docs/optimal_strategy.md](../docs/optimal_strategy.md) — กลยุทธ์
- [docs/terminology.md](../docs/terminology.md) — ศัพท์
