const { ipcMain, app } = require('electron');
const settings = require('../helpers/settings.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { getDefaultInputDir, getDefaultOutputDir, getCacheSize, clearCache, clearServiceCache, clearFileChunks, getCacheRoot, getOutputDir } = require('../helpers/paths.cjs');

function registerSettingsIpc() {
  // อ่านทั้งก้อน — renderer hydrate state ตอน boot
  ipcMain.handle('settings:get', () => {
    const data = settings.read();
    return {
      data,
      defaults: {
        inputDir: getDefaultInputDir(),
        outputDir: getDefaultOutputDir(),
      },
      settingsPath: settings.getSettingsPath(),
      userDataDir: app.getPath('userData'),
    };
  });

  // patch — รับ partial object ใด ๆ ไป merge กับ current
  ipcMain.handle('settings:patch', (_e, partial) => {
    if (!partial || typeof partial !== 'object') return { ok: false, error: 'invalid payload' };
    const ok = settings.patch(partial);
    return { ok };
  });

  // เซ็ต/รีเซ็ต folder — null = กลับไป default
  ipcMain.handle('settings:setInputDir', (_e, dir) => {
    const ok = settings.patch({ paths: { inputDir: dir || null } });
    return { ok };
  });
  ipcMain.handle('settings:setOutputDir', (_e, dir) => {
    const ok = settings.patch({ paths: { outputDir: dir || null } });
    return { ok };
  });

  // Cache management — chunks/<service>/<base>/*.mp3 ใน userData/cache/
  ipcMain.handle('cache:size', () => {
    try { return { ok: true, bytes: getCacheSize(), path: getCacheRoot() }; }
    catch (err) { return { ok: false, error: err && err.message, bytes: 0 }; }
  });
  ipcMain.handle('cache:clear', () => {
    try { const ok = clearCache(); return { ok }; }
    catch (err) { return { ok: false, error: err && err.message }; }
  });

  // ลบ cache เฉพาะ 1 service — เรียกจาก "เริ่มใหม่" ในหน้า ServicePanel
  // หรือปุ่ม per-service ในหน้า Settings
  ipcMain.handle('cache:clearService', (_e, payload) => {
    const service = payload && payload.service;
    if (!service) return { ok: false, error: 'service required' };
    return clearServiceCache(service);
  });

  // ลบ chunks ของไฟล์เฉพาะรายชื่อ (เผื่ออนาคต UI granular)
  ipcMain.handle('cache:clearFiles', (_e, payload) => {
    const service = payload && payload.service;
    const bases = payload && payload.bases;
    if (!service || !Array.isArray(bases)) return { ok: false, error: 'service+bases required' };
    return clearFileChunks(service, bases);
  });

  // ลบไฟล์ output (.m4a) ของ bases ที่ระบุ ใน folder ของ service
  // เรียกจาก ServicePanel "เริ่มใหม่" เมื่อ user เลือก option "ลบ audio เก่า"
  // payload: { service, outputDir?, bases: [string], ext?: 'm4a' }
  ipcMain.handle('output:clearFiles', (_e, payload) => {
    const service = payload && payload.service;
    const bases = payload && payload.bases;
    const ext = (payload && payload.ext) || 'm4a';
    if (!service || !Array.isArray(bases)) return { ok: false, error: 'service+bases required', deleted: 0, bytesFreed: 0 };
    const subdir = service === 'rv' ? 'responsivevoice' : service;
    const outputDir = (payload && payload.outputDir) || path.join(getOutputDir(), subdir);
    let deleted = 0;
    let bytesFreed = 0;
    const failed = [];
    for (const base of bases) {
      if (!base || typeof base !== 'string') continue;
      // กัน path traversal
      if (base.includes('/') || base.includes('\\') || base.includes('..')) continue;
      const p = path.join(outputDir, `${base}.${ext}`);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) {
          bytesFreed += st.size;
          fs.unlinkSync(p);
          deleted += 1;
        }
      } catch (err) {
        if (err && err.code !== 'ENOENT') failed.push({ base, error: err.message });
      }
    }
    return { ok: true, deleted, bytesFreed, ...(failed.length ? { failed } : {}) };
  });
}

module.exports = { registerSettingsIpc };
