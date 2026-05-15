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
function getFfmpegPath() {
  let p;
  try { p = require('ffmpeg-static'); } catch { p = null; }
  if (!p) return null;
  if (app.isPackaged) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
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
  ensureDir,
  getDefaultInputDir,
  getDefaultOutputDir,
};
