// Regression tests for bug claims raised in audit — verify the claims are FALSE
// (or fix the code if they're true).
//
// Claims being tested:
//   #1 — runner reports cache hits as failures to AdaptiveLimiter (FALSE — they skip reportOutcome entirely)
//   #2 — concurrent maybeFinalize causes _finalizeFile to run twice (FALSE — sync remaining decrement + guard)
//   #3 — same as #1
//   #4 — Edge tts.close() not called when withTimeout fires (FALSE — finally block runs)
//   #5 — _sleep waker can resolve+reject (FALSE — Promise can only settle once)

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

require.cache[require.resolve('electron')] = {
  exports: {
    app: {
      getPath: (k) => k === 'userData' ? path.join(os.tmpdir(), 'inktts-claims-test') : os.tmpdir(),
      getVersion: () => '0.0.0-test',
      isPackaged: false,
    },
    net: null,
  },
};

const { TTSJob } = require('../tts/runner.cjs');
const { AdaptiveLimiter, Semaphore } = require('../tts/adaptive.cjs');

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`[OK] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err && err.message}`);
    if (err && err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed += 1;
  }
}

function fakeFfmpegConcatStub() {
  // stub ffmpeg.cjs in require cache to skip actual ffmpeg call
  const ffmpegPath = require.resolve('../tts/ffmpeg.cjs');
  require.cache[ffmpegPath] = {
    exports: {
      ffmpegConcat: async (chunkPaths, listPath, outputPath) => {
        // emulate success — write a small fake file
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, Buffer.alloc(2048));
        return { ok: true };
      },
      ffmpegConcatCopy: async () => ({ ok: true }),
    },
  };
  // force runner to re-require with stub
  delete require.cache[require.resolve('../tts/runner.cjs')];
  return require('../tts/runner.cjs');
}

