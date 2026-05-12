// End-to-end verification: generate audio for all 3 engines fresh
// + probe each output with ffmpeg to verify it's actually valid Thai TTS audio
// + run a "rate sanity" test on Edge: +50% should produce shorter file than -20%

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

// Stub Electron + net for engines that use it
require.cache[require.resolve('electron')] = {
  exports: {
    app: { getPath: () => os.tmpdir(), getVersion: () => '2.0.1', isPackaged: false },
    net: null,
  },
};
const https = require('node:https');
const http = require('node:http');
const url = require('node:url');
require.cache[require.resolve('electron')].exports.net = {
  request: (opts) => {
    const target = typeof opts === 'string' ? opts : opts.url;
    const parsed = url.parse(target);
    const lib = parsed.protocol === 'http:' ? http : https;
    const handlers = {};
    const reqOpts = { method: 'GET', hostname: parsed.hostname, port: parsed.port, path: parsed.path, headers: {} };
    let aborted = false;
    const r = {
      on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return this; },
      setHeader(k, v) { reqOpts.headers[k] = v; },
      abort() { aborted = true; if (this._req) this._req.destroy(); },
      end() {
        const inner = lib.request(reqOpts, (res) => {
          if (aborted) return;
          const wrapper = { statusCode: res.statusCode, headers: res.headers, on(evt, fn) { res.on(evt, fn); return this; } };
          (handlers.response || []).forEach((h) => h(wrapper));
        });
        inner.on('error', (err) => { (handlers.error || []).forEach((h) => h(err)); });
        inner.end();
        this._req = inner;
      },
    };
    return r;
  },
};

const { TTSJob } = require('../tts/runner.cjs');
const { clearCache } = require('../helpers/paths.cjs');
const ffmpeg = require('ffmpeg-static');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const inputDir = path.join(repoRoot, 'input');
const fixturesDir = path.join(repoRoot, '_cache', 'verify');
fs.mkdirSync(fixturesDir, { recursive: true });

const SAMPLE_TEXT = (() => {
  // ใช้ข้อความจริงจาก input/ ตัด 250 ตัว
  const f = fs.readdirSync(inputDir).filter((x) => x.endsWith('.txt'))[0];
  return fs.readFileSync(path.join(inputDir, f), 'utf-8').slice(0, 250);
})();

function probe(file) {
  // ใช้ ffmpeg -i เพื่อดู metadata (no output codec → exit 1 พร้อม stderr ที่มี info)
  const p = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf-8' });
  const out = p.stderr || '';
  const dur = out.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  const audio = out.match(/Audio:\s*([^,]+),\s*(\d+)\s*Hz,\s*(\w+),\s*[^,]+,\s*(\d+)\s*kb\/s/);
  return {
    seconds: dur ? (+dur[1] * 3600 + +dur[2] * 60 + +dur[3]) : null,
    codec: audio ? audio[1].trim() : null,
    sampleRate: audio ? +audio[2] : null,
    channels: audio ? audio[3] : null,
    bitrate: audio ? +audio[4] : null,
  };
}

async function runOne({ name, service, options }) {
  const inputFile = path.join(fixturesDir, `verify-${name}.txt`);
  fs.writeFileSync(inputFile, SAMPLE_TEXT, 'utf-8');
  const outputDir = path.join(repoRoot, 'output', service === 'rv' ? 'responsivevoice' : service);
  const outName = `verify-${name}`;
  const outPath = path.join(outputDir, `${outName}.m4a`);
  try { fs.unlinkSync(outPath); } catch {}

  const start = Date.now();
  const job = new TTSJob({
    jobId: name,
    serviceKey: service,
    files: [inputFile],
    options: { outputDir, fmt: 'm4a', batchSize: 1, connectionsPerFile: 1, retries: 6, tempo: 1.0, ...options },
    onEvent: () => {},
  });
  await job.run();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  if (!fs.existsSync(outPath)) return { name, ok: false, error: 'output not created' };
  const size = fs.statSync(outPath).size;
  if (size < 1024) return { name, ok: false, error: `too small: ${size} B` };
  const meta = probe(outPath);
  return { name, ok: true, outPath, size, elapsed, meta, options };
}

