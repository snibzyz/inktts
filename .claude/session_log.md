# Session log — สรุปสิ่งที่ทำ (28 เม.ย. 2026)

## ขั้นตอนหลัก ตามลำดับเวลา

### 1. เริ่มจาก ResponsiveVoice API
- ค้นพบ endpoint `https://code.responsivevoice.org/getvoice.php`
- ดึง `responsivevoice.js` จาก code.responsivevoice.org เพื่อ reverse param
- ทดสอบ Thai TTS ที่ chapter 1-5 ของ "สยบภพด้วยคมดาบ"

### 2. สร้าง edge-tts (Microsoft Edge Read Aloud)
- ใช้ Premwadee Neural ฟรีผ่าน edge-tts library
- Achieved 54× realtime (5 files in 40s) ที่ batch=10 conn=2
- **เป็น service ที่ดีที่สุด** สำหรับงานนี้

### 3. Refactor architecture
- เริ่มที่ `batch_edge_tts.py` ซับซ้อน
- ปรับเป็น `_lib.py` shared + 3 thin wrappers
- ตั้ง terminology ใหม่: `batch_size`, `connections_per_file`, `lines_per_chunk`
- Rolling worker pool (ไม่รอทั้ง batch — ดึงไฟล์ใหม่เมื่อตัวหนึ่งจบ)

### 4. UI
- Tkinter (built-in, ไม่ต้องลง dep)
- 3 tabs (Edge / Google / ResponsiveVoice)
- Tahoma font ทั้งหมด
- Preset dropdown ต่อ service
- Per-file progress + average time + ETA

### 5. โดน Microsoft throttle ระหว่างทดสอบหนัก
- หลัง sweep concurrent 24-64 + proxy test → IP soft-block
- recovered slowly through low-concurrent retries

### 6. Reverse-engineering balabolka (สำคัญที่สุด)
ใช้ Wireshark + Fiddler ค้นพบว่า:
- balabolka GUI/bal4web → `texttospeech.responsivevoice.org/v1/text:synthesize`
- API key `b08U7IYJ` (scraped จาก homepage HTML, ไม่ใช่ demo keys)
- Android mobile UA + Sec-Fetch-* headers
- HTTP/1.1, no cookies, Cloudflare cache 1 month

### 7. Apply RV ของเรา
- Endpoint: switch จาก `code/getvoice.php` → `texttospeech/v1/text:synthesize`
- Param names: `t→text`, `tl→lang`, `sv→engine`, `vol→volume`, `vn` ลบทิ้ง
- API key: scrape สดทุกครั้งที่เริ่ม (regex `key=([a-zA-Z0-9]{6,12})`)
- User-Agent: Android 4.1.2 SGH-T599N (เลียนแบบ bal4web)
- Headers: `referer`, `sec-fetch-dest:audio`, `sec-fetch-mode:cors`, `sec-fetch-site:same-origin`

ผล: 0/10 → 9/10 success rate

## เครื่องมือที่ใช้

| Tool | ใช้ทำอะไร |
|------|----------|
| **Wireshark** | จับ TLS Client Hello → SNI = `texttospeech.responsivevoice.org` |
| **Fiddler** | จับ raw HTTP request + headers + response (ผ่าน proxy) |
| **Resmon** | ดู IP ปลายทาง + จำนวน TCP connections |
| **edge-tts** | Python library สำหรับ Edge TTS |
| **aiohttp** | shared session + TLS reuse |
| **ffmpeg** | concat MP3 chunks → m4a + atempo |
| **Tkinter** | UI (built-in Python) |

## ผลทดสอบจริง (ต่อ 10 ไฟล์ ~120 chunks)

| Service | Settings | Time | Success |
|---------|---------|------|---------|
| Edge | batch=10 conn=2 (20 total) | 1:22 | 10/10 ✓ |
| Google | batch=10 conn=2 chunk=120 (20 total) | 2:13 | 10/10 ✓ |
| ResponsiveVoice | batch=10 conn=1 (10 total, post bal4web mimicry) | 7:48 | 9/10 ✓ |

## Edge cases ที่เจอ + แก้

1. **Lines that have only `…` or `—`** — edge-tts คืน 0 byte → merge เข้า chunk ก่อนหน้า
2. **Newlines mid-chunk** ใน RV — collapse \\s+ → space
3. **Unicode filename** — ใช้ encoding="utf-8-sig" รองรับ BOM
4. **Microsoft throttle** — ลด concurrent + retry exponential backoff
5. **Process dirs busy** — kill zombie processes ก่อน rm

## สิ่งที่ยังไม่สมบูรณ์

- chapter 461 (1 ไฟล์) ยังมี chunk index 138-146 fail ซ้ำ (RV API ตอบไม่ครบ; chunks อื่นทั้ง 99% ใช้ได้)
- Microsoft Edge IP ยังโดน throttle จากการเทสหนัก — recovery ใช้เวลา

## ค่า settings ที่ดีที่สุด (วัดจริง)

ดูใน [docs/best_settings.md](../docs/best_settings.md)
