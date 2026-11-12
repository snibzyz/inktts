// Smoke: รวมไฟล์เสียง (merge) ได้ไฟล์ตามมาตรฐานเว็บ INKREALM เสมอ — 13-11-2026
//   1) ไฟล์ต้นทางเกินมาตรฐาน (128k สเตอริโอ 44.1 kHz แบบ INKTTS รุ่นเก่า/โปรแกรมอื่น) → ผลลัพธ์ ≤ 64 kbps โมโน ≤ 32 kHz
//   2) ไฟล์ต้นทางอยู่ในมาตรฐานแล้ว → ต่อแบบ copy (บิตเรตเท่าเดิม ไม่เข้ารหัสซ้ำ)
//   3) mp3 เกินมาตรฐาน → ผลลัพธ์ mp3 ≤ 64 kbps
// ใช้ ffmpeg จริงของแอป (ffmpeg-static) สร้างไฟล์ทดสอบเอง — ไม่ต้องมีไฟล์ใน output/
// run: node electron/__tests__/smoke-merge-standard.cjs   (cwd = .app/shell)

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

require.cache[require.resolve('electron')] = {
  exports: { app: { getPath: () => os.tmpdir(), getVersion: () => '1.0.0', isPackaged: false } },
};

const { getFfmpegPath } = require('../helpers/paths.cjs');
const { mergeGroups } = require('../tts/merge.cjs');
const { probeAudio, withinWebStandard } = require('../tts/ffmpeg.cjs');

const root = path.join(os.tmpdir(), 'inktts-merge-standard');
let failed = 0;
const check = (cond, msg) => { if (cond) console.log(`  [OK] ${msg}`); else { console.error(`  [FAIL] ${msg}`); failed += 1; } };

function makeTone(file, codecArgs, seconds = 6, freq = 440) {
  const r = spawnSync(getFfmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=44100:duration=${seconds}`,
    '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.2:sample_rate=44100:duration=${seconds}`, '-filter_complex', 'amix=inputs=2', ...codecArgs, file], { windowsHide: true });
  if (r.status !== 0) throw new Error(`สร้างไฟล์ทดสอบไม่ได้: ${String(r.stderr).slice(-300)}`);
}

async function mergeDir(name, ext, codecArgs, n = 3) {
  const src = path.join(root, name);
  const dst = path.join(root, `${name}_out`);
  fs.mkdirSync(src, { recursive: true });
  for (let i = 1; i <= n; i++) makeTone(path.join(src, `${i}.${ext}`), codecArgs, 6, 300 + i * 50);
  const logs = [];
  const r = await mergeGroups({ srcDir: src, dstDir: dst, outPrefix: 'ตอน ', start: 1, end: n, group: n, ext, onLog: (lvl, msg) => logs.push(`${lvl} ${msg}`) });
  const out = path.join(dst, `ตอน 1-${n}.${ext}`);
  const inProbe = await probeAudio(path.join(src, `1.${ext}`));
  const outProbe = fs.existsSync(out) ? await probeAudio(out) : null;
  return { r, logs, inProbe, outProbe };
}

async function main() {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  console.log('1) m4a 128k สเตอริโอ 44.1 kHz → ต้องย่อ');
  const a = await mergeDir('over_m4a', 'm4a', ['-ac', '2', '-ar', '44100', '-c:a', 'aac', '-b:a', '128k']);
  check(a.r.totalGroups === 1 && a.r.failed === 0, `รวมได้ 1 กลุ่ม (${JSON.stringify(a.r)})`);
  check(!withinWebStandard(a.inProbe), `ต้นทางเกินมาตรฐานจริง ${JSON.stringify(a.inProbe)}`);
  check(withinWebStandard(a.outProbe), `ผลลัพธ์อยู่ในมาตรฐาน ${JSON.stringify(a.outProbe)}`);
  check(a.logs.some((l) => l.includes('ย่อเป็น 56 kbps')), 'log บอกผู้ใช้ว่าย่อให้');

  console.log('2) m4a 48k โมโน 24 kHz (อยู่ในมาตรฐาน) → copy');
  const b = await mergeDir('ok_m4a', 'm4a', ['-ac', '1', '-ar', '24000', '-c:a', 'aac', '-b:a', '48k']);
  check(b.r.totalGroups === 1 && b.r.failed === 0, `รวมได้ 1 กลุ่ม (${JSON.stringify(b.r)})`);
  check(withinWebStandard(b.inProbe) && withinWebStandard(b.outProbe), `ต้น ${JSON.stringify(b.inProbe)} · ผล ${JSON.stringify(b.outProbe)}`);
  check(!b.logs.some((l) => l.includes('ย่อเป็น')), 'ไม่เข้ารหัสซ้ำ (copy)');

  console.log('3) mp3 128k สเตอริโอ 44.1 kHz → ต้องย่อ');
  const c = await mergeDir('over_mp3', 'mp3', ['-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k']);
  check(c.r.totalGroups === 1 && c.r.failed === 0, `รวมได้ 1 กลุ่ม (${JSON.stringify(c.r)})`);
  check(withinWebStandard(c.outProbe), `ผลลัพธ์ mp3 อยู่ในมาตรฐาน ${JSON.stringify(c.outProbe)}`);

  if (failed) { console.error(`\n[FAIL] ${failed} ข้อไม่ผ่าน`); process.exit(1); }
  console.log('\n[PASS] merge ได้ไฟล์ตามมาตรฐานเว็บทุกกรณี');
  process.exit(0);
}

main().catch((err) => { console.error('[FAIL]', err); process.exit(1); });
