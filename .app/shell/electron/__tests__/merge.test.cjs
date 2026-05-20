// Test: รวมไฟล์เสียง — ไม่ parse ชื่อไฟล์ แค่ "นับไฟล์ + เรียง natural sort + แบ่งกลุ่ม"
// ครอบคลุม: ไฟล์ต้นทางชื่ออะไรก็ได้ · output ตั้งชื่อเองได้ · autodetect เดาค่าเริ่มต้น
//
// run: node electron/__tests__/merge.test.cjs   (cwd = .app/shell)

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

require.cache[require.resolve('electron')] = {
  exports: { app: { getPath: () => os.tmpdir(), getVersion: () => '1.0.0', isPackaged: false } },
};

const { mergeGroups, detectAudioFiles } = require('../tts/merge.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const realDir = path.join(repoRoot, 'output', 'edge');
const testRoot = path.join(os.tmpdir(), 'inktts-merge-test');

let realPool = [];
function makeDir(name, fileNames) {
  const dir = path.join(testRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // copy .m4a จริงมาเปลี่ยนชื่อ — ffmpeg ต้องการไฟล์เสียงจริง
  fileNames.forEach((fn, i) => {
    fs.copyFileSync(path.join(realDir, realPool[i % realPool.length]), path.join(dir, fn));
  });
  return dir;
}

let failed = 0;
function check(cond, msg) {
  if (cond) console.log(`  [OK] ${msg}`);
  else { console.error(`  [FAIL] ${msg}`); failed += 1; }
}

async function main() {
  realPool = fs.readdirSync(realDir).filter((f) => f.toLowerCase().endsWith('.m4a')).sort();
  if (realPool.length < 10) { console.error('ต้องมี .m4a จริง >= 10 ไฟล์ใน output/edge'); process.exit(2); }
  fs.rmSync(testRoot, { recursive: true, force: true });

  // Test 1 — เคสจริงของ user: ไฟล์ต้นทาง "1.m4a".."40.m4a" อยากได้ผลลัพธ์ "ตอน N-M"
  console.log('Test 1: ไฟล์ "1.m4a".."40.m4a" → outPrefix "ตอน "');
  const d1 = makeDir('t1', Array.from({ length: 40 }, (_, i) => `${i + 1}.m4a`));
  const r1 = await mergeGroups({
    srcDir: d1, dstDir: path.join(testRoot, 't1_out'),
    outPrefix: 'ตอน ', start: 1, end: 40, group: 10, ext: 'm4a', onLog: () => {},
  });
  check(r1.totalGroups === 4 && r1.failed === 0, `merged 4 groups, 0 failed (ได้ ${r1.totalGroups}/${r1.failed})`);
  for (const n of ['ตอน 1-10.m4a', 'ตอน 11-20.m4a', 'ตอน 21-30.m4a', 'ตอน 31-40.m4a']) {
    const p = path.join(testRoot, 't1_out', n);
    check(fs.existsSync(p) && fs.statSync(p).size > 1024, `${n} ถูกสร้าง > 1KB`);
  }

  // Test 2 — autodetect: ไฟล์ไม่มีคำนำหน้า
  console.log('Test 2: autodetect "1.m4a".."40.m4a"');
  const det2 = detectAudioFiles(d1, 'm4a');
  check(!!det2 && det2.count === 40 && det2.start === 1 && det2.prefix === '',
    `count=40 start=1 prefix="" — ${JSON.stringify(det2)}`);

  // Test 3 — natural sort + autodetect: "บทที่ 7".."บทที่ 11" ต้องเรียง 7,8,9,10,11
  //   (string sort ผิด ๆ จะได้ 10,11,7,8,9 → start เดาเป็น 10)
  console.log('Test 3: natural sort — "บทที่ 7".."บทที่ 11"');
  const d3 = makeDir('t3', [7, 8, 9, 10, 11].map((n) => `บทที่ ${n}.m4a`));
  const det3 = detectAudioFiles(d3, 'm4a');
  check(!!det3 && det3.start === 7 && det3.prefix === 'บทที่ ' && det3.count === 5,
    `autodetect start=7 prefix="บทที่ " count=5 — ${JSON.stringify(det3)}`);

  // Test 4 — ไฟล์ต้นทางชื่ออะไรก็ได้ + ตั้งชื่อ output เอง
  console.log('Test 4: ไฟล์ชื่อมั่ว → output custom');
  const d4 = makeDir('t4', ['xyz.m4a', 'abc.m4a', 'def.m4a', 'ggg.m4a', 'mmm.m4a']);
  const r4 = await mergeGroups({
    srcDir: d4, dstDir: path.join(testRoot, 't4_out'),
    outPrefix: 'ส่วน ', start: 1, end: 5, group: 2, ext: 'm4a', onLog: () => {},
  });
  check(r4.totalGroups === 3 && r4.failed === 0, `5 ไฟล์ กลุ่มละ 2 → 3 กลุ่ม (ได้ ${r4.totalGroups})`);
  for (const n of ['ส่วน 1-2.m4a', 'ส่วน 3-4.m4a', 'ส่วน 5-5.m4a']) {
    check(fs.existsSync(path.join(testRoot, 't4_out', n)), `${n} ถูกสร้าง`);
  }

  if (failed) { console.error(`\n[FAIL] ${failed} ข้อไม่ผ่าน`); process.exit(1); }
  console.log('\n[PASS] merge test ผ่านทั้งหมด');
  process.exit(0);
}

main().catch((err) => { console.error('[FAIL]', err); process.exit(1); });
