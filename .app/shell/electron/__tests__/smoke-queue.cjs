// Full queue smoke test — drives the REAL queue engine end-to-end across all
// engines (edge, google, rv) as separate "เรื่อง", run sequentially, and verifies:
//   - sequential scheduling (never >1 item running at a time)
//   - each item produces a real .m4a that is > 1KB AND faststart (moov before mdat)
//   - per-item + per-file timing recorded
//   - auto-retry survives transient throttling
//   - queue persists to queue.json
//
// Network is real (same as smoke:tts); only Electron app/net are stubbed so it
// runs headless. Edge uses WebSocket (msedge-tts); google/rv use the net shim.
//
// Usage:  node electron/__tests__/smoke-queue.cjs [edge,google,rv]
//   (default: all three)

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const url = require('node:url');

// ── stub electron (app → isolated temp userData; net → real http/https) ──
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'inktts-queue-smoke-'));
const userData = path.join(tmpBase, 'userData');
fs.mkdirSync(userData, { recursive: true });

require.cache[require.resolve('electron')] = {
  exports: {
    app: { getPath: () => userData, getVersion: () => '0.0.0', isPackaged: false },
    net: {
      request: (opts) => {
        const target = typeof opts === 'string' ? opts : opts.url;
        const parsed = url.parse(target);
        const lib = parsed.protocol === 'http:' ? http : https;
        const handlers = { response: [], error: [] };
        const reqOpts = { method: 'GET', hostname: parsed.hostname, port: parsed.port, path: parsed.path, headers: {} };
        return {
          on(evt, fn) { handlers[evt] = handlers[evt] || []; handlers[evt].push(fn); return this; },
          setHeader(k, v) { reqOpts.headers[k] = v; },
          end() {
            const r = lib.request(reqOpts, (res) => {
              const wrapper = { statusCode: res.statusCode, headers: res.headers, on(e, fn) { res.on(e, fn); return this; } };
              for (const h of handlers.response) h(wrapper);
            });
            r.on('error', (err) => { for (const h of handlers.error) h(err); });
            r.end();
          },
        };
      },
    },
  },
};

const queue = require('../tts/queue.cjs');

const ENGINES = (process.argv[2] || 'edge,google,rv').split(',').map((s) => s.trim()).filter(Boolean);

const SAMPLE = {
  edge: 'สวัสดีครับ นี่คือการทดสอบคิวเสียง Edge แบบครบวงจร',
  google: 'สวัสดีครับ นี่คือการทดสอบคิวเสียง Google แบบครบวงจร',
  rv: 'สวัสดีครับ นี่คือการทดสอบคิวเสียง ResponsiveVoice แบบครบวงจร',
};
const RUN_OPTS = {
  edge: { batchSize: 1, connectionsPerFile: 1, voice: 'th-TH-PremwadeeNeural', rate: '+0%', linesPerChunk: 1 },
  google: { batchSize: 1, connectionsPerFile: 1, chunkChars: 120, tempo: 1.0, jitter: 0, lang: 'th' },
  rv: { batchSize: 1, connectionsPerFile: 1, gender: 'female', tempo: 1.0, rate: 0.5, chunkChars: 100 },
};

function atomOrder(file) {
  const buf = fs.readFileSync(file);
  const moov = buf.indexOf(Buffer.from('moov'));
  const mdat = buf.indexOf(Buffer.from('mdat'));
  return { size: buf.length, moov, mdat, faststart: moov >= 0 && mdat >= 0 && moov < mdat };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = ['done', 'done-with-errors', 'failed', 'cancelled'];

async function main() {
  queue.init({
    onUpdate: () => {},
    onLog: (l) => console.log(`  [${l.itemId.slice(-4)}] ${l.message}`),
    onNotice: (n) => console.log(`  [notice:${n.kind}] ${n.message}`),
  });

  const itemsMeta = [];
  for (const eng of ENGINES) {
    const inDir = path.join(tmpBase, `in-${eng}`);
    const outDir = path.join(tmpBase, `out-${eng}`);
    fs.mkdirSync(inDir, { recursive: true });
    fs.writeFileSync(path.join(inDir, 'ตอน 1.txt'), SAMPLE[eng] || SAMPLE.google, 'utf-8');
    const it = queue.addItem({
      name: `${eng}-story`, service: eng, presetIdx: 0,
      runOptions: RUN_OPTS[eng] || RUN_OPTS.google, inputDir: inDir, outputDir: outDir,
    });
    itemsMeta.push({ eng, id: it.id, outFile: path.join(outDir, 'ตอน 1.m4a') });
  }

  console.log(`[smoke:queue] engines=${ENGINES.join(',')} — starting all (sequential)...`);
  queue.startAll();

  // poll until all terminal; track max concurrent running (must stay <= 1)
  let maxRunning = 0;
  const deadline = Date.now() + 240000; // generous: Edge retries (5+10+15s) × engines
  while (Date.now() < deadline) {
    const snap = queue.snapshot();
    const running = snap.items.filter((it) => it.status === 'running').length;
    if (running > maxRunning) maxRunning = running;
    if (snap.items.every((it) => TERMINAL.includes(it.status))) break;
    await delay(150);
  }

  await delay(400); // allow debounced persistence
  const snap = queue.snapshot();
  const checks = [];
  const check = (label, cond) => { checks.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`); };

  console.log('\n== per-engine results ==');
  for (const m of itemsMeta) {
    const it = snap.items.find((x) => x.id === m.id);
    const exists = fs.existsSync(m.outFile);
    const ord = exists ? atomOrder(m.outFile) : null;
    const t = it.times && it.times[0] ? `${it.times[0].sec}s` : '—';
    console.log(`  ${m.eng}: status=${it.status} retry=${it.retryCount} out=${exists ? ord.size + 'B' : 'MISSING'} faststart=${ord ? ord.faststart : '-'} time=${t}`);
    check(`${m.eng}: status=done`, it.status === 'done');
    check(`${m.eng}: output .m4a > 1KB`, exists && ord.size > 1024);
    check(`${m.eng}: faststart (moov<mdat)`, exists && ord.faststart);
    check(`${m.eng}: per-file time recorded`, Array.isArray(it.times) && it.times.length >= 1 && typeof it.times[0].sec === 'number');
    check(`${m.eng}: timing startedAt+endedAt`, !!it.startedAt && !!it.endedAt && it.endedAt >= it.startedAt);
  }

  console.log('\n== queue-wide ==');
  check('sequential — never >1 running at once', maxRunning <= 1);
  check('all items reached terminal state', snap.items.every((it) => TERMINAL.includes(it.status)));

  // persistence
  const qf = path.join(userData, 'queue.json');
  let persisted = null;
  try { persisted = JSON.parse(fs.readFileSync(qf, 'utf-8')); } catch { /* */ }
  check(`queue.json persisted (${ENGINES.length} items)`, persisted && Array.isArray(persisted.items) && persisted.items.length === ENGINES.length);
  check('snapshot serializable (no internal Sets)', snap.items.every((it) => it._doneSet === undefined && it._fileStart === undefined));

  fs.rmSync(tmpBase, { recursive: true, force: true });
  const passed = checks.filter(Boolean).length;
  const ok = checks.every(Boolean);
  console.log(`\n${ok ? '[OK]' : '[FAIL]'} full queue test — ${passed}/${checks.length} checks · maxRunning=${maxRunning}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {} process.exit(1); });
