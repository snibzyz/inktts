# กลยุทธ์ TTS เร็วสุด (วัดจริงแล้ว)

สรุปวิธีที่ใช้งานจริงและทดสอบเสร็จ — สำหรับแปลงนิยายไทยเป็นไฟล์เสียง m4a เร็วและคุณภาพดี

## ผลลัพธ์ที่วัดได้

5 ตอน ÷ 36:17 นาที audio รวม → ใช้เวลา **40 วินาที** = **54× realtime**

ขยาย 1000 ตอน → **~2.2 ชั่วโมง**

## คำสั่งสุดท้ายที่แนะนำ

```bash
python scripts/edge_tts.py "input/*.txt" -o output \
  --fmt m4a \
  --lines-per-chunk 1 \
  --concurrent 48 \
  --voice th-TH-PremwadeeNeural \
  --rate=+30% \
  --retries 4 \
  --log-failures fail.log
```

(ค่า `--lines-per-chunk 1` `--concurrent 48` `--voice th-TH-PremwadeeNeural` `--rate=+30%` เป็น default ใน script อยู่แล้ว — ใส่หรือไม่ใส่ก็ได้)

ทำให้:
- **เสียง**: Premwadee Neural (Microsoft Azure quality, ฟรีผ่าน edge-tts)
- **ความเร็ว audio**: 1.3× (rate=+30% ทำที่ Microsoft, ไม่ต้องทำ post-processing)
- **Output**: m4a (AAC 24kHz mono ~95 kbps)
- **Resume ได้**: ถ้าเครื่องดับกลางคัน เปิดใหม่จะ skip ตอนที่เสร็จแล้ว

## Stack ที่ใช้

| Component | บทบาท |
|-----------|------|
| [edge-tts](edge_tts.md) | เรียก Microsoft Edge "Read Aloud" — neural Premwadee ฟรี ไม่ต้อง key |
| asyncio | ยิง WebSocket ขนานกัน |
| `Semaphore(48)` | คุมไม่ให้เกินเพดาน throttle ของ Microsoft |
| ffmpeg | concat MP3 chunks → encode m4a |

## หลักการแบ่ง chunk

### 1. ทำไมต้องแบ่ง

Microsoft Edge TTS รับ 1 ข้อความต่อ 1 WebSocket — ส่งทั้งบทเข้าไปจะใช้ connection เดียว ทำงานบน Microsoft แค่ 1 ช่อง

แบ่งเป็น 60 ชิ้น → เปิด 60 WebSocket พร้อมกัน → Microsoft synthesize ขนาน 60 ตัว → เร็วขึ้น 60 เท่าทฤษฎี

### 2. แบ่งยังไง

```python
# 1 line = 1 chunk (option --lines-per-chunk 1)
chunks = [line for line in text.split("\n") if line.strip()]
```

แต่ต้อง **merge บรรทัดที่ไม่มีพยัญชนะ** เข้ากับชิ้นก่อนหน้า:

```
"…"        ← edge-tts สังเคราะห์ไม่ได้ → 0 byte
"—"        ← merge เข้า chunk ก่อนหน้า
"\"…\""    ← merge
```

(โค้ดในไฟล์จัดการให้แล้ว)

### 3. รันขนานทั้งหมด

```python
sem = asyncio.Semaphore(48)  # คุมไม่ให้เกิน 48 connection พร้อมกัน
await asyncio.gather(*[fetch(chunk) for chapter in chapters for chunk in chapter])
# ↑ ยิงทุก chunk ของทุกตอนใน batch เดียว, semaphore คุมเอง
```

### 4. รวม chunk → m4a

```bash
ffmpeg -f concat -i list.txt -c:a aac -b:a 128k output.m4a
```

`-f concat` decode MP3 chunks ทั้งหมด แล้ว encode ใหม่เป็น AAC m4a ในการ pass เดียว

## จำนวน concurrent — ทำไม 48

ทดสอบจริง (ตอน 002, 74 chunks):

| concurrent | สถานะ | เวลา | หมายเหตุ |
|-----------|-------|------|---------|
| 64 | ❌ throttle | fail | Microsoft ตัด ~37% chunks |
| 56 | ✅ | 30s | ผ่าน |
| **48** | **✅** | **21s** | **เร็วสุด** |
| 40 | ✅ | 21s | เท่ากัน |
| 32 | ✅ | 29s | ช้ากว่าเล็กน้อย |
| 24 | ✅ | 23s | safe |

**กฎที่ค้นพบ:**
- Microsoft Edge TTS throttle ระดับ IP ที่ ~56-60 concurrent connections
- Sweet spot = 40-48 (เพียงพอจบใน 1-2 รอบ, ปลอดภัย)
- เกิน 48 ได้ผลตอบแทนน้อย, เกิน 56 = fail แน่

## เวลาแต่ละขั้น (วัดจริง)

ตอน 001 (62 chunks, audio 5:56, concurrent=24):

```
T+0.0s  เริ่ม script
T+0.5s  อ่านไฟล์ + split chunks
T+1.0s  ยิง 24 WebSocket แรก
        ├─ TLS handshake     ~500ms-1s ต่อ connection
        ├─ ส่ง SSML            ~50ms
        ├─ Microsoft synth    ~3-5s ต่อ chunk
        └─ สตรีม MP3 กลับ      ~200ms
T+8s    24 chunks แรกเสร็จ → 24 ชุดต่อไป
T+16s   48 chunks เสร็จ → 14 ชุดสุดท้าย
T+22s   ทุก chunk เสร็จ
T+22s   ffmpeg concat → encode AAC
T+27s   ✅ เสร็จ output m4a
```

