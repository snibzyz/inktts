# ค่า settings ที่ดีที่สุดต่อ API (วัดจริง)

หลังทดสอบจริงหลายรอบ — ตารางนี้สรุปค่าที่ใช้จริงและเร็วที่สุดสำหรับแต่ละ API

## ⭐ Edge (Premwadee neural)

| เป้าหมาย | batch | conn/file | total | เวลา (วัดจริง) |
|---------|-------|-----------|-------|---------------|
| 1 ไฟล์เร็วสุด | 1 | 48 | 48 | ~15-40s |
| **10 ไฟล์เสร็จพร้อมกัน** ⭐ | **10** | **2** | **20** | **1:22** |
| 20 ไฟล์เสร็จพร้อมกัน | 20 | 2 | 40 | ~3 นาที |
| 50 ไฟล์เสร็จพร้อมกัน | 50 | 1 | 50 | ~7-10 นาที |

**ข้อสังเกต:**
- Microsoft IP throttle ceiling = **~56 connections** (เกินกว่านี้ตัด WebSocket)
- หลังจากเทสหนัก ๆ Microsoft อาจจำและลด ceiling ชั่วคราว → ต้องลดลงเหลือ ~10-20
- เสียง Premwadee Neural คุณภาพสูงสุด ฟรี

```bash
python scripts/edge.py "input/*.txt" --batch-size 10 --connections-per-file 2
```

---

## Google Translate TTS

| เป้าหมาย | batch | conn/file | total | chunk-chars | เวลา (วัดจริง) |
|---------|-------|-----------|-------|-------------|---------------|
| 1 ไฟล์เร็วสุด | 1 | 6 | 6 | 120 | ~30-40s |
| **10 ไฟล์เสร็จพร้อมกัน** ⭐ | **10** | **2** | **20** | **120** | **2:13** |
| 6 ไฟล์ปลอดภัย | 6 | 1 | 6 | 180 | ~1-2 นาที |

**ข้อสังเกต:**
- Google ceiling อยู่ที่ **~8 connections** ในสภาวะปกติ — แต่ด้วย shared session + smaller chunks ดันได้ถึง **20**
- chunk-chars เล็กลง (120 แทน 180) = response เร็วขึ้น = throughput สูงขึ้น
- ใช้ **shared aiohttp session** สำคัญมาก — TLS handshake reuse = เร็วขึ้น ~3 เท่า
- jitter ต่ำ (0-0.2) ก็พอ (Google ไม่ค่อย sensitive กับ pattern)
- เสียงคุณภาพ standard

```bash
python scripts/google.py "input/*.txt" --batch-size 10 --connections-per-file 2 --chunk-chars 120 --jitter 0
```

---

## ResponsiveVoice

| เป้าหมาย | batch | conn/file | total | jitter | เวลา (โดยประมาณ) |
|---------|-------|-----------|-------|--------|------------------|
| 1 ไฟล์เร็วสุด (ปลอดภัย) | 1 | 1 | 1 | 0.5 | ~3-6 นาที |
| 8 ไฟล์เสร็จพร้อมกัน (ปลอดภัย) | 8 | 1 | 8 | 0.5 | ~5-10 นาที |

**ข้อสังเกต:**
- ResponsiveVoice ใช้ getvoice.php เป็น proxy ไป Google Translate TTS — แชร์ rate limit กับ Google
- หลังเทสหนัก ๆ rate limit ลดเหลือ ~2-4 connections ก่อน fail
- ใช้ key rotation (FQ9r4hgY / HY7lTyiS) + UA rotation + jitter ก็ยังโดน throttle
- chunk-chars จำกัดที่ 100 ตัวอักษร (RV API limit)
- เสียงคุณภาพ standard เหมือน Google
- **แนะนำใช้ Edge หรือ Google มากกว่า** — RV มี rate limit เข้มกว่า
- 1 connection ปลอดภัยสุด

```bash
python scripts/responsivevoice.py "input/*.txt" --batch-size 8 --connections-per-file 1 --jitter 0.5
```

---

## เปรียบเทียบ 10 ไฟล์ (วัดจริง วันนี้)

| API | settings | เวลา | success rate |
|-----|---------|------|--------------|
| **Edge** | batch=10 conn=2 | **1:22** | 10/10 ✓ |
| Google | batch=10 conn=2 chunk=120 | 2:13 | 10/10 ✓ |
| ResponsiveVoice | batch=8 conn=1 jitter=0.5 | ~5-10 นาที | depends on throttle |

**สรุป**: Edge เร็วสุด + คุณภาพสูงสุด — ใช้ตัวนี้เป็นหลัก

## Tip ทั่วไป

1. **Resume ได้** — ทุก script จะ skip ไฟล์ที่ output มีอยู่แล้ว, retry chunks ที่เคย fail
2. **ถ้าโดน throttle** — ลด `--connections-per-file` ก่อน, แล้วลด `--batch-size`
3. **ถ้า fail หนัก ๆ** — รอ 30 นาที-1 ชม. ให้ API reset rate limit
4. **เปลี่ยน IP** (VPN/mobile hotspot) — reset ทันที
5. **ระหว่างเทส** — ใช้ค่าเล็ก ๆ ก่อน (batch=2 conn=1) แล้วค่อยเพิ่ม