(async () => {
  console.log(`[info] sample text (${SAMPLE_TEXT.length} chars): ${JSON.stringify(SAMPLE_TEXT.slice(0, 60))}...`);
  console.log('[info] clearing cache for fresh runs');
  clearCache();

  const results = [];

  // === Engine sanity: default rates, all 3 engines ===
  console.log('\n=== TEST 1: ทุก engine, default rate ===');
  results.push(await runOne({
    name: 'edge-default', service: 'edge',
    options: { voice: 'th-TH-PremwadeeNeural', rate: '+30%', linesPerChunk: 1 },
  }));
  results.push(await runOne({
    name: 'google-default', service: 'google',
    options: { chunkChars: 120, tempo: 1.3, lang: 'th', jitter: 0 },
  }));
  results.push(await runOne({
    name: 'rv-default', service: 'rv',
    options: { gender: 'female', tempo: 1.3, rate: 0.5, chunkChars: 100, lang: 'th', jitter: 0 },
  }));

  // === Rate sanity: Edge slow vs fast — duration should differ ===
  console.log('\n=== TEST 2: Edge rate sanity (slow vs fast) ===');
  results.push(await runOne({
    name: 'edge-fast', service: 'edge',
    options: { voice: 'th-TH-PremwadeeNeural', rate: '+80%', linesPerChunk: 1 },
  }));
  results.push(await runOne({
    name: 'edge-slow', service: 'edge',
    options: { voice: 'th-TH-PremwadeeNeural', rate: '-20%', linesPerChunk: 1 },
  }));

  // === Voice sanity: Edge male voice ===
  console.log('\n=== TEST 3: Edge male voice (Niwat) ===');
  results.push(await runOne({
    name: 'edge-male', service: 'edge',
    options: { voice: 'th-TH-NiwatNeural', rate: '+30%', linesPerChunk: 1 },
  }));

  // === Tempo on Google (ffmpeg atempo path) ===
  console.log('\n=== TEST 4: Google tempo +50% vs -20% ===');
  results.push(await runOne({
    name: 'google-fast', service: 'google',
    options: { chunkChars: 120, tempo: 1.5, lang: 'th', jitter: 0 },
  }));
  results.push(await runOne({
    name: 'google-slow', service: 'google',
    options: { chunkChars: 120, tempo: 0.8, lang: 'th', jitter: 0 },
  }));

  // === Report ===
  console.log('\n=== RESULTS ===');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('name', 18), pad('ok', 4), pad('size', 9), pad('dur', 7), pad('codec', 10), pad('bitrate', 8), 'opts');
  console.log('-'.repeat(110));
  let allOk = true;
  for (const r of results) {
    if (!r.ok) {
      console.log(pad(r.name, 18), pad('FAIL', 4), '—', r.error);
      allOk = false;
      continue;
    }
    const m = r.meta || {};
    console.log(
      pad(r.name, 18),
      pad('OK', 4),
      pad(`${(r.size / 1024).toFixed(1)}K`, 9),
      pad(`${m.seconds?.toFixed(2)}s`, 7),
      pad(m.codec || '?', 10),
      pad(`${m.bitrate || '?'}k`, 8),
      JSON.stringify(r.options),
    );
  }

  // === Cross-check rate sanity ===
  console.log('\n=== RATE SANITY ===');
  const efast = results.find((r) => r.name === 'edge-fast')?.meta?.seconds;
  const eslow = results.find((r) => r.name === 'edge-slow')?.meta?.seconds;
  const edef = results.find((r) => r.name === 'edge-default')?.meta?.seconds;
  console.log(`Edge: slow(-20%)=${eslow?.toFixed(2)}s  default(+30%)=${edef?.toFixed(2)}s  fast(+80%)=${efast?.toFixed(2)}s`);
  if (eslow != null && efast != null && eslow > efast) console.log('[OK] Edge: -20% ยาวกว่า +80% (rate ทำงาน)');
  else { console.log('[FAIL] Edge: rate ไม่ส่งผลถึง duration'); allOk = false; }

  const gfast = results.find((r) => r.name === 'google-fast')?.meta?.seconds;
  const gslow = results.find((r) => r.name === 'google-slow')?.meta?.seconds;
  console.log(`Google: slow(0.8x)=${gslow?.toFixed(2)}s  fast(1.5x)=${gfast?.toFixed(2)}s`);
  if (gslow != null && gfast != null && gslow > gfast) console.log('[OK] Google: 0.8x ยาวกว่า 1.5x (tempo ทำงาน)');
  else { console.log('[FAIL] Google: tempo ไม่ส่งผลถึง duration'); allOk = false; }

  // === Codec sanity ===
  console.log('\n=== CODEC SANITY ===');
  for (const r of results) {
    if (!r.ok) continue;
    const m = r.meta || {};
    const codecOk = m.codec && /aac|mp4a/i.test(m.codec);
    console.log(codecOk ? '[OK]' : '[FAIL]', r.name, '→', m.codec, m.sampleRate, 'Hz', m.channels);
    if (!codecOk) allOk = false;
  }

  console.log();
  if (!allOk) { console.error('[FAIL] some checks failed'); process.exit(1); }
  console.log('[OK] all full-flow checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
