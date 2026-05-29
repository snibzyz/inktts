# INKTTS — Project Memory

INKTTS เป็น **เครื่องมือ batch TTS ภาษาไทย** ในตระกูลเดียวกับ INKIDEA / INKCRAW
สร้างบน Electron + React + TypeScript + Vite + Tailwind
แปลงไฟล์ `.txt` เป็นเสียง `.m4a` ผ่านบริการฟรี 3 ตัว (Edge / Google / ResponsiveVoice)
ไม่ต้องใช้ API key, ไม่ต้องลง Python หรือ ffmpeg แยก (ฝัง ffmpeg-static เข้ามา)

> เคยเป็น Python + CustomTkinter (อยู่ใน `.old/`) — port มาเป็น Electron แล้วใน 2026-05

---

## 1. Product Goal

- กล่อง batch TTS ที่กดทีเดียวแล้วได้ไฟล์เสียง `.m4a` หลายไฟล์
- ผู้ใช้วาง `.txt` ใน `input/` → เลือกบริการ + พรีเซต → กดเริ่ม → ได้ `.m4a` ใน `output/<service>/`
- UI ภาษาไทย เน้น operator-friendly (preset น้อย ๆ + ปุ่มน้อย เห็นสถานะชัด)
- คุณภาพเทียบเท่า app.py เดิม 1:1 (sidebar เลือกบริการ, 3 ปุ่มหลัก, log panel, progress per file)
- รองรับ auto-update ผ่าน GitHub Releases (portable .exe มี custom helper-cmd swap)

## 2. Repository Structure

```
INKTTS/
├── .app/
│   └── shell/                    ← Electron + React (1 เดียว — เหมือน INKCRAW)
│       ├── electron/             ← main process
│       │   ├── main.cjs
│       │   ├── preload.cjs
│       │   ├── autoUpdate.cjs
│       │   ├── portableUpdate.cjs ← custom helper-cmd swap (จาก INKCRAW)
│       │   ├── ipc/              ← window.cjs, fs.cjs, tts.cjs
│       │   ├── tts/              ← engine + runner (Node)
│       │   │   ├── runner.cjs    ← orchestrator (port ของ run_batch จาก _lib.py)
│       │   │   ├── splitter.cjs  ← splitLines / splitChars
│       │   │   ├── adaptive.cjs  ← AdaptiveLimiter + Semaphore
│       │   │   ├── ffmpeg.cjs    ← concat ผ่าน ffmpeg-static
│       │   │   ├── edge.cjs      ← Edge TTS (msedge-tts)
│       │   │   ├── google.cjs    ← Google Translate TTS (HTTP)
│       │   │   ├── responsivevoice.cjs ← RV TTS (HTTP + key scrape)
│       │   │   └── merge.cjs     ← merge_groups port
│       │   ├── helpers/
│       │   │   ├── logger.cjs    ← file + console logger
│       │   │   └── paths.cjs     ← appRoot/input/output/cache/ffmpeg
│       │   └── __tests__/        ← smoke-tts.cjs / smoke-merge.cjs
│       └── src/                  ← renderer (React)
│           ├── App.tsx
│           ├── main.tsx
│           ├── index.css
│           ├── components/       ← Sidebar, ServicePanel, MergePanel, SettingsPanel, FileRow, FieldRenderer, StatusBar, UpdateBanner
│           ├── ui/               ← AppButton, AppCard, MacPanel, MacFieldLabel, MacHint, Codicon, Input, Select, cn  (copy จาก INKIDEA hub)
│           ├── lib/services.ts   ← service def + presets
│           ├── state/store.ts    ← zustand
│           └── types/inktts.d.ts ← preload bridge types
├── .old/                         ← Python app เดิม (read-only reference)
├── .claude/                      ← CLAUDE.md (ไฟล์นี้)
├── input/                        ← .txt ที่จะแปลง (gitignored)
├── output/                       ← .m4a ผลลัพธ์ (gitignored)
├── _cache/                       ← chunk ระหว่าง process (gitignored)
├── inktts.ico / inktts.png
├── package.json (workspace)
├── pnpm-workspace.yaml
├── start.bat / install.bat
└── README.md
```

## 3. UI Design System — ตามตระกูล INKIDEA

- **Tailwind tokens** — copy ทั้งชุดจาก INKIDEA `tailwind.config.js` (`vscode.*`) — ห้าม hardcode hex
- **UI primitives** — copy จาก INKIDEA `shared/ui/`:
  - `AppButton` (tone: primary/zinc/.. + variant: solid/flat/chrome/icon)
  - `AppCard` (title + description + action + body)
  - `Codicon` (wrapper รอบ `@vscode/codicons`)
  - `MacPanel`, `MacFieldLabel`, `MacHint`
- **Icons** — ใช้ `Codicon` เท่านั้น (codicon-* names) — ห้าม emoji ใน source
- **ฟอนต์** — Tahoma + Segoe UI + system-ui
- **ขนาด** — input/select/button height 36px (`h-9`), text-[12px]/[13px], rounded-sm
- **Sidebar** — 200px fixed, bg-vscode-sidebar
- **Status bar** — 24px ล่างสุด, สีตาม kind (ok=green, fail=red, run=statusbar blue)

## 4. TTS Engine Architecture

3 engines ในโฟลเดอร์ `electron/tts/` — แต่ละตัว export:
```js
{
  fetchChunk: async ({ text, outPath, ...opts }) => void,
  DEFAULT_BATCH_SIZE: number,
  DEFAULT_CONNECTIONS_PER_FILE: number,
  API_MAX_CONNECTIONS: number,
  splitMode: 'lines' | 'chars',
}
```

