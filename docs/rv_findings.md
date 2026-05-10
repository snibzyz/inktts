# ResponsiveVoice — สิ่งที่เรียนรู้จากการทดสอบ

## สิ่งที่ทำงาน ✅

- **Endpoint**: `texttospeech.responsivevoice.org/v1/text:synthesize` (ไม่ใช่ `code/getvoice.php` เก่า)
- **API key สด**: scrape จาก `responsivevoice.org/` HTML (regex `key=([a-zA-Z0-9]{6,12})`)
- **Mobile User-Agent + Sec-Fetch-* headers**: เลียนแบบ bal4web
- **fake-useragent library**: random UA (ใช้แบบ optional)
- **Line-first chunking**: split ตามบรรทัด, ไม่ตัดกลางคำ Thai
- **Fail tolerance**: ยอม 10-15% chunks หาย → concat ที่มี (ไม่ retry storm)

## สิ่งที่ไม่ทำงาน ❌

### IP rotation per request — ทำลาย TCP keep-alive
```python
# เก็บไว้เป็นบทเรียน
edge_ip = random.choice(edge_ips)
url = f"https://{edge_ip}/v1/text:synthesize?..."
# ↑ each request เปิด TCP+TLS ใหม่ → 500ms+ overhead ต่อ request
# 130 chunks × 700ms = 90s แทนที่จะ 21s
```
**สรุป**: aiohttp shared session กับ hostname URL ดีกว่า — TCP reuse ได้

### Cloudflare CIDR sampling — ส่วนใหญ่ timeout
- สุ่ม IP จาก CF CIDR ranges (~50 IPs)
- ส่วนใหญ่ไม่ตอบ TCP/443 หรือ route ผิด
- เสียเวลา connect timeout

### Multi-instance balabolka GUI trick — ใช้กับเราไม่ได้
- balabolka GUI สามารถเปิดหลาย instance ได้เพราะใช้ **local SAPI voices**
- RV cloud API rate limit ที่ IP — multiple processes = same IP = same throttle

## ผลทดสอบจริง (วัด ครั้งเดียวก่อน burn rate limit)

| settings | files | time | result |
|---------|-------|------|--------|
| batch=1 conn=4 | 1 | 21s | ✅ |
| batch=1 conn=4 | 1 | 20s | ✅ chapter 461 |
| batch=10 conn=1 | 10 | 7:48 | ✅ 9/10 |
| batch=10 conn=2 | 10 | ~80s | ✅ ~80% (มี fail) |

หลังเทสเยอะ ๆ ระดับ 21s **ยากจะได้อีก** จนกว่า rate limit จะ reset (30+ นาที)

## คำแนะนำ production

```bash
# 1000 ตอน — ปลอดภัย (จะใช้เวลานาน แต่ไม่ fail)
python scripts/responsivevoice.py "input/*.txt" \
  --batch-size 5 --connections-per-file 2 \
  --jitter 0.3 --fail-tolerance 0.1
```

ประมาณ: 5-10 นาที/ไฟล์ → 1000 ไฟล์ = **1-3 ชั่วโมง**

## ทางที่เร็วกว่าจริง — Edge

- Edge: 10 ไฟล์ใน 1:22 (เทียบ RV 7:48) = **6× เร็วกว่า**
- Edge: เสียง Premwadee Neural คุณภาพดีกว่า

**Recommendation**: ใช้ Edge เป็นหลัก, RV เก็บไว้เป็น fallback หรือเฉพาะ chapters ที่ Edge ไม่ผ่าน
