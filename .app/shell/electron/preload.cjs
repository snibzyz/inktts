const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const subscribe = (channel, handler) => {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

contextBridge.exposeInMainWorld('inktts', {
  platform: process.platform,
  isMac: process.platform === 'darwin',

  app: {
    version: ipcRenderer.sendSync('app:getVersionSync'),
    checkUpdate: () => invoke('app:checkUpdate'),
    applyUpdate: () => invoke('app:applyUpdate'),
    onUpdateAvailable: (handler) => subscribe('app:updateAvailable', handler),
    onUpdateProgress: (handler) => subscribe('app:updateProgress', handler),
    onUpdateDownloaded: (handler) => subscribe('app:updateDownloaded', handler),
    onUpdateError: (handler) => subscribe('app:updateError', handler),
    diagnostics: () => invoke('app:diagnostics'),
    verifyFfmpeg: (timeoutMs) => invoke('app:verifyFfmpeg', { timeoutMs }),
    logTail: (bytes) => invoke('app:logTail', { bytes }),
    copyToClipboard: (text) => invoke('app:copyToClipboard', { text }),
    openLogFile: () => invoke('app:openLogFile'),
    revealLogFile: () => invoke('app:revealLogFile'),
  },

  window: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    toggleDevTools: () => invoke('window:toggleDevTools'),
    reload: () => invoke('window:reload'),
  },

  fs: {
    getAppRoot: () => invoke('fs:getAppRoot'),
    listInputFiles: (dir) => invoke('fs:listInputFiles', { dir }),
    listGlob: (pattern) => invoke('fs:listGlob', { pattern }),
    chooseFolder: (opts) => invoke('fs:chooseFolder', opts || {}),
    chooseFiles: (opts) => invoke('fs:chooseFiles', opts || {}),
    revealFolder: (p) => invoke('fs:revealFolder', { path: p }),
    openExternal: (url) => invoke('fs:openExternal', { url }),
    exists: (p) => invoke('fs:exists', { path: p }),
  },

  tts: {
    start: (payload) => invoke('tts:start', payload),
    cancel: (jobId) => invoke('tts:cancel', { jobId }),
    onEvent: (handler) => subscribe('tts:event', handler),
  },

  merge: {
    start: (payload) => invoke('merge:start', payload),
    detect: (srcDir, ext) => invoke('merge:detect', { srcDir, ext }),
    onLog: (handler) => subscribe('merge:log', handler),
    onDone: (handler) => subscribe('merge:done', handler),
  },

  settings: {
    get: () => invoke('settings:get'),
    patch: (partial) => invoke('settings:patch', partial),
    setInputDir: (dir) => invoke('settings:setInputDir', dir),
    setOutputDir: (dir) => invoke('settings:setOutputDir', dir),
  },

  cache: {
    size: () => invoke('cache:size'),
    clear: () => invoke('cache:clear'),
    clearService: (service) => invoke('cache:clearService', { service }),
    clearFiles: (service, bases) => invoke('cache:clearFiles', { service, bases }),
  },

  output: {
    clearFiles: (service, bases, opts) => invoke('output:clearFiles', { service, bases, ...(opts || {}) }),
  },
});
