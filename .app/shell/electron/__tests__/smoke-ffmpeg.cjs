// Test ffmpeg verification end-to-end — dev + simulated packaged
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let isPackaged = false;
let mockExecPath = process.execPath;
let mockResourcesPath = null;
require.cache[require.resolve('electron')] = {
  exports: {
    app: {
      getPath: (k) => {
        if (k === 'userData') return path.join(os.tmpdir(), 'inktts-test');
        return os.tmpdir();
      },
      getVersion: () => '2.0.4-test',
      get isPackaged() { return isPackaged; },
    },
    net: null,
  },
};

const realResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
Object.defineProperty(process, 'resourcesPath', { get: () => mockResourcesPath, configurable: true });

const realExecPath = process.execPath;
Object.defineProperty(process, 'execPath', { get: () => mockExecPath, configurable: true });

async function test(name, fn) {
  try {
    await fn();
    console.log(`[OK] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err && err.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  // ── Dev mode ──
  isPackaged = false;
  delete require.cache[require.resolve('../helpers/paths.cjs')];
  const paths = require('../helpers/paths.cjs');

  await test('dev: getFfmpegPath returns existing file', async () => {
    const p = paths.getFfmpegPath();
    if (!p) throw new Error('null returned');
    if (!fs.existsSync(p)) throw new Error(`not found: ${p}`);
    console.log(`     path: ${p}`);
  });

  await test('dev: verifyFfmpeg ok=true with version line', async () => {
    const r = await paths.verifyFfmpeg(8000);
    if (!r.ok) throw new Error(`not ok: ${r.error}`);
    if (!r.versionLine || !r.versionLine.toLowerCase().includes('ffmpeg')) {
      throw new Error(`bad version line: ${r.versionLine}`);
    }
    if (r.size < 1_000_000) throw new Error(`size too small: ${r.size}`);
    console.log(`     ${r.versionLine}`);
    console.log(`     size=${(r.size / 1024 / 1024).toFixed(1)}MB exec=${r.execBit} duration=${r.durationMs}ms`);
  });

  // ── Simulated packaged (asar replace) ──
  // verify the .replace('app.asar', 'app.asar.unpacked') path works
  isPackaged = true;
  // Create a fake app.asar.unpacked structure pointing to real ffmpeg
  const fakeRoot = path.join(os.tmpdir(), 'inktts-fake-packaged');
  const fakeUnpacked = path.join(fakeRoot, 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static');
  fs.mkdirSync(fakeUnpacked, { recursive: true });
  const realFfmpeg = require('ffmpeg-static');
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const fakeFfmpeg = path.join(fakeUnpacked, ffmpegName);
  // hard copy small wrapper script that returns ffmpeg -version (avoid 80MB copy)
  // we'll just hardlink/symlink the real binary
  try {
    if (fs.existsSync(fakeFfmpeg)) fs.unlinkSync(fakeFfmpeg);
    fs.linkSync(realFfmpeg, fakeFfmpeg);
  } catch {
    fs.copyFileSync(realFfmpeg, fakeFfmpeg);
  }
  mockResourcesPath = path.join(fakeRoot, 'resources');
  mockExecPath = path.join(fakeRoot, 'app.exe');

  delete require.cache[require.resolve('../helpers/paths.cjs')];
  const paths2 = require('../helpers/paths.cjs');

  await test('packaged: fallback resourcesPath/app.asar.unpacked works when require returns asar path', async () => {
    // require('ffmpeg-static') returns the dev path. After packaged replace, this won't exist.
    // But fallback should find fakeFfmpeg via resourcesPath
    const p = paths2.getFfmpegPath();
    if (!p) throw new Error('null returned');
    if (!fs.existsSync(p)) throw new Error(`not found: ${p}`);
    console.log(`     resolved to: ${p}`);
  });

  await test('packaged: verifyFfmpeg spawn works through fallback path', async () => {
    const r = await paths2.verifyFfmpeg(8000);
    if (!r.ok) throw new Error(`not ok: ${r.error}`);
    console.log(`     ${r.versionLine}`);
  });

  // ── INKTTS_FFMPEG_PATH env override ──
  await test('env override: INKTTS_FFMPEG_PATH wins', async () => {
    process.env.INKTTS_FFMPEG_PATH = realFfmpeg;
    delete require.cache[require.resolve('../helpers/paths.cjs')];
    const paths3 = require('../helpers/paths.cjs');
    const p = paths3.getFfmpegPath();
    if (p !== realFfmpeg) throw new Error(`expected ${realFfmpeg}, got ${p}`);
    delete process.env.INKTTS_FFMPEG_PATH;
  });

  // ── Cleanup ──
  try { fs.rmSync(fakeRoot, { recursive: true, force: true }); } catch { /* noop */ }
  Object.defineProperty(process, 'resourcesPath', realResourcesPath || { value: undefined, configurable: true });
  Object.defineProperty(process, 'execPath', { value: realExecPath, configurable: true });

  console.log('\n[done] ffmpeg verify tests complete');
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
