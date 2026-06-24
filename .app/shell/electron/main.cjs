const { app, BrowserWindow, shell, Menu, clipboard } = require('electron');
const path = require('node:path');

if (app.isPackaged && process.resourcesPath) {
  process.env.NODE_PATH = path.join(process.resourcesPath, 'app.asar', 'node_modules');
  require('module').Module._initPaths();
}

const { registerWindowIpc } = require('./ipc/window.cjs');
const { registerFsIpc } = require('./ipc/fs.cjs');
const { registerTtsIpc } = require('./ipc/tts.cjs');
const { registerQueueIpc } = require('./ipc/queue.cjs');
const { registerSettingsIpc } = require('./ipc/settings.cjs');
const autoUpdate = require('./autoUpdate.cjs');
const { createLogger } = require('./helpers/logger.cjs');

const log = createLogger('main');
const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';

// Windows: bind taskbar + toast notifications to our AUMID so they show
// "INKTTS" (with our icon) instead of "electron.exe" / generic "Electron".
// Must run before any BrowserWindow is created. Linux/mac use bundle id.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.inktts.app');
}

let mainWindow = null;

// กัน Electron โชว์ default error dialog ("A JavaScript error occurred...")
// ทุกครั้งที่มี uncaught — โดยเฉพาะตอน TTS รัน parallel chunks 40 ตัวพร้อมกัน
// แล้วเจอ disk error → popup เด้งรัวจน user ต้อง kill app
// log ไว้พอ (logger.cjs ก็เขียนไฟล์ inktts.log ให้แล้ว) — process ยังทำงานต่อได้
process.on('uncaughtException', (err) => {
  try {
    log.error('uncaughtException', { error: (err && err.stack) || String(err) });
  } catch { /* logger เอง crash ก็ห้ามวน */ }
});
process.on('unhandledRejection', (reason) => {
  try {
    log.error('unhandledRejection', { reason: (reason && reason.stack) || String(reason) });
  } catch { /* noop */ }
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#1e1e1e',
    show: false,
    icon: path.join(__dirname, '..', 'public', 'logo.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      const wc = mainWindow.webContents;
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: 'detach' });
      event.preventDefault();
    } else if ((input.control || input.meta) && input.key.toLowerCase() === 'r' && !input.shift) {
      mainWindow.webContents.reload();
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.selectionText && params.selectionText.trim()) {
      items.push({ label: 'คัดลอก', role: 'copy' });
    }
    if (params.editFlags && params.editFlags.canPaste) {
      items.push({ label: 'วาง', role: 'paste' });
    }
    if (params.editFlags && params.editFlags.canSelectAll) {
      items.push({ type: 'separator' });
      items.push({ label: 'เลือกทั้งหมด', role: 'selectAll' });
    }
    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5473');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return mainWindow;
}

app.whenReady().then(() => {
  registerWindowIpc(() => mainWindow);
  registerFsIpc(() => mainWindow);
  registerTtsIpc(() => mainWindow);
  registerQueueIpc(() => mainWindow);
  registerSettingsIpc();
  autoUpdate.registerIpc();

  createMainWindow();
  // ส่ง getter — บน Mac ถ้า user ปิดแล้วเปิดใหม่ window instance จะใหม่ getter ดึงตัวล่าสุดได้
  autoUpdate.start(() => mainWindow);
  log.info('app ready', { isDev, version: app.getVersion() });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

// ก่อนปิดจริง — ถ้ามี staged update รออยู่ → apply เงียบ ๆ (swap exe + restart)
let _quitting = false;
app.on('before-quit', (event) => {
  if (_quitting) return;
  try {
    const applied = autoUpdate.applyStagedOnQuit?.();
    if (applied) {
      _quitting = true;
      event.preventDefault();
      log.info('staged update applying — app will relaunch via helper.cmd');
      setTimeout(() => app.exit(0), 300);
    }
  } catch (err) {
    log.warn('apply on quit failed', { error: err && err.message });
  }
});
