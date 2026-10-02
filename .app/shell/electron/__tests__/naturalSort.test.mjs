/**
 * ลำดับไฟล์ตอน — ต้องเรียงแบบ natural sort (เคสจริง 02-10-2026: Bing ทำเสียงเรียง 1, 10, 100 … 109, 11)
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { compareNatural, sortPathsNatural } = require('../helpers/naturalSort.cjs');
const { TTSJob } = require('../tts/runner.cjs');

const dir = path.join('D:', 'novel', 'clean');
const names = (paths) => paths.map((p) => path.basename(p));

describe('naturalSort — ลำดับตอน', () => {
  it('ตัวเลขล้วน: 2 มาก่อน 10, 11 มาก่อน 100', () => {
    const files = ['1.txt', '10.txt', '100.txt', '101.txt', '109.txt', '11.txt', '2.txt', '9.txt'].map((n) => path.join(dir, n));
    expect(names(sortPathsNatural(files))).toEqual(['1.txt', '2.txt', '9.txt', '10.txt', '11.txt', '100.txt', '101.txt', '109.txt']);
  });

  it('มีคำนำหน้า (ตอนที่ / ep_)', () => {
    expect(['ตอนที่ 10', 'ตอนที่ 9', 'ตอนที่ 100'].sort(compareNatural)).toEqual(['ตอนที่ 9', 'ตอนที่ 10', 'ตอนที่ 100']);
    expect(['ep_12', 'ep_2', 'ep_1'].sort(compareNatural)).toEqual(['ep_1', 'ep_2', 'ep_12']);
  });

  it('ไม่แก้ array ต้นฉบับ (dialog / store ของผู้เรียก)', () => {
    const files = ['10.txt', '2.txt'];
    sortPathsNatural(files);
    expect(files).toEqual(['10.txt', '2.txt']);
  });

  it('TTSJob เรียงไฟล์ตามตอนเอง ไม่ว่าส่งมาลำดับไหน', () => {
    const files = ['100.txt', '11.txt', '10.txt', '1.txt', '2.txt'].map((n) => path.join(dir, n));
    const job = new TTSJob({ jobId: 't', serviceKey: 'bing', files, options: {} });
    expect(names(job.files)).toEqual(['1.txt', '2.txt', '10.txt', '11.txt', '100.txt']);
  });
});
