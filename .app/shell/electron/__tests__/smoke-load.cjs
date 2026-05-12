// Verify every electron module loads cleanly (no missing imports / typos)
// with electron stubbed. Catches stuff syntax-check misses (eg. require('./missing')).

const os = require('node:os');

require.cache[require.resolve('electron')] = {
  exports: {
    app: { getPath: () => os.tmpdir(), getVersion: () => '2.0.1', isPackaged: false, isReady: () => true, on: () => {}, whenReady: () => Promise.resolve() },
    BrowserWindow: class {},
    shell: { openExternal: () => {} },
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    clipboard: {},
    ipcMain: { handle: () => {}, on: () => {} },
    contextBridge: { exposeInMainWorld: () => {} },
    ipcRenderer: { invoke: () => {}, on: () => {}, off: () => {}, sendSync: () => '2.0.1' },
    dialog: {},
    net: { request: () => ({ on: () => {}, setHeader: () => {}, end: () => {}, abort: () => {} }) },
  },
};

const modules = [
  '../helpers/paths.cjs',
  '../helpers/logger.cjs',
  '../helpers/settings.cjs',
  '../ipc/settings.cjs',
  '../ipc/tts.cjs',
  '../ipc/fs.cjs',
  '../ipc/window.cjs',
  '../tts/runner.cjs',
  '../tts/edge.cjs',
  '../tts/google.cjs',
  '../tts/responsivevoice.cjs',
  '../tts/ffmpeg.cjs',
  '../tts/adaptive.cjs',
  '../tts/merge.cjs',
  '../tts/splitter.cjs',
  '../portableUpdate.cjs',
  '../autoUpdate.cjs',
];

let failures = 0;
for (const m of modules) {
  try {
    require(m);
    console.log(`[OK] ${m}`);
  } catch (err) {
    console.error(`[FAIL] ${m} — ${err.message}`);
    failures += 1;
  }
}

// Spot-check key exports
const paths = require('../helpers/paths.cjs');
const expectedExports = ['getAppRoot', 'getInputDir', 'getOutputDir', 'getCacheRoot', 'getServiceCacheDir', 'getCacheSize', 'clearCache', 'getFfmpegPath', 'ensureDir', 'getDefaultInputDir', 'getDefaultOutputDir'];
for (const name of expectedExports) {
  if (typeof paths[name] !== 'function') {
    console.error(`[FAIL] paths.${name} not exported`);
    failures += 1;
  } else {
    console.log(`[OK] paths.${name}`);
  }
}

const autoUpdate = require('../autoUpdate.cjs');
for (const name of ['start', 'registerIpc', 'applyStagedOnQuit']) {
  if (typeof autoUpdate[name] !== 'function') {
    console.error(`[FAIL] autoUpdate.${name} not exported`);
    failures += 1;
  } else {
    console.log(`[OK] autoUpdate.${name}`);
  }
}

const adaptive = require('../tts/adaptive.cjs');
for (const name of ['AdaptiveLimiter', 'Semaphore', 'CancelledError']) {
  if (typeof adaptive[name] !== 'function') {
    console.error(`[FAIL] adaptive.${name} not exported`);
    failures += 1;
  } else {
    console.log(`[OK] adaptive.${name}`);
  }
}

// Smoke: AdaptiveLimiter.abort() rejects pending waiters
(async () => {
  const lim = new adaptive.AdaptiveLimiter({ initial: 1 });
  await lim.acquire();
  const pendingPromise = lim.acquire().then(() => 'resolved').catch((e) => `rejected:${e.name}`);
  setTimeout(() => lim.abort(), 50);
  const result = await pendingPromise;
  if (result === 'rejected:CancelledError') console.log('[OK] AdaptiveLimiter.abort rejects pending waiter');
  else { console.error(`[FAIL] expected rejected:CancelledError, got ${result}`); failures += 1; }

  if (failures > 0) {
    console.error(`\n[FAIL] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\n[OK] all load + export checks passed');
})();
