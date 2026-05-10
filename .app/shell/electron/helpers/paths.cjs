const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const settings = require('./settings.cjs');

// "App root" — โฟลเดอร์ข้าง .exe (portable) หรือ workspace dir (dev)
function getAppRoot() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(process.execPath);
  return path.resolve(__dirname, '..', '..', '..', '..');
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch { /* noop */ }
  return p;
}

// Default = ข้าง .exe — user ทับด้วย settings.json ได้
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

// Cache อยู่ใน userData ดีกว่า — ไม่กิน disk ที่ workspace user
function getCacheDir() {
  return ensureDir(path.join(app.getPath('userData'), 'cache'));
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
  getCacheDir,
  getFfmpegPath,
  ensureDir,
  getDefaultInputDir,
  getDefaultOutputDir,
};
