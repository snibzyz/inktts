// Smoke test: instantiate the TTS runner directly outside Electron and produce
// a single .m4a file for one engine on a single short input.
//
// Usage:
//   node electron/tts/__smoke.cjs <edge|google|rv> [input_basename]
// Default input: "input/ติดหนี้สามสิบล้าน 401.txt" (truncated to 200 chars for speed)

const fs = require('node:fs');
const path = require('node:path');

// Stub electron so paths/ipc helpers don't crash when running outside Electron
require.cache[require.resolve('electron')] = {
  exports: {
    app: {
      getPath: (k) => {
        if (k === 'temp') return require('node:os').tmpdir();
        if (k === 'userData') return require('node:os').tmpdir();
        return require('node:os').tmpdir();
      },
      getVersion: () => '1.0.0',
      isPackaged: false,
    },
    net: null,
  },
};

// patch net for engines that use Electron's net (google, rv, portable updater)
const https = require('node:https');
const http = require('node:http');
const url = require('node:url');

require.cache[require.resolve('electron')].exports.net = {
  request: (opts) => {
    const target = typeof opts === 'string' ? opts : opts.url;
    const parsed = url.parse(target);
    const lib = parsed.protocol === 'http:' ? http : https;
    const handlers = { response: [], error: [] };
    const reqOpts = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      headers: {},
    };
    return {
      on(evt, fn) { handlers[evt] = handlers[evt] || []; handlers[evt].push(fn); return this; },
      setHeader(k, v) { reqOpts.headers[k] = v; },
      end() {
        const r = lib.request(reqOpts, (res) => {
          // simulate Electron net response API
          const wrapper = {
            statusCode: res.statusCode,
            headers: res.headers,
            on(evt, fn) { res.on(evt, fn); return this; },
          };
          for (const h of handlers.response) h(wrapper);
        });
        r.on('error', (err) => { for (const h of handlers.error) h(err); });
        r.end();
      },
    };
  },
};

const { TTSJob } = require('../tts/runner.cjs');

async function main() {
  const service = process.argv[2] || 'edge';
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const inputDir = path.join(repoRoot, 'input');
  const outputDir = path.join(repoRoot, 'output', service === 'rv' ? 'responsivevoice' : service);

  const all = fs.readdirSync(inputDir).filter((f) => f.endsWith('.txt'));
  if (!all.length) { console.error('no input .txt files in', inputDir); process.exit(2); }
  const pickName = process.argv[3] || all[0];
  const inputPath = path.join(inputDir, pickName);
  if (!fs.existsSync(inputPath)) { console.error('not found:', inputPath); process.exit(2); }

  // Truncate to 200 chars for a fast smoke test → write to a temp file
  const text = fs.readFileSync(inputPath, 'utf-8').slice(0, 200);
  const tmpDir = path.join(repoRoot, '_cache', 'smoke');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpInput = path.join(tmpDir, `smoke-${service}.txt`);
  fs.writeFileSync(tmpInput, text, 'utf-8');

  // Force unique output name
  const outBase = `smoke-${service}`;
  const outRenamed = path.join(tmpDir, `${outBase}.txt`);
  fs.copyFileSync(tmpInput, outRenamed);

  const events = [];
  const job = new TTSJob({
    jobId: 'smoke',
    serviceKey: service,
    files: [outRenamed],
    options: (() => {
      const base = {
        outputDir, fmt: 'm4a', batchSize: 1, connectionsPerFile: 1, retries: 2,
        tempo: 1.0, lang: 'th', jitter: 0,
      };
      if (service === 'edge') return { ...base, voice: 'th-TH-PremwadeeNeural', rate: '+30%', linesPerChunk: 1 };
      if (service === 'google') return { ...base, chunkChars: 120 };
      if (service === 'rv') return { ...base, gender: 'female', rate: 0.5, chunkChars: 100 };
      return base;
    })(),
    onEvent: (evt) => {
      events.push(evt);
      console.log(`[evt] ${evt.type}`, JSON.stringify({ ...evt, jobId: undefined, type: undefined }));
    },
  });

  console.log(`[smoke] service=${service} input=${outRenamed}`);
  console.log(`[smoke] outputDir=${outputDir}`);
  await job.run();

  // verify output exists and > 1KB
  const outPath = path.join(outputDir, `${outBase}.m4a`);
  if (!fs.existsSync(outPath)) {
    console.error('[FAIL] output not created:', outPath);
    process.exit(1);
  }
  const sz = fs.statSync(outPath).size;
  if (sz < 1024) {
    console.error(`[FAIL] output too small (${sz} bytes):`, outPath);
    process.exit(1);
  }
  console.log(`[OK] ${outPath} (${sz} bytes)`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
