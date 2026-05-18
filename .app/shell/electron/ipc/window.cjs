const { ipcMain, app, clipboard, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getFfmpegPath, verifyFfmpeg, getCacheRoot } = require('../helpers/paths.cjs');
const { getLogPath } = require('../helpers/logger.cjs');

function registerWindowIpc(getMainWindow) {
  ipcMain.handle('window:minimize', () => { getMainWindow()?.minimize(); });
  ipcMain.handle('window:maximize', () => {
    const w = getMainWindow();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle('window:close', () => { getMainWindow()?.close(); });
  ipcMain.handle('window:isMaximized', () => getMainWindow()?.isMaximized() ?? false);
  ipcMain.handle('window:toggleDevTools', () => {
    const wc = getMainWindow()?.webContents;
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  });
  ipcMain.handle('window:reload', () => { getMainWindow()?.webContents?.reload(); });

  ipcMain.on('app:getVersionSync', (event) => { event.returnValue = app.getVersion(); });

  // ข้อมูลวินิจฉัยปัญหา — UI ปุ่ม "คัดลอกรายงาน" ใช้สำหรับ user ส่ง debug log มาให้
  // เก็บ: version, OS, ffmpeg path/exists/size, log path, userData path
  ipcMain.handle('app:diagnostics', () => {
    const ffmpeg = getFfmpegPath();
    let ffmpegExists = false;
    let ffmpegSize = 0;
    let ffmpegError = null;
    if (ffmpeg) {
      try {
        const st = fs.statSync(ffmpeg);
        ffmpegExists = st.isFile();
        ffmpegSize = st.size;
      } catch (err) {
        ffmpegError = err && err.message;
      }
    }
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      electron: process.versions.electron,
      node: process.versions.node,
      isPackaged: app.isPackaged,
      portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
      execPath: process.execPath,
      resourcesPath: process.resourcesPath || null,
      userData: app.getPath('userData'),
      cacheRoot: getCacheRoot(),
      logPath: getLogPath(),
      ffmpeg: { path: ffmpeg, exists: ffmpegExists, size: ffmpegSize, error: ffmpegError },
    };
  });

  // tail ของ inktts.log — ใช้แนบใน "รายงานปัญหา" ให้ user copy ส่งมา
  // จำกัด 8KB ท้ายไฟล์ — log ยาวๆ ไม่ใช่ปัญหา (เปิด clipboard ได้แน่)
  // แต่จำกัดเพื่อกัน paste ลง chat แล้วทะลุ context
  ipcMain.handle('app:logTail', (_e, payload) => {
    const maxBytes = Math.max(512, Math.min(Number(payload?.bytes) || 8192, 65536));
    const p = getLogPath();
    if (!p) return { ok: false, error: 'log path unavailable' };
    try {
      const st = fs.statSync(p);
      const start = Math.max(0, st.size - maxBytes);
      const fd = fs.openSync(p, 'r');
      try {
        const buf = Buffer.alloc(st.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        return { ok: true, path: p, content: buf.toString('utf-8'), truncated: start > 0, totalSize: st.size };
      } finally { fs.closeSync(fd); }
    } catch (err) {
      return { ok: false, error: err && err.message, path: p };
    }
  });

  // ตรวจ ffmpeg จริง — spawn -version + capture exit code + stderr
  // ใช้สำหรับ "ตรวจระบบ" ปุ่มใน Settings + ใส่ใน error report
  ipcMain.handle('app:verifyFfmpeg', async (_e, payload) => {
    const timeout = Math.max(1000, Math.min(Number(payload?.timeoutMs) || 5000, 15000));
    try {
      return await verifyFfmpeg(timeout);
    } catch (err) {
      return { ok: false, error: `verify threw: ${err && err.message}` };
    }
  });

  // เขียนข้อความลง clipboard จาก main process — ปลอดภัยกว่า navigator.clipboard ใน renderer
  // (ใน packaged app บางที write จาก renderer ขึ้น permission prompt — main process ไม่ต้อง)
  ipcMain.handle('app:copyToClipboard', (_e, payload) => {
    const text = String(payload?.text ?? '');
    try {
      clipboard.writeText(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message };
    }
  });

  // เปิดไฟล์ log ใน default editor (Notepad/TextEdit/xdg-open)
  // ใช้กับปุ่ม "เปิดไฟล์ log" ใน Settings — user ส่งให้แอดมินได้สะดวกกว่า copy paste
  ipcMain.handle('app:openLogFile', async () => {
    const p = getLogPath();
    if (!p) return { ok: false, error: 'log path unavailable' };
    if (!fs.existsSync(p)) return { ok: false, error: `log file ไม่อยู่ที่ ${p}`, path: p };
    try {
      const result = await shell.openPath(p);
      if (result) return { ok: false, error: result, path: p };
      return { ok: true, path: p };
    } catch (err) {
      return { ok: false, error: err && err.message, path: p };
    }
  });

  // เปิด File Explorer แสดง log file (highlight ตัวไฟล์) — user copy/zip/send ได้
  ipcMain.handle('app:revealLogFile', () => {
    const p = getLogPath();
    if (!p) return { ok: false, error: 'log path unavailable' };
    try {
      shell.showItemInFolder(p);
      return { ok: true, path: p };
    } catch (err) {
      return { ok: false, error: err && err.message, path: p };
    }
  });
}

module.exports = { registerWindowIpc };