**Edge** — ใช้ `msedge-tts` (WebSocket) — voice/rate options. ไม่ต้อง split โดย char limit (รับยาวได้)
**Google** — HTTP GET `translate.google.com/translate_tts?...` ผ่าน Electron `net.request` — UA rotation + jitter
**ResponsiveVoice** — HTTP GET พร้อม scrape live key จาก homepage (fallback keys: b08U7IYJ, FQ9r4hgY, HY7lTyiS) — char limit 100/chunk
**Common** — chunks เป็น .mp3 → ffmpeg concat → .m4a (AAC 128k)

**Runner** (`runner.cjs`):
- `TTSJob` class — รับ files + service + options
- prepare แต่ละไฟล์ → split → spawn parallel chunk fetch
- batchSize × connectionsPerFile = total concurrency cap
- AdaptiveLimiter หด/คืน cap ตาม fail rate
- ffmpeg concat สุดท้าย → emit `prog` events ผ่าน IPC

## 5. IPC Surface (preload → renderer ผ่าน `window.inktts`)

| Namespace | Methods |
|---|---|
| `app` | version, checkUpdate, applyUpdate, onUpdateAvailable, onUpdateProgress |
| `window` | minimize, maximize, close, toggleDevTools, reload |
| `fs` | getAppRoot, listInputFiles, listGlob, chooseFolder, chooseFiles, revealFolder, openExternal, exists |
| `tts` | start, cancel, onEvent (prog/limit/log/done/error) |
| `merge` | start, detect, onLog, onDone |

## 6. Auto-Update — Win (Setup + Portable) + Mac

Release ทุกตัว ship **ทั้ง NSIS Setup + Portable** (เหมือน INKCRAW/INKIDEA) ใน `portableUpdate.cjs`
ตรวจจับโหมดด้วย `getWinMode()`: `portable` (มี `PORTABLE_EXECUTABLE_FILE`) / `installed` (NSIS, `app.isPackaged` แต่ไม่ใช่ portable)

1. ทุก 30 นาที (และ 5 วิหลังเปิดแอพ) ดึง GitHub `releases/latest` API
2. ถ้า `tag_name` ใหม่กว่า `app.getVersion()` → emit `app:updateAvailable` + silent stage ไฟล์ตามโหมด:
   - portable → `INKTTS-Portable-<v>.exe`
   - installed → `INKTTS-Setup-<v>.exe`
3. stage เสร็จ → emit `app:updateDownloaded` → UI แสดงปุ่ม "รีสตาร์ทเดี๋ยวนี้" (mode='portable' = auto ทั้งคู่)
4. apply (กดปุ่ม หรือ `applyStagedOnQuit` ตอนปิดแอพ) → spawn helper.cmd hidden ผ่าน VBS:
   - portable → `move /Y` swap .exe → `start` ใหม่
   - installed → `Setup.exe --updated /S --force-run` (NSIS silent + relaunch)
5. แอพปัจจุบัน `app.quit()`

> Mac (ad-hoc signed) → `macUpdate.cjs` manual zip swap (Squirrel.Mac ต้องการ Developer ID)
> `canAutoApply()` = portable หรือ installed · ขนาดไฟล์ stage ต้อง ≥ `MIN_PORTABLE_SIZE` (30MB) กันไฟล์ truncated

repo info: `process.env.INKTTS_REPO` หรือ default `snibzyz/inktts`

## 7. Workflow

- **Dev**: `pnpm dev` — concurrently รัน Vite (port 5473) + Electron
- **Build**: `pnpm build` — Vite production build → `dist/`
- **Package**: `pnpm package:win` → `release/INKTTS-Portable-<v>.exe`
- **Smoke test**:
  - `pnpm smoke:tts edge|google|rv` — รัน engine ตรง ๆ บน 200-char sample → ตรวจว่าได้ `.m4a` > 1KB
  - `pnpm smoke:merge` — รัน merge บน `output/edge/*.m4a` ที่มีอยู่แล้ว

## 8. Verification Rules — ห้ามรายงานเสร็จก่อนเทส

ตามกฎเดียวกับ INKCRAW (10.2/10.3):
- ทุก engine ต้องผ่าน `pnpm smoke:tts <name>` และ verify ไฟล์ `.m4a` > 1KB
- merge tool ต้องผ่าน `pnpm smoke:merge` และเห็นไฟล์รวม > 1KB
- ห้าม mark "เสร็จ" จนกว่าจะมี output file จริง
- ถ้าเปลี่ยน engine code → re-run smoke ก่อน commit

## 9. Port Numbers (unique ต่อแอป)

| App | Vite port |
|---|---|
| INKIDEA | 5173 |
| INKCRAW | 5273 |
| INKWRIGHT | 5373 |
| **INKTTS** | **5473** |

ห้ามเปลี่ยน port ของ INKTTS โดยไม่อัพเดต `vite.config.ts` + `dev:electron` พร้อมกัน

## 10. รักษา UX สม่ำเสมอข้ามแอป

- ใช้ token `vscode-*` ของ INKIDEA hub เป็นหลัก — copy ทั้งชุด ห้ามเปลี่ยนค่า
- ใช้ AppButton + Codicon + AppCard ของ INKIDEA — ห้ามสร้างปุ่ม/การ์ดสีหรือ shape ใหม่
- Spinbox / FieldRow / Sidebar pattern เลียนแบบ INKIDEA (ขนาด h-9, text-[12px]/[13px])
- ห้าม emoji ใน UI source — ใช้ codicon เท่านั้น
- copy จาก INKIDEA ก่อนเสมอ ก่อนสร้างใหม่
