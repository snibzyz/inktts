const { ipcMain } = require('electron');
const queue = require('../tts/queue.cjs');
const { createLogger } = require('../helpers/logger.cjs');

const log = createLogger('queue-ipc');

function registerQueueIpc(getMainWindow) {
  const send = (channel, payload) => {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  // engine → renderer push channels
  queue.init({
    onUpdate: (evt) => send('queue:update', evt),   // { type:'snapshot'|'item', ... }
    onLog: (evt) => send('queue:log', evt),          // { itemId, level, message, ts }
    onNotice: (evt) => send('queue:notice', evt),    // { itemId, kind, message } → toast
  });
  log.info('queue ipc registered');

  // renderer → main (invoke)
  ipcMain.handle('queue:snapshot', () => queue.snapshot());
  ipcMain.handle('queue:add', (_e, payload) => queue.addItem(payload));
  ipcMain.handle('queue:updateItem', (_e, payload) => queue.updateItem(payload?.id, payload?.patch || {}));
  ipcMain.handle('queue:remove', (_e, payload) => queue.removeItem(payload?.id));
  ipcMain.handle('queue:clearDone', () => queue.clearDone());
  ipcMain.handle('queue:move', (_e, payload) => queue.moveItem(payload?.id, payload?.toIndex));
  ipcMain.handle('queue:start', (_e, payload) => queue.startItem(payload?.id));
  ipcMain.handle('queue:startAll', () => queue.startAll());
  ipcMain.handle('queue:cancel', (_e, payload) => queue.cancelItem(payload?.id));
  ipcMain.handle('queue:cancelAll', () => queue.cancelAll());
}

module.exports = { registerQueueIpc };
