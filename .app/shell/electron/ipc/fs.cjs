const { ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { getAppRoot, getInputDir, getOutputDir } = require('../helpers/paths.cjs');

function registerFsIpc(getMainWindow) {
  ipcMain.handle('fs:getAppRoot', () => ({
    appRoot: getAppRoot(),
    inputDir: getInputDir(),
    outputDir: getOutputDir(),
  }));

  ipcMain.handle('fs:listInputFiles', (_e, payload) => {
    const dir = (payload && payload.dir) || getInputDir();
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
      .map((e) => path.join(dir, e.name))
      .sort();
  });

  ipcMain.handle('fs:listGlob', (_e, payload) => {
    const pattern = String(payload?.pattern || '');
    if (!pattern) return [];
    // simple glob: <dir>/*.txt
    const m = pattern.match(/^(.+?)[\\/]\*\.([a-zA-Z0-9]+)$/);
    let dir; let ext;
    if (m) { dir = m[1]; ext = m[2].toLowerCase(); }
    else if (fs.existsSync(pattern) && fs.statSync(pattern).isDirectory()) {
      dir = pattern; ext = 'txt';
    } else {
      return [];
    }
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(`.${ext}`))
      .map((e) => path.join(dir, e.name))
      .sort();
  });

  ipcMain.handle('fs:chooseFolder', async (_e, payload) => {
    const w = getMainWindow();
    const r = await dialog.showOpenDialog(w, {
      properties: ['openDirectory'],
      defaultPath: payload?.defaultPath || getInputDir(),
      title: payload?.title || 'เลือกโฟลเดอร์',
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('fs:chooseFiles', async (_e, payload) => {
    const w = getMainWindow();
    const r = await dialog.showOpenDialog(w, {
      properties: ['openFile', 'multiSelections'],
      defaultPath: payload?.defaultPath || getInputDir(),
      filters: payload?.filters || [
        { name: 'Text', extensions: ['txt'] },
        { name: 'All', extensions: ['*'] },
      ],
      title: payload?.title || 'เลือกไฟล์',
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('fs:revealFolder', async (_e, payload) => {
    const target = String(payload?.path || '');
    if (!target) return false;
    try {
      if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
      shell.openPath(target);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('fs:openExternal', (_e, payload) => {
    const url = String(payload?.url || '');
    if (!url) return false;
    shell.openExternal(url);
    return true;
  });

  ipcMain.handle('fs:exists', (_e, payload) => {
    const p = String(payload?.path || '');
    return p ? fs.existsSync(p) : false;
  });
}

module.exports = { registerFsIpc };
