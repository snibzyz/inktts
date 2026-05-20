// Smoke test: merge_groups port. Uses existing output/edge/*.m4a if present.

const fs = require('node:fs');
const path = require('node:path');

require.cache[require.resolve('electron')] = {
  exports: {
    app: { getPath: () => require('node:os').tmpdir(), getVersion: () => '1.0.0', isPackaged: false },
  },
};

const { mergeGroups, detectAudioFiles } = require('../tts/merge.cjs');

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const srcDir = path.join(repoRoot, 'output', 'edge');
  const dstDir = path.join(repoRoot, 'output', 'edge_merged_test');

  // clean dst
  if (fs.existsSync(dstDir)) fs.rmSync(dstDir, { recursive: true, force: true });

  // Detect
  const det = detectAudioFiles(srcDir, 'm4a');
  if (!det) { console.error('no .m4a in', srcDir); process.exit(2); }
  console.log('[detect]', det);

  const start = det.start;
  const end = Math.min(det.start + 4, det.end);
  console.log(`[smoke] merging ${start}-${end} (group=2)`);

  const result = await mergeGroups({
    srcDir, dstDir, outPrefix: det.prefix, start, end, group: 2, ext: 'm4a',
    onLog: (lvl, msg) => console.log(`[${lvl}]`, msg),
  });

  console.log('[result]', result);

  const merged = fs.readdirSync(dstDir).filter((f) => f.endsWith('.m4a'));
  if (!merged.length) { console.error('[FAIL] no merged files'); process.exit(1); }
  for (const m of merged) {
    const sz = fs.statSync(path.join(dstDir, m)).size;
    if (sz < 1024) { console.error('[FAIL] tiny file', m, sz); process.exit(1); }
    console.log('[OK]', m, '(', sz, 'bytes )');
  }
  console.log('[OK] merge smoke passed');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
