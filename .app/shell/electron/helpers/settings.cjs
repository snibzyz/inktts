// Persistent user settings — เก็บที่ %APPDATA%/INKTTS/settings.json (Windows)
//                                หรือ ~/Library/Application Support/INKTTS/settings.json (Mac)
//
// Schema (ดูเพิ่มที่ DEFAULT_SETTINGS ด้านล่าง):
//   {
//     "version": 1,
//     "paths": { "inputDir": null|string, "outputDir": null|string },
//     "services": { edge: {...}, google: {...}, rv: {...} },
//     "merge": { srcDir, prefix, group, ext },
//     "view": 'edge' | 'google' | 'rv' | 'merge' | 'settings'
//   }
//
// ค่า null ใน paths = ใช้ default (ข้าง .exe หรือ workspace dir)
// อ่าน/เขียนแบบ atomic (write to .tmp → rename) เพื่อกันไฟล์เสียระหว่างเขียน

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { createLogger } = require('./logger.cjs');

const log = createLogger('settings');
const SETTINGS_VERSION = 1;

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  paths: { inputDir: null, outputDir: null },
  services: {
    edge: null,
    google: null,
    rv: null,
  },
  merge: null,
  view: 'edge',
};

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function read() {
  const file = getSettingsPath();
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };
    const txt = fs.readFileSync(file, 'utf-8');
    const data = JSON.parse(txt);
    if (!data || typeof data !== 'object') {
      log.warn('settings malformed — using defaults');
      return { ...DEFAULT_SETTINGS };
    }
    if (data.version !== SETTINGS_VERSION) {
      log.warn('settings version mismatch, attempting best-effort migration', { found: data.version, expected: SETTINGS_VERSION });
    }
    return {
      ...DEFAULT_SETTINGS,
      ...data,
      paths: { ...DEFAULT_SETTINGS.paths, ...(data.paths || {}) },
      services: { ...DEFAULT_SETTINGS.services, ...(data.services || {}) },
    };
  } catch (err) {
    log.warn('read failed — using defaults', { error: err && err.message });
    return { ...DEFAULT_SETTINGS };
  }
}

function write(data) {
  const file = getSettingsPath();
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const safe = { ...DEFAULT_SETTINGS, ...data, version: SETTINGS_VERSION };
    fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    log.warn('write failed', { error: err && err.message });
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
    return false;
  }
}

function patch(partial) {
  const cur = read();
  const next = {
    ...cur,
    ...partial,
    paths: { ...(cur.paths || {}), ...((partial && partial.paths) || {}) },
    services: { ...(cur.services || {}), ...((partial && partial.services) || {}) },
    merge: partial && partial.merge !== undefined
      ? { ...(cur.merge || {}), ...(partial.merge || {}) }
      : cur.merge,
  };
  return write(next);
}

// Helpers สำหรับ paths.cjs — รวมไว้ที่นี่กัน import ซ้อน
function getCustomInputDir() {
  const s = read();
  return (s.paths && s.paths.inputDir) || null;
}
function getCustomOutputDir() {
  const s = read();
  return (s.paths && s.paths.outputDir) || null;
}

module.exports = {
  read,
  write,
  patch,
  getSettingsPath,
  getCustomInputDir,
  getCustomOutputDir,
};
