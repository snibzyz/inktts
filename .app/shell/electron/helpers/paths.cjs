const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const settings = require('./settings.cjs');

// "App root" — โฟลเดอร์ที่ user ใช้เก็บ input/output
// — portable Win:    ข้าง .exe (writable แน่ ๆ)
// — dev:             workspace dir
// — NSIS-installed:  Program Files (read-only ปกติ) → ใช้ Documents/INKTTS แทน
// — Mac .app:        Contents/MacOS อยู่ใน app bundle (read-only) → ใช้ Documents/INKTTS แทน
function getAppRoot() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged) return path.resolve(__dirname, '..', '..', '..', '..');
  // packaged แต่ไม่ใช่ portable: ใช้ ~/Documents/INKTTS เพื่อให้เขียนได้ทั่วทั้ง user
  // (ก่อนหน้านี้ใช้ path.dirname(process.execPath) → Program Files / .app/Contents = read-only)
  try {
    return path.join(app.getPath('documents'), 'INKTTS');
  } catch {
    return path.dirname(process.execPath);
  }
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch { /* noop */ }
  return p;
}

// Default = ข้าง .exe (portable) / Documents/INKTTS (installed) — user ทับด้วย settings.json ได้
function getDefaultInputDir() { return path.join(getAppRoot(), 'input'); }
function getDefaultOutputDir() { return path.join(getAppRoot(), 'output'); }

// Resolve actual location: user override → default (สร้างให้ถ้ายังไม่มี)
function getInputDir() {
  const custom = settings.getCustomInputDir();
  return ensureDir(custom || getDefaultInputDir());
}
function getOutputDir() {
  const custom = settings.getCustomOutputDir();
  return ensureDir(custom || getDefaultOutputDir());
}

// Shared cache root — ทุก instance แชร์กัน
// chunks อยู่ที่ cache/<service>/<base>/<idx>.mp3 → resume ข้าม session ได้
// 2 instance เขียน chunk เดียวกัน → ใช้ temp file + atomic rename กัน collision
function getCacheRoot() {
  return ensureDir(path.join(app.getPath('userData'), 'cache'));
}

function getServiceCacheDir(service) {
  if (!service || typeof service !== 'string') throw new Error('service required');
  return ensureDir(path.join(getCacheRoot(), service));
}

// คำนวณขนาด cache เป็น byte — เดิน recursive ทั้งต้นไม้
// ใช้สำหรับโชว์ในหน้า Settings ให้ user รู้ว่า cache กินดิสก์เท่าไหร่
function getCacheSize() {
  const root = getCacheRoot();
  let total = 0;
  const walk = (p) => {
    let stat;
    try { stat = fs.statSync(p); } catch { return; }
    if (stat.isFile()) { total += stat.size; return; }
    if (!stat.isDirectory()) return;
    let entries;
    try { entries = fs.readdirSync(p); } catch { return; }
    for (const ent of entries) walk(path.join(p, ent));
  };
  walk(root);
  return total;
}

// ลบ cache ทั้งหมด — เรียกจากปุ่ม "Clear Cache" ใน Settings
function clearCache() {
  const root = getCacheRoot();
  try {
    const entries = fs.readdirSync(root);
    for (const ent of entries) {
      try { fs.rmSync(path.join(root, ent), { recursive: true, force: true }); } catch { /* noop */ }
    }
    return true;
  } catch { return false; }
}

