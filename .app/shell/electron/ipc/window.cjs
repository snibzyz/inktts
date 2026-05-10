const { ipcMain, app } = require('electron');

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
}

module.exports = { registerWindowIpc };
