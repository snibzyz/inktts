# คำศัพท์ — ใช้ให้ตรงกัน

## ภาพรวม 4 ระดับ

```
batch (กลุ่มไฟล์)    ← ไฟล์ N ตัวที่ทำงานพร้อมกัน 1 รอบ
   └─ ไฟล์ (.txt 1 ตอน)
        └─ chunk     ← ชิ้นเล็กที่ split จากเนื้อหา
             └─ connection  ← 1 network request (HTTP/WebSocket) ส่ง 1 chunk
```

## ตัวอย่างเป็นรูป

ไฟล์ 1 ตอน 100 บรรทัด → ตัดเป็น 100 chunks (1 บรรทัด/chunk สำหรับ Edge):

```
ไฟล์ "บท 1" 
├── chunk 0   ┐
├── chunk 1   │
├── chunk 2   │  100 chunks
├── ...       │  ส่งทีละ N พร้อมกัน
└── chunk 99  ┘  ผ่าน connections

ถ้า conn=4: 4 chunks เข้าคิวพร้อมกัน
   ├─ connection 1: chunk 0 → API ↓
   ├─ connection 2: chunk 1 → API ↓
   ├─ connection 3: chunk 2 → API ↓
   └─ connection 4: chunk 3 → API ↓
   (รอจน chunk หนึ่งเสร็จ ก็ส่งตัวถัดไป)
```

## chunk vs connection ต่างกันยังไง

| | chunk | connection |
|---|---|---|
| คืออะไร | "ชิ้นข้อความ" — text ที่ถูกตัดออกมา | "ช่องทาง" — network request ที่ active |
| ขนาด | Edge: 1 บรรทัด, Google: ~120 ตัวอักษร, RV: 100 ตัวอักษร | (ไม่มีขนาด — เป็น state ของ network) |
| ปริมาณ | 1 ไฟล์ = หลายร้อย chunks | กำหนดได้ผ่าน `--connections-per-file` |
| ขั้นตอน | สร้างก่อน upload | เปิดตอน fetch |

## connections-per-file ทำงานยังไง

ในแต่ละไฟล์มี chunks มากมาย ส่งทีละกี่ chunks พร้อมกัน?

- `--connections-per-file 1`: ส่งทีละ 1 chunk (ช้าสุด — 100 chunks × 3s = 300s)
- `--connections-per-file 4`: ส่งทีละ 4 chunks ขนานกัน (เร็วขึ้น 4 เท่า — 75s)
- `--connections-per-file 8`: ส่งทีละ 8 chunks (เร็วขึ้น 8 เท่า — 38s)

ถ้าเปิดมากเกินไป → API ตัด (rate limit)

## คำศัพท์ที่ใช้ใน script

| ชื่อ argument | หมายความว่า | ค่าตัวอย่าง |
|--------------|-------------|------------|
| `--batch-size` | กี่ไฟล์ทำงานพร้อมกัน 1 รอบ — ทุกไฟล์ในรอบเสร็จใกล้กัน | 10 |
| `--connections-per-file` | กี่ connection ต่อไฟล์ — ในไฟล์แบ่ง chunks ยิงพร้อมกันไม่เกินค่านี้ | 4 |
| `--lines-per-chunk` | กี่บรรทัดของ text รวมเป็น 1 chunk | 1 |
| `--retries` | ลองใหม่กี่ครั้งถ้า fetch ล้ม | 4 |

## สูตรเชื่อมโยง

```
total_connections = batch_size × connections_per_file
```

ต้องไม่เกินเพดานของ API:

| API | เพดาน total_connections |
|-----|------------------------|
| Edge | 56 |
| Google Translate | 8 |
| ResponsiveVoice | 8 |

## ตัวอย่างการตั้งค่า

### "1 ไฟล์เร็วสุด"
```bash
python scripts/edge.py "input/บท01.txt" --batch-size 1 --connections-per-file 48
```
→ ใส่ทั้ง 48 connection ลงไฟล์เดียว, เร็วสุด

### "10 ไฟล์เสร็จพร้อมกัน"
```bash
python scripts/edge.py "input/*.txt" --batch-size 10 --connections-per-file 4
```
→ 10 × 4 = 40 connections (ใต้เพดาน 56), 10 ไฟล์ progress พร้อมกัน เสร็จใกล้กัน

### "50 ไฟล์เสร็จพร้อมกัน"
```bash
python scripts/edge.py "input/*.txt" --batch-size 50 --connections-per-file 1
```
→ 50 × 1 = 50 connections, 1 connection ต่อไฟล์, 50 ไฟล์เสร็จพร้อมกัน (ช้ากว่าต่อไฟล์ แต่ทุกไฟล์เดินไปด้วยกัน)

### "1000 ไฟล์, ทำเป็นกลุ่ม"
```bash
python scripts/edge.py "input/*.txt" --batch-size 10 --connections-per-file 4
```
→ 100 รอบ × 10 ไฟล์ = 1000 ไฟล์, แต่ละรอบเสร็จพร้อมกัน

## เป้าหมายการตั้งค่าตามสถานการณ์

| เป้าหมาย | batch-size | connections-per-file | API ที่แนะนำ |
|---------|-----------|---------------------|------------|
| 1 ไฟล์เร็วสุด | 1 | 48 | Edge |
| 5 ไฟล์เสร็จพร้อมกันให้ไว | 5 | 8 | Edge |
| 10 ไฟล์เสร็จพร้อมกัน | 10 | 4 | Edge |
| 20 ไฟล์เสร็จพร้อมกัน | 20 | 2 | Edge |
| 50 ไฟล์เสร็จพร้อมกัน | 50 | 1 | Edge |
| 1000 ไฟล์เป็นกลุ่ม | 10-20 | 4-2 | Edge |

## ทำไม batch_size × connections_per_file ต้องไม่เกิน API ceiling

ทุก connection คือ 1 request ที่อยู่ระหว่าง fetch จริง ๆ. ถ้าเปิดเกินเพดาน → API ตัด → fail

- Edge: เปิด WebSocket > 56 → throttle/disconnect
- Google: > 8 ใน IP เดียว → 429 Too Many Requests
- ResponsiveVoice: > 8 → block ชั่วคราว

## "ไฟล์ไหนอยู่ในรอบเดียวกัน เสร็จเมื่อไหร่"

ในรอบ 1 รอบ (`batch_size` ไฟล์):
- ทุกไฟล์ได้ semaphore เท่ากัน (`connections_per_file` slot)
- chunks ของทุกไฟล์ผลัดกันเข้าคิว (round-robin)
- ผลคือทุกไฟล์ progress พร้อมกัน
- เมื่อรอบเสร็จ ทุกไฟล์เสร็จในช่วงไม่กี่วินาที (ขึ้นกับขนาดไฟล์)

ระหว่างรอบ: รอบถัดไปเริ่มทันทีที่รอบก่อนจบ