async function main() {
  // ── CLAIM #1 + #3: cache hits don't poison AdaptiveLimiter ──
  await test('cache-hit chunks do NOT call reportOutcome on AdaptiveLimiter', async () => {
    const { TTSJob: TJ } = fakeFfmpegConcatStub();
    const tmpInput = path.join(os.tmpdir(), 'inktts-claims-test', 'in.txt');
    fs.mkdirSync(path.dirname(tmpInput), { recursive: true });
    fs.writeFileSync(tmpInput, 'hello world\nsecond line\nthird line\nfourth line\nfifth line\n', 'utf-8');
    const outputDir = path.join(os.tmpdir(), 'inktts-claims-test', 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // pre-populate cache: 5 lines → 5 chunks (linesPerChunk=1)
    const cacheDir = path.join(os.tmpdir(), 'inktts-claims-test', 'cache', 'edge', 'in');
    fs.mkdirSync(cacheDir, { recursive: true });
    for (let i = 0; i < 5; i += 1) {
      fs.writeFileSync(path.join(cacheDir, `${String(i).padStart(6, '0')}.mp3`), Buffer.alloc(2048));
    }

    let reportOutcomeCalls = 0;
    let reportOutcomeFails = 0;
    const origReport = AdaptiveLimiter.prototype.reportOutcome;
    AdaptiveLimiter.prototype.reportOutcome = function (ok) {
      reportOutcomeCalls += 1;
      if (!ok) reportOutcomeFails += 1;
      return origReport.call(this, ok);
    };

    try {
      const job = new TJ({
        jobId: 'cache-test',
        serviceKey: 'edge',
        files: [tmpInput],
        options: {
          outputDir, fmt: 'm4a', batchSize: 1, connectionsPerFile: 1, retries: 1,
          voice: 'th-TH-PremwadeeNeural', rate: '+0%', linesPerChunk: 1,
        },
        onEvent: () => {},
      });
      await job.run();
      if (job.stats.filesDone !== 1) throw new Error(`expected 1 done, got ${JSON.stringify(job.stats)}`);
      if (reportOutcomeCalls !== 0) {
        throw new Error(`cache hits called reportOutcome ${reportOutcomeCalls} times (expected 0) — Bug #1 IS REAL`);
      }
    } finally {
      AdaptiveLimiter.prototype.reportOutcome = origReport;
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  // ── CLAIM #2: concurrent finalize race ──
  await test('_finalizeFile is called exactly once per file even with concurrent fetchOnes', async () => {
    let finalizeCalls = 0;
    const { TTSJob: TJ } = fakeFfmpegConcatStub();
    // wrap _finalizeFile to count
    const origFinalize = TJ.prototype._finalizeFile;
    TJ.prototype._finalizeFile = async function (state) {
      finalizeCalls += 1;
      return origFinalize.call(this, state);
    };

    const tmpInput = path.join(os.tmpdir(), 'inktts-claims-test', 'in2.txt');
    fs.writeFileSync(tmpInput, Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'), 'utf-8');
    const outputDir = path.join(os.tmpdir(), 'inktts-claims-test', 'out2');
    fs.mkdirSync(outputDir, { recursive: true });

    // populate ALL 20 chunks in cache so fetchOne hits cache path (fastest concurrent finish)
    const cacheDir = path.join(os.tmpdir(), 'inktts-claims-test', 'cache', 'edge', 'in2');
    fs.mkdirSync(cacheDir, { recursive: true });
    for (let i = 0; i < 20; i += 1) {
      fs.writeFileSync(path.join(cacheDir, `${String(i).padStart(6, '0')}.mp3`), Buffer.alloc(2048));
    }

    try {
      const job = new TJ({
        jobId: 'race-test',
        serviceKey: 'edge',
        files: [tmpInput],
        options: {
          outputDir, fmt: 'm4a', batchSize: 20, connectionsPerFile: 20, retries: 1,
          voice: 'th-TH-PremwadeeNeural', rate: '+0%', linesPerChunk: 1,
        },
        onEvent: () => {},
      });
      await job.run();
      if (finalizeCalls !== 1) {
        throw new Error(`_finalizeFile called ${finalizeCalls} times for 1 file (expected 1) — Bug #2 IS REAL`);
      }
    } finally {
      TJ.prototype._finalizeFile = origFinalize;
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  // ── CLAIM #4: Edge tts.close() must fire even when withTimeout rejects ──
  await test('Edge fetchChunk calls tts.close() when setMetadata times out', async () => {
    // mock msedge-tts to hang setMetadata
    let closeCalled = false;
    const mockModule = {
      MsEdgeTTS: class {
        async setMetadata() { return new Promise(() => {}); /* never resolves */ }
        async toStream() { throw new Error('unreachable'); }
        close() { closeCalled = true; }
      },
    };
    require.cache[require.resolve('msedge-tts')] = { exports: mockModule };
    // force re-require of edge.cjs
    delete require.cache[require.resolve('../tts/edge.cjs')];
    const edge = require('../tts/edge.cjs');

    const tmpOut = path.join(os.tmpdir(), 'inktts-claims-test', 'edge-timeout-test.mp3');
    let err = null;
    try {
      // Use a tiny timeout to test fast — patch the internal default by monkey-patching
      // Actually edge.cjs uses 15000 hardcoded. We can't change it without modifying source.
      // Instead, use Promise.race with our own timeout to short-circuit the test.
      await Promise.race([
        edge.fetchChunk({ text: 'test', outPath: tmpOut, voice: 'x', rate: '+0%' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('outer timeout')), 16000)),
      ]);
    } catch (e) {
      err = e;
    }
    if (!err) throw new Error('expected fetchChunk to reject');
    // closeCalled should be true via finally block, regardless of error
    if (!closeCalled) {
      throw new Error(`tts.close() not called after withTimeout reject — Bug #4 IS REAL`);
    }
    // Restore
    delete require.cache[require.resolve('msedge-tts')];
  });

  // ── CLAIM #5: sleep waker double-settle ──
  await test('_sleep waker resolves or rejects exactly once', async () => {
    delete require.cache[require.resolve('../tts/runner.cjs')];
    const { TTSJob: TJ } = require('../tts/runner.cjs');
    const job = new TJ({ jobId: 't', serviceKey: 'edge', files: [], options: {}, onEvent: () => {} });

    // Test 1: timeout fires normally
    let settled = 0;
    const p1 = job._sleep(50).then(() => settled += 1, () => settled += 1);
    await p1;
    if (settled !== 1) throw new Error(`p1 settled ${settled} times`);

    // Test 2: cancel before timeout
    settled = 0;
    const p2 = job._sleep(10000).then(() => settled += 1, () => settled += 1);
    setTimeout(() => job.cancel(), 50);
    await p2;
    if (settled !== 1) throw new Error(`p2 settled ${settled} times`);

    // Test 3: cancel + timeout race (small window)
    settled = 0;
    const p3 = job._sleep(50).then(() => settled += 1, () => settled += 1);
    setTimeout(() => job.cancel(), 49);  // race
    await p3;
    if (settled !== 1) throw new Error(`p3 settled ${settled} times — race!`);
  });

  // ── Bonus: ensure error string reaches prog event for FAIL/FFMPEG_FAIL ──
  await test('FFMPEG_FAIL prog event includes error string', async () => {
    // stub ffmpeg to fail
    require.cache[require.resolve('../tts/ffmpeg.cjs')] = {
      exports: {
        ffmpegConcat: async () => ({ ok: false, error: 'simulated ffmpeg failure' }),
        ffmpegConcatCopy: async () => ({ ok: false, error: 'simulated' }),
      },
    };
    delete require.cache[require.resolve('../tts/runner.cjs')];
    const { TTSJob: TJ } = require('../tts/runner.cjs');

    const tmpInput = path.join(os.tmpdir(), 'inktts-claims-test', 'in3.txt');
    fs.writeFileSync(tmpInput, 'line', 'utf-8');
    const outputDir = path.join(os.tmpdir(), 'inktts-claims-test', 'out3');
    const cacheDir = path.join(os.tmpdir(), 'inktts-claims-test', 'cache', 'edge', 'in3');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, '000000.mp3'), Buffer.alloc(2048));

    let ffmpegFailEvent = null;
    const job = new TJ({
      jobId: 'err-test',
      serviceKey: 'edge',
      files: [tmpInput],
      options: {
        outputDir, fmt: 'm4a', batchSize: 1, connectionsPerFile: 1, retries: 1,
        voice: 'x', rate: '+0%', linesPerChunk: 1,
      },
      onEvent: (evt) => {
        if (evt.type === 'prog' && evt.status === 'FFMPEG_FAIL') ffmpegFailEvent = evt;
      },
    });
    await job.run();
    if (!ffmpegFailEvent) throw new Error('no FFMPEG_FAIL event emitted');
    if (!ffmpegFailEvent.error || !ffmpegFailEvent.error.includes('simulated ffmpeg failure')) {
      throw new Error(`error not in prog event: ${JSON.stringify(ffmpegFailEvent)}`);
    }
  });

  // Cleanup
  try { fs.rmSync(path.join(os.tmpdir(), 'inktts-claims-test'), { recursive: true, force: true }); } catch {}

  console.log(`\n${failed === 0 ? '[done] all claim regression tests passed' : `[FAIL] ${failed} test(s) failed`}`);
  process.exit(failed);
}

main().catch((e) => { console.error(e); process.exit(1); });
