const { ipcMain, app } = require('electron');
const settings = require('../helpers/settings.cjs');
const { getDefaultInputDir, getDefaultOutputDir, getCacheSize, clearCache, getCacheRoot } = require('../helpers/paths.cjs');

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
}

module.exports = { registerSettingsIpc };
