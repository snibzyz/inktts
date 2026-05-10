# Microsoft Edge Read Aloud (edge-tts)

Microsoft Edge browser มีฟีเจอร์ "Read Aloud" ที่ใช้เสียง Azure Neural TTS — เรียก endpoint ภายในของ Microsoft โดยใช้ TrustedClientToken ที่ฝังใน browser. ใช้งานได้ฟรี ไม่ต้องสมัคร ไม่ต้องมี API key

Library ที่ tap เข้า endpoint นี้: [`edge-tts`](https://github.com/rany2/edge-tts) (Python, MIT, ใช้กันแพร่หลาย)

## Endpoint

```
wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=...
```

WebSocket protocol — ส่ง SSML แล้วรับ audio stream กลับมา. เป็นเสียง Azure Neural ตัวเดียวกับที่ Microsoft ขาย แต่เรียกผ่าน path ของ Edge browser

## ติดตั้ง

```bash
pip install edge-tts
```

## CLI Options

| Flag | คำอธิบาย |
|------|---------|
| `--voice <name>` / `-v <name>` | voice เช่น `th-TH-PremwadeeNeural` |
| `--text <text>` / `-t <text>` | input text |
| `--file <path>` / `-f <path>` | input text file |
| `--write-media <path>` | output audio (mp3) |
| `--write-subtitles <path>` | output subtitle (vtt) |
| `--rate <±N%>` | ความเร็ว เช่น `+30%` = 1.3x, `-10%` = ช้าลง |
| `--volume <±N%>` | ระดับเสียง |
| `--pitch <±NHz>` | ระดับเสียงสูง/ต่ำ |
| `--list-voices` | ดูรายชื่อเสียงทั้งหมด |
| `--proxy <url>` | proxy server |

## เสียงไทย

```
th-TH-PremwadeeNeural    Female    General    Friendly, Positive
th-TH-NiwatNeural        Male      General    Friendly, Positive
```

ทั้งสองเป็น **เสียง neural ของ Azure** — คุณภาพเดียวกับที่ใช้ผ่าน paid Azure Speech Service

## Output

- Format: **MP3**
- Sample rate: 24kHz mono
- Bitrate: 48 kbps
- ไม่มี chunking limit — ส่งทั้งบทเข้าไปได้เลย

## ตัวอย่าง

### CLI

```bash
# ทดสอบเสียง Premwadee
python -m edge_tts --voice th-TH-PremwadeeNeural --rate=+30% \
  --text "สวัสดีครับ ทดสอบเสียง" --write-media test.mp3

# จากไฟล์
python -m edge_tts --voice th-TH-PremwadeeNeural --rate=+30% \
  -f "New folder/บท01.txt" --write-media "บท01.mp3"

# Niwat (ชาย), ความเร็วปกติ + subtitle
python -m edge_tts --voice th-TH-NiwatNeural \
  -f input.txt --write-media out.mp3 --write-subtitles out.vtt

# ดูรายชื่อเสียงไทย
python -m edge_tts --list-voices | grep th-TH
```

### Python API

```python
import asyncio
import edge_tts

async def main():
    text = "สวัสดีครับ ทดสอบเสียง"
    comm = edge_tts.Communicate(text, voice="th-TH-PremwadeeNeural", rate="+30%")
    await comm.save("out.mp3")

asyncio.run(main())
```

## Script ในโปรเจกต์

[`scripts/edge_tts.py`](../scripts/edge_tts.py) — แปลงไฟล์ .txt หลายไฟล์เป็น .m4a โดย split chunks + ขนาน

| Argument | Default | คำอธิบาย |
|----------|---------|---------|
| `inputs` | (required) | path / glob (รับได้หลายตัว) |
| `-o` / `--output-dir` | `output` | folder output |
| `--voice` | `th-TH-PremwadeeNeural` | voice |
| `--rate` | `+30%` | speed (1.3x); SSML format `±N%` |
| `--fmt` | `m4a` | `m4a` หรือ `mp3` |
| `--lines-per-chunk` | `1` | แบ่งทุก N บรรทัด/chunk |
| `--concurrent` | `48` | global max concurrent WebSockets |
| `--retries` | `4` | retry per chunk |
| `--workdir` | `_chunks_cache` | folder cache (auto-cleaned) |
| `--keep-chunks` | off | เก็บ MP3 chunks ไว้ |
| `--log-failures` | off | TSV log ไฟล์ที่ fail |

```bash
# ทุกตอน → m4a (ค่า default ทั้งหมดเป็น optimal แล้ว)
python scripts/edge_tts.py "input/*.txt" -o output

# Niwat (ผู้ชาย)
python scripts/edge_tts.py "input/*.txt" -o output --voice th-TH-NiwatNeural

# ความเร็วปกติ
python scripts/edge_tts.py "input/*.txt" -o output --rate=+0%

# ทดสอบไฟล์เดียว เป็น mp3
python scripts/edge_tts.py "input/บท01.txt" -o output --fmt mp3
```

ดูรายละเอียด tuning ใน [optimal_strategy.md](optimal_strategy.md)

## Rate / Pitch / Volume Format

ใช้ format ของ SSML prosody:

| Field | Format | ตัวอย่าง |
|-------|--------|---------|
| rate | `±N%` | `+30%` (1.3x), `-25%` (0.75x), `+0%` (ปกติ) |
| volume | `±N%` | `+50%`, `-20%` |
| pitch | `±NHz` | `+5Hz`, `-3Hz` |

## ข้อดี

- **ฟรีไม่จำกัด*** — ไม่มี documented limit, ไม่ต้องสมัคร, ไม่ต้องใส่ key
- **เสียง neural คุณภาพสูง** — ตัวเดียวกับ paid Azure Speech (`th-TH-PremwadeeNeural`)
- ไม่มี chunk limit — ส่งบทยาวๆ เข้าไปได้
- รองรับ subtitle output (.vtt)
- cross-platform (Python — Windows/Mac/Linux)

*Microsoft throttle ระดับ IP ที่ ~56 concurrent WebSockets/IP. ใช้ `--concurrent 48` ปลอดภัย

## ข้อเสีย / ข้อควรระวัง

- **ไม่ใช่ official API** — Microsoft ไม่ได้ documented ให้ใช้แบบนี้, อาจปิด/เปลี่ยนได้
- TrustedClientToken อยู่ในซอร์ส library — ถ้า Microsoft revoke ต้อง update library
- เชิงพาณิชย์/production ควรสมัคร Azure Speech Service จริง (มี free tier 500k chars/เดือน) เพื่อ stable + รับการสนับสนุน
- ไม่มีการรับประกัน uptime หรือ SLA

## ทางเลือกอื่นที่ได้เสียง Premwadee

| ทาง | ฟรี | key | ข้อดี | ข้อเสีย |
|-----|-----|-----|------|--------|
| **edge-tts** | ✅ | ไม่ต้อง | เริ่มได้เลย | unofficial |
| Azure Speech (free tier F0) | ✅ 500k/เดือน | ต้องมี | official, stable | ต้องสมัคร Azure |
| Azure Speech (paid) | ❌ | ต้องมี | unlimited, SLA | ต้องจ่ายเงิน |
| SAPI5 (offline) | ✅ | ไม่ต้อง | ไม่ต้องเน็ต | local เท่านั้น, voice ต้องลงเครื่อง |

## เสียงภาษาอื่นที่น่าสนใจ

```bash
python -m edge_tts --list-voices
```

มีหลายร้อยเสียง รวม English (en-US-AriaNeural, en-US-GuyNeural), Japanese (ja-JP-NanamiNeural), Mandarin (zh-CN-XiaoxiaoNeural), etc. — ทั้งหมดใช้ฟรีผ่าน edge-tts
