// Test: resume after various interrupted states
//
// Scenarios:
//   A. Power loss mid-chunk-write: `.tmp` leftover, no `.mp3` → next run re-fetches
//   B. Crash after some chunks done: 50% chunks exist → next run only fetches missing
//   C. Crash mid-ffmpeg-concat: `.partial-*.m4a` leftover → next run sweeps it + re-concats
//   D. Output file already exists (full skip)

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

require.cache[require.resolve('electron')] = {
  exports: {
    app: { getPath: () => os.tmpdir(), getVersion: () => '2.0.1', isPackaged: false },
    net: null,
  },
};

const { TTSJob } = require('../tts/runner.cjs');
const { clearCache, getServiceCacheDir } = require('../helpers/paths.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const inputDir = path.join(repoRoot, 'input');
const outputDir = path.join(repoRoot, 'output', 'edge');

let failures = 0;
function check(label, ok, info) {
  if (ok) console.log(`[OK] ${label}`);
  else { console.error(`[FAIL] ${label}${info ? ' — ' + info : ''}`); failures += 1; }
}

async function runJob(testName, options = {}) {
  const tmpDir = path.join(repoRoot, '_cache', 'smoke');
  fs.mkdirSync(tmpDir, { recursive: true });
  const inputPath = path.join(tmpDir, `${testName}.txt`);
  const text = fs.readFileSync(path.join(inputDir, fs.readdirSync(inputDir).filter((f) => f.endsWith('.txt'))[0]), 'utf-8').slice(0, 200);
  fs.writeFileSync(inputPath, text, 'utf-8');

  const start = Date.now();
  const job = new TTSJob({
    jobId: testName,
    serviceKey: 'edge',
    files: [inputPath],
    options: {
      outputDir, fmt: 'm4a', batchSize: 1, connectionsPerFile: 1, retries: 2,
      tempo: 1.0, voice: 'th-TH-PremwadeeNeural', rate: '+30%', linesPerChunk: 1,
      ...options,
    },
    onEvent: () => {},
  });
  await job.run();
  return { elapsed: (Date.now() - start) / 1000, stats: job.stats };
}

(async () => {
  // Reset everything first
  clearCache();
  const outName = `resume-test.m4a`;
  const outPath = path.join(outputDir, outName);
  try { fs.unlinkSync(outPath); } catch {}

  // --- Scenario A: fresh run (baseline) ---
  console.log('\n--- Scenario A: fresh run ---');
  const r1 = await runJob('resume-test');
  check('A: m4a output exists', fs.existsSync(outPath) && fs.statSync(outPath).size > 1024);
  console.log(`[info] elapsed=${r1.elapsed}s chunksDone=${r1.stats.chunksDone}`);

  // --- Scenario B: simulate power loss with partial chunks ---
  console.log('\n--- Scenario B: kill output + partial chunks → resume ---');
  fs.unlinkSync(outPath);
  // Simulate: delete chunks 1 + 2, keep chunks 0 (and any others)
  const workdir = path.join(getServiceCacheDir('edge'), 'resume-test');
  const existingChunks = fs.readdirSync(workdir).filter((f) => f.endsWith('.mp3')).sort();
  if (existingChunks.length >= 2) {
    // Delete last chunk to force re-fetch
    const toDelete = path.join(workdir, existingChunks[existingChunks.length - 1]);
    fs.unlinkSync(toDelete);
    console.log(`[info] deleted ${existingChunks[existingChunks.length - 1]} to simulate partial state`);
  }
  const r2 = await runJob('resume-test');
  check('B: m4a recreated after partial', fs.existsSync(outPath) && fs.statSync(outPath).size > 1024);
  check('B: faster than fresh (chunks reused)', r2.elapsed < r1.elapsed, `was ${r2.elapsed}s vs ${r1.elapsed}s fresh`);

  // --- Scenario C: stale .partial-*.m4a leftover in output dir ---
  console.log('\n--- Scenario C: stale .partial in output dir → swept ---');
  fs.unlinkSync(outPath);
  const fakePartial = path.join(outputDir, `resume-test.partial-99999-xxxx.m4a`);
  fs.writeFileSync(fakePartial, Buffer.alloc(8192));
  check('C: fake partial seeded', fs.existsSync(fakePartial));
  await runJob('resume-test');
  check('C: m4a regenerated', fs.existsSync(outPath) && fs.statSync(outPath).size > 1024);
  check('C: stale partial swept', !fs.existsSync(fakePartial));

  // --- Scenario D: output already done → SKIP ---
  console.log('\n--- Scenario D: output already done → SKIP ---');
  const sizeBefore = fs.statSync(outPath).size;
  const r3 = await runJob('resume-test');
  check('D: SKIP path used (no chunks done this run)', r3.stats.filesSkipped === 1 && r3.stats.chunksDone === 0);
  check('D: existing m4a untouched', fs.statSync(outPath).size === sizeBefore);
  check('D: instant (< 0.5s)', r3.elapsed < 0.5, `was ${r3.elapsed}s`);

  // --- Scenario E: leftover .tmp inside workdir → swept on next prepare ---
  console.log('\n--- Scenario E: leftover .tmp in workdir → swept ---');
  fs.unlinkSync(outPath);
  const orphan = path.join(workdir, `999999.mp3.99999-xx.tmp`);
  fs.writeFileSync(orphan, Buffer.alloc(123));
  check('E: orphan tmp seeded', fs.existsSync(orphan));
  await runJob('resume-test');
  check('E: m4a regenerated', fs.existsSync(outPath) && fs.statSync(outPath).size > 1024);
  check('E: orphan tmp swept', !fs.existsSync(orphan));

  // Cleanup
  try { fs.unlinkSync(outPath); } catch {}
  clearCache();

  console.log();
  if (failures > 0) {
    console.error(`[FAIL] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('[OK] all resume scenarios passed');
})().catch((err) => { console.error(err); process.exit(1); });