// ffmpeg-static path — packed inside asar.unpacked or dev node_modules
//
// Resolution order (return FIRST path that exists as file):
//   1. INKTTS_FFMPEG_PATH env var (escape hatch — user override เมื่อ packaged path เพี้ยน)
//   2. require('ffmpeg-static') — ทำงานทั้ง dev + packaged
//      packaged: replace 'app.asar' → 'app.asar.unpacked'
//   3. Best-guess fallback paths รอบ ๆ process.resourcesPath
//      เผื่อ require() คืน null (ffmpeg-static@5 คืน null เมื่อ arch ไม่รองรับ
//      เช่น win32-arm64 — Electron บน arm64 runtime แต่ตอน build จัด x64)
//
// คืน path (string) หรือ null ถ้าหาไม่เจอ หรือเจอแต่ไม่ใช่ไฟล์
function getFfmpegPath() {
  const candidates = [];

  // 1. user override
  if (process.env.INKTTS_FFMPEG_PATH) candidates.push(process.env.INKTTS_FFMPEG_PATH);

  // 2. require() — primary
  let p;
  try { p = require('ffmpeg-static'); } catch { p = null; }
  if (p) {
    if (app.isPackaged) candidates.push(p.replace('app.asar', 'app.asar.unpacked'));
    else candidates.push(p);
  }

  // 3. fallback: scan known packaged locations relative to resourcesPath / execPath
  if (app.isPackaged) {
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const roots = [];
    if (process.resourcesPath) roots.push(process.resourcesPath);
    // mac .app: execPath = .app/Contents/MacOS/INKTTS → resourcesPath = .app/Contents/Resources
    // ถ้า resourcesPath หายไป (เคสประหลาด) ลองหารอบ ๆ execPath
    try {
      const ep = path.dirname(process.execPath);
      roots.push(ep);
      roots.push(path.join(ep, 'resources'));
      roots.push(path.join(ep, '..', 'Resources')); // mac fallback
    } catch { /* noop */ }
    for (const r of roots) {
      candidates.push(path.join(r, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', exeName));
    }
  }

  // dedup + return first that exists as file
  const seen = new Set();
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch { /* noop */ }
  }
  // last resort — คืน path แรกที่ require() ให้มา ถึงไฟล์ไม่อยู่ก็ตาม
  // ให้ verifyFfmpeg() reportด้วย "exists=false" จะ debug ง่ายกว่าคืน null เฉย ๆ
  if (p) return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
  return null;
}

// ตรวจ ffmpeg ใช้งานได้จริง — spawn -version + capture stdout/exit code
// ผลลัพธ์ใช้ใน Settings UI + ส่งใน error report ให้ user copy
async function verifyFfmpeg(timeoutMs = 5000) {
  const result = {
    ok: false,
    path: null,
    exists: false,
    size: 0,
    isFile: false,
    execBit: null, // win32: null (NTFS ไม่มี concept นี้); posix: true/false
    spawnOk: false,
    versionLine: null,
    exitCode: null,
    error: null,
    durationMs: 0,
  };
  const t0 = Date.now();
  result.path = getFfmpegPath();
  if (!result.path) {
    result.error = 'getFfmpegPath() returned null — require(\'ffmpeg-static\') failed and no fallback found';
    return result;
  }
  let stat;
  try {
    stat = fs.statSync(result.path);
    result.exists = true;
    result.isFile = stat.isFile();
    result.size = stat.size;
  } catch (err) {
    result.error = `stat failed: ${err && err.message}`;
    result.durationMs = Date.now() - t0;
    return result;
  }
  if (!result.isFile) {
    result.error = `not a file (mode=${stat.mode.toString(8)})`;
    result.durationMs = Date.now() - t0;
    return result;
  }
  if (result.size < 1_000_000) {
    result.error = `binary too small (${result.size} bytes) — likely corrupted/incomplete download`;
    result.durationMs = Date.now() - t0;
    return result;
  }
  if (process.platform !== 'win32') {
    // posix: ตรวจ exec bit ของ owner (0o100) — afterPack chmod 0o755 ให้แล้ว
    // ถ้า strip ตอน sign / unzip → spawn จะ ENOEXEC/EACCES
    result.execBit = (stat.mode & 0o111) !== 0;
    if (!result.execBit) {
      result.error = `not executable (mode=${stat.mode.toString(8)}) — afterPack chmod อาจไม่ทำงาน`;
      result.durationMs = Date.now() - t0;
      return result;
    }
  }
  // spawn -version: ทดสอบจริงว่ารันได้ + AV ไม่บล็อก + exec format ถูก arch
  const { spawn } = require('node:child_process');
  try {
    await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const proc = spawn(result.path, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { proc.kill('SIGKILL'); } catch { /* noop */ }
        reject(new Error(`spawn timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      proc.stdout.on('data', (c) => { stdout += c.toString(); });
      proc.stderr.on('data', (c) => { stderr += c.toString(); });
      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        result.exitCode = code;
        result.spawnOk = code === 0;
        const firstLine = (stdout || stderr).split('\n')[0] || '';
        result.versionLine = firstLine.trim() || null;
        if (code !== 0) {
          result.error = `exit ${code}: ${(stderr || '').trim().slice(-200) || 'no stderr'}`;
        }
        resolve();
      });
    });
  } catch (err) {
    result.error = `spawn failed: ${err && err.message}`;
    result.durationMs = Date.now() - t0;
    return result;
  }
  result.ok = result.spawnOk && !!result.versionLine;
  result.durationMs = Date.now() - t0;
  return result;
}

module.exports = {
  getAppRoot,
  getInputDir,
  getOutputDir,
  getCacheRoot,
  getServiceCacheDir,
  getCacheSize,
  clearCache,
  getFfmpegPath,
  verifyFfmpeg,
  ensureDir,
  getDefaultInputDir,
  getDefaultOutputDir,
};
