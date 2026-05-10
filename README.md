<div align="center">

# INKTTS

**แปลงไฟล์ข้อความ → เสียง ทีละหลายไฟล์ในคลิกเดียว**

ใส่ `.txt` หลาย ๆ ไฟล์ → กดเริ่ม → ได้ไฟล์เสียง `.m4a` ฟังได้เลย

ฟรี · ไม่ต้องสมัครสมาชิก · ไม่ต้องใส่ API key

### [📥 ดาวน์โหลดเวอร์ชันล่าสุด](https://github.com/snibzyz/inktts/releases/latest)

</div>

---

## 📥 เลือกไฟล์ที่ตรงกับเครื่อง

| เครื่อง | ไฟล์ที่โหลด |
|:---|:---|
| 🪟 Windows | `INKTTS-Portable-x.x.x.exe` |
| 🍎 Mac (M1/M2/M3/M4) | `INKTTS-x.x.x-arm64.dmg` |
| 🍎 Mac (Intel) | `INKTTS-x.x.x-x64.dmg` |

> **Mac ครั้งแรก**: คลิกขวาที่ไอคอน → **Open** → กด Open อีกครั้ง (ครั้งหลังดับเบิ้ลคลิกได้ปกติ)

---

## 🚀 ใช้งาน 3 ขั้นตอน

#### 1️⃣ วางไฟล์ `.txt` ในโฟลเดอร์ `input/`
&nbsp;&nbsp;&nbsp;&nbsp;จะกี่ไฟล์ก็ได้ — โปรแกรมทำพร้อมกันหลายไฟล์

#### 2️⃣ เปิดโปรแกรม → เลือกบริการเสียง
&nbsp;&nbsp;&nbsp;&nbsp;เริ่มที่ **Microsoft Edge** ก่อน (เสียงดีสุด)

#### 3️⃣ กด "เริ่มแปลงเสียง"
&nbsp;&nbsp;&nbsp;&nbsp;ไฟล์ `.m4a` จะอยู่ในโฟลเดอร์ `output/`

---

## 🎙 เลือกบริการเสียง

| บริการ | เสียง | ความเสถียร | ใช้เมื่อ |
|:---|:---:|:---:|:---|
| ⭐ **Microsoft Edge** | ดีเยี่ยม | กลาง | อยากได้เสียงธรรมชาติที่สุด *(แนะนำ)* |
| 🌐 **Google Translate** | กลาง | สูง | แปลงไฟล์เยอะ ๆ ติดต่อกัน |
| 🎙 **ResponsiveVoice** | กลาง | กลาง | อยากเลือกเพศชาย/หญิง |

---

## ❓ คำถามที่พบบ่อย

<details>
<summary><b>เปิดไม่ได้ บอกว่า "ไม่ปลอดภัย" / "ไม่รู้จักผู้พัฒนา"</b></summary>

- **Windows**: คลิก *More info* → *Run anyway*
- **Mac**: คลิกขวาที่ไอคอน → *Open* (อย่าดับเบิ้ลคลิก) → กด *Open* ในกล่อง
</details>

<details>
<summary><b>แปลงแล้วได้ไฟล์ขนาด 0 KB / ฟังไม่ได้</b></summary>

บริการนั้นอาจโดน rate limit ชั่วคราว ลอง:
1. กดปุ่ม **"ลองใหม่เฉพาะที่ล้มเหลว"**
2. หรือเปลี่ยนบริการเป็น **Google** (เสถียรที่สุด)
3. หรือเปลี่ยน preset เป็น **"ช้าแต่ปลอดภัย"**
</details>

<details>
<summary><b>เสียงเร็ว/ช้าเกินไป</b></summary>

ปรับ "ความเร็วเสียง" ในหน้าตั้งค่าของแต่ละบริการ
- Edge: `+30%` = เร็วขึ้น 30% (ใส่ `+0%` ถ้าอยากปกติ)
- Google/RV: เลื่อน slider ความเร็ว
</details>

<details>
<summary><b>ข้อความยาวมาก ๆ แปลงได้มั้ย</b></summary>

ได้ — โปรแกรมตัดเป็นชิ้นย่อย แปลงทีละชิ้น แล้วต่อกันให้อัตโนมัติ ไม่มีจำกัดความยาว
</details>

<details>
<summary><b>เปลี่ยนโฟลเดอร์ input/output ได้มั้ย</b></summary>

ได้ — เมนู **"ตั้งค่า"** เลือกโฟลเดอร์ใหม่ จะจดจำไว้รอบหน้า
</details>

<details>
<summary><b>มีเครื่องมือรวมไฟล์เสียงเป็นชุดมั้ย</b></summary>

มี — เมนู **"รวมไฟล์เสียง"** ทางซ้าย
ตัวอย่าง: มีตอน 1–100 → รวมเป็นชุดละ 10 ตอน (1–10, 11–20, ...) เพื่อฟังเป็นชุด
</details>

---

## 🔄 อัปเดตอัตโนมัติ

- **Windows** — อัปเดตเองทุก 30 นาทีในพื้นหลัง พอปิดเปิดใหม่ก็ได้เวอร์ชันล่าสุด
- **Mac** — แจ้งเตือนเมื่อมีเวอร์ชันใหม่ คลิก **"ดาวน์โหลด"** เพื่อโหลดเอง

---

<details>
<summary><b>👨‍💻 สำหรับนักพัฒนา</b></summary>

INKTTS เป็น **Electron + React + TypeScript** desktop app ในตระกูล [INKIDEA / INKCRAW / INKWRIGHT](https://github.com/snibzyz)

```bash
pnpm install         # ติดตั้ง dependencies
pnpm dev             # โหมดพัฒนา (Vite + Electron hot-reload)
pnpm package:win     # build Windows portable .exe
pnpm package:mac     # build macOS .dmg (ต้องรันบน Mac)
pnpm release 2.1.0   # bump version + tag + push → trigger CI build
```

ต้องมี Node.js 20+ และ pnpm 9+
รายละเอียดสถาปัตยกรรมที่ [`.claude/CLAUDE.md`](.claude/CLAUDE.md)

</details>

<div align="center">

—— MIT License ——

</div>
