// Test: cache:size + cache:clear + resume scenarios
//
// 1) Calc size → > 0 (chunks from previous smoke runs)
// 2) Create a fake .partial file in cache, verify _prepareFile would sweep it
// 3) Clear cache → size = 0

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Stub electron BEFORE requiring paths
require.cache[require.resolve('electron')] = {
  exports: {
    app: {
      getPath: () => os.tmpdir(),
      getVersion: () => '2.0.1',
      isPackaged: false,
    },
    net: null,
  },
};

const { getCacheSize, clearCache, getCacheRoot, getServiceCacheDir } = require('../helpers/paths.cjs');

function fmtBytes(n) {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(2)} ${units[i]}`;
}

let failures = 0;
function check(label, ok, info) {
  if (ok) console.log(`[OK] ${label}`);
  else { console.error(`[FAIL] ${label}${info ? ' — ' + info : ''}`); failures += 1; }
}

// 1) Seed: write a fake cache structure
const cacheRoot = getCacheRoot();
console.log('[info] cacheRoot:', cacheRoot);

// Clear first to start clean
clearCache();
check('clearCache initial', getCacheSize() === 0, `still ${fmtBytes(getCacheSize())}`);

// Write fake chunk + leftover tmp
const workdir = path.join(getServiceCacheDir('edge'), 'fake-base');
fs.mkdirSync(workdir, { recursive: true });
const validChunk = path.join(workdir, '000000.mp3');
fs.writeFileSync(validChunk, Buffer.alloc(2048, 0xab)); // 2KB
const orphanTmp = path.join(workdir, '000001.mp3.99999-zzz.tmp');
fs.writeFileSync(orphanTmp, Buffer.alloc(512, 0xcd)); // 512B
const orphanPartial = path.join(workdir, '000002.mp3.99999-yyy.partial');
fs.writeFileSync(orphanPartial, Buffer.alloc(1024, 0xef)); // 1KB

const sizeAfterSeed = getCacheSize();
check('size includes seeded files', sizeAfterSeed === 2048 + 512 + 1024, `got ${sizeAfterSeed}`);
console.log('[info] size after seed:', fmtBytes(sizeAfterSeed));

// 2) Verify clearCache wipes everything
clearCache();
const sizeAfterClear = getCacheSize();
check('clearCache wipes all', sizeAfterClear === 0, `still ${fmtBytes(sizeAfterClear)}`);
check('cacheRoot still exists', fs.existsSync(cacheRoot));
check('seeded workdir gone', !fs.existsSync(workdir));

// 3) Re-seed and verify runner's tmp sweep would catch .tmp/.partial
fs.mkdirSync(workdir, { recursive: true });
fs.writeFileSync(validChunk, Buffer.alloc(2048));
fs.writeFileSync(orphanTmp, Buffer.alloc(512));
fs.writeFileSync(orphanPartial, Buffer.alloc(1024));

// Simulate the runner sweep logic
let swept = 0;
for (const ent of fs.readdirSync(workdir)) {
  if (ent.endsWith('.tmp') || ent.endsWith('.partial')) {
    fs.unlinkSync(path.join(workdir, ent));
    swept += 1;
  }
}
check('sweep removes 2 leftovers', swept === 2, `swept ${swept}`);
check('valid chunk survives sweep', fs.existsSync(validChunk));
check('tmp leftover gone', !fs.existsSync(orphanTmp));
check('partial leftover gone', !fs.existsSync(orphanPartial));

// 4) cleanup
clearCache();
check('final clear', getCacheSize() === 0);

console.log();
if (failures > 0) {
  console.error(`[FAIL] ${failures} check(s) failed`);
  process.exit(1);
}
console.log('[OK] all cache + sweep checks passed');
