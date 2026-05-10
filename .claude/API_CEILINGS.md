# API ceilings — วัดจริง

## Edge TTS (Microsoft)

```
endpoint: wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
auth:     TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4 (hardcoded ใน edge-tts library)
protocol: WebSocket (TLS 1.3)
```

**Concurrent ceiling**: ~56 WebSocket connections per IP

**ที่วัดจริง**:
| concurrent | ผล |
|-----------|------|
| 24 | ✓ ปลอดภัยมาก |
| 32 | ✓ ดี |
| 40 | ✓ ดี |
| 48 | ✓ sweet spot — เร็วสุด |
| 56 | ✓ borderline |
| 64 | ❌ throttle |

**ฟ้อง throttle**: WebSocket disconnect หลัง chunk ~30-70 (varies)

## Google Translate TTS

```
endpoint: https://translate.google.com/translate_tts
auth:     ไม่ต้อง (client=tw-ob)
protocol: HTTPS GET
chunk limit: ~200 chars (เราใช้ 120 ปลอดภัย)
```

**Concurrent ceiling**: ~8 requests per IP (วัดจริง 10-12 ใช้ได้กับ shared session + smaller chunks)

**ที่วัดจริง**:
| concurrent | chunk-chars | ผล |
|-----------|-------------|-----|
| 6 | 180 | ✓ ปลอดภัย |
| 10 | 120 | ✓ ดี (ใช้ shared session) |
| 12 | 120 | ✓ borderline |
| 15+ | - | ❌ บ่อย ๆ ติด HTTP 429 |

## ResponsiveVoice (texttospeech.responsivevoice.org)

**Final result (28 เม.ย. 2026):** 1 file in **~20 seconds** (130 chunks at conn=4)

### 5 tricks combined

1. Endpoint ใหม่ `texttospeech.rv/v1/text:synthesize` (ไม่ใช่ getvoice.php เก่า)
2. API key scrape สดจาก `responsivevoice.org/` (regex `key=([a-zA-Z0-9]{6,12})`)
3. Mobile User-Agent: `Mozilla/5.0 (Linux; Android 4.1.2; SGH-T599N...)` + Sec-Fetch-* headers
4. **IP rotation** — DNS ของ host หลาย IP, randomly hit different Cloudflare edges per request
5. **fail-tolerance 10%** — concat what's there, no retry storm


```
endpoint: https://texttospeech.responsivevoice.org/v1/text:synthesize
auth:     key=<scraped from responsivevoice.org/ HTML>
protocol: HTTPS GET
chunk limit: 100 chars (server enforced)
```

**Concurrent ceiling**: ~4-8 (เปลี่ยนตามเวลา/IP reputation)

**ที่ Wireshark observed (balabolka GUI)**:
- 4 TCP connections active ตลอดเวลา
- ~0.9 chunks/วินาที throughput
- TLS 1.3

**ที่วัดจริงเรา**:
| concurrent | jitter | UA | ผล |
|-----------|--------|-----|-----|
| 8 | 0 | desktop | ❌ throttle ทันที |
| 4 | 0.2 | desktop | ❌ fail ที่ 38/120 |
| 4 | 0.3 | Android mobile | ✓ 9/10 ที่ batch=10 |
| 2 | 0.5 | Android mobile | ✓ ปลอดภัยมาก |
| 1 | 0.5 | Android mobile | ✓ ช้าแต่ไม่มี fail |

**ฟ้อง throttle**: empty response (0 bytes) หรือ TCP connection cut

## เกร็ด

### Cloudflare cache
- Response มี `Cache-Control: max-age=2678400` (1 เดือน)
- ข้อความ + params เดียวกัน = cache hit ทันที (~50ms vs ~1000ms)
- text/key/lang/etc รวมกันคือ cache key

### Recovery time หลังโดน throttle
- Edge: นาน (30 นาที-ชั่วโมง)
- Google: เร็วกว่า (5-15 นาที)
- RV: ขึ้นกับ Google (เพราะ RV proxy ผ่าน Google internally)

### Headers ที่สำคัญ
- **User-Agent มือถือเก่า** = bypass rate limit ส่วนใหญ่ (สำหรับ RV)
- **Sec-Fetch-* headers** = เลียนแบบ browser audio context
- **Origin/Cookie** = ไม่จำเป็น
- **Accept** = ไม่จำเป็น

### Endpoint version
- RV เก่า `code.responsivevoice.org/getvoice.php` rate-limit เข้มกว่า
- RV ใหม่ `texttospeech.responsivevoice.org/v1/text:synthesize` rate-limit เบากว่า ใช้ key สดได้

## Strategies for production

1. **Rolling worker pool** — ไฟล์ใหม่เริ่มเมื่อตัวหนึ่งจบ (ไม่รอทั้ง batch)
2. **Resume from cache** — chunks ที่สำเร็จแล้ว skip
3. **Retry with exponential backoff** — กัน transient fail
4. **Scrape API key สด** — กัน hardcoded key ถูก revoke
5. **Match real client headers** — เลียนแบบ UA + Sec-Fetch-*
6. **Different IPs** — ถ้า throttle หนัก ใช้ VPN หรือ multiple machines