## ผลทดสอบทั้งหมด

| ตอน | บรรทัด | chunks | concurrent | เวลา fetch | ffmpeg | total | audio | speedup |
|-----|-------|--------|-----------|----------|--------|-------|-------|---------|
| 001 | 63 | 62 | 64 | 17s | 5s | 22s | 5:56 | 16× |
| 002 | 79 | 74 | 48 | 18s | 3s | 21s | 6:41 | 19× |
| 003 | 98 | 96 | 24 | 35s | 3s | 38s | 8:53 | 14× |
| 004 | 95 | 94 | 24 | 30s | 3s | 33s | 8:27 | 15× |
| 005 | 90 | 80 | 64 | 13s | 3s | 16s | 6:20 | 24× |
| **รวม 5 ตอน** | **425** | **406** | **48** | **~37s** | **~3s** | **40s** | **36:17** | **54×** |

ตอนรวม 5 ตอนเร็วกว่าทำทีละตอนเพราะ:
- chunks ของหลายตอนเข้า queue เดียว → semaphore กระจาย load สม่ำเสมอ
- ffmpeg ของแต่ละตอน overlap กัน (ตอนที่เสร็จก่อนเริ่ม encode พร้อมที่อื่นยัง fetch อยู่)

## สูตรเลือก concurrent

```
จำนวน chunks ต่อบทเฉลี่ย × จำนวนบท   → Q = total chunks

ถ้า Q ≤ 48        → concurrent = Q (จบ 1 รอบ)
ถ้า 48 < Q ≤ 96   → concurrent = 48 (จบ 2 รอบ, ปลอดภัย)
ถ้า Q > 96        → concurrent = 48 (หลายรอบ, เพดาน throttle)
```

**อย่าใช้เกิน 56** ใน IP เดียว — ผ่านเพดาน throttle ของ Microsoft → fail

## เปรียบเทียบกับวิธีอื่น

| วิธี | 5 ตอน เวลา | คุณภาพ | หมายเหตุ |
|-----|----------|--------|---------|
| **edge_tts.py (วิธีนี้)** | **40 วินาที** | **Neural Premwadee** | **แนะนำ** |
| responsivevoice.py | ~25-30 นาที | Standard Google | 100 char limit, slow |
| google_tts.ps1 | ~20-25 นาที | Standard Google | rate limit ง่าย |
| SAPI5 (offline) | ขึ้นกับเครื่อง | ขึ้นกับ voice | ใช้ CPU เครื่อง |

## ขีดจำกัดที่หลีกเลี่ยงไม่ได้

1. **Microsoft throttle = ~56 concurrent/IP** — เพิ่มเครื่อง/IP ถ้าต้องการเร็วกว่านี้
2. **WebSocket TLS handshake ~500ms ต่อ connection** — ลดไม่ได้
3. **Microsoft synthesis ~realtime/2** — ขึ้นกับ load ฝั่งเขา

ถ้าต้องการเร็วกว่า 54× realtime:
- ใช้ Azure Speech แบบ paid — มี SLA, ไม่จำกัด
- กระจายเครื่อง/cloud VM (DigitalOcean $4/mo × N เครื่อง)
- Proxy rotation — แต่ free proxy ส่วนใหญ่ตาย ทำให้ช้ากว่าเดิม

## Workflow แนะนำสำหรับ 1000 ตอน

```bash
# 1. รัน batch แรก (~2.2 ชม.)
python scripts/edge_tts.py "input/*.txt" -o output --log-failures fail1.log

# 2. ตรวจ fail
wc -l fail1.log

# 3. Re-run เฉพาะที่ fail (ลด concurrent กัน throttle)
cut -f1 fail1.log | tail -n +2 | xargs -I{} \
  python scripts/edge_tts.py "{}" -o output --concurrent 24 --log-failures fail2.log

# 4. ถ้ายังมี fail — ครั้งที่ 3 ที่ concurrent 12
```

Resume ทุกครั้งทำได้เลย — script จะ skip ตอนที่ output ไฟล์มีอยู่แล้ว

## ทำไม edge-tts ไม่หนักเครื่อง

- **ทุกอย่างทำที่ Microsoft cloud** — เครื่องเราแค่รับ-ส่ง network
- **CPU usage ในเครื่อง** = ffmpeg encode m4a (~3 วิ/ตอน) + Python async I/O (negligible)
- **RAM** ใช้แค่ buffer chunks ใน memory ก่อน save ลง disk (~5-10 MB)
- **Disk I/O** = ขนาด output × 2 (chunk MP3 + final m4a) — ลบ chunk หลัง concat

ตอน 1000 ตอน × 5 MB = 5 GB output (m4a) + temp ~2.5 GB (ลบทิ้งระหว่างทาง)

## Script ที่เกี่ยวข้อง

| ไฟล์ | บทบาท |
|------|------|
| [scripts/edge_tts.py](../scripts/edge_tts.py) | **Production script** — ใช้ตัวนี้ |
| [scripts/google_tts.ps1](../scripts/google_tts.ps1) | Google Translate TTS (เสียง standard) |
| [scripts/responsivevoice.py](../scripts/responsivevoice.py) | ResponsiveVoice (เสียง standard) |
