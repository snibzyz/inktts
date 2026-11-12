import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { encodeArgs, EXPORT_KBPS, EXPORT_SAMPLE_RATE } = require('../tts/ffmpeg.cjs');

// ไฟล์ที่รวม/เปลี่ยนความเร็วต้องตรงมาตรฐาน INKREALM (โมโน 24 kHz 56 kbps · เว็บรับโดยไม่ต้องแปลงซ้ำเมื่อ ≤ 64 kbps)
// 13-11-2026: เดิม 128 kbps → เว็บต้องแปลงใหม่ทุกไฟล์
describe('export profile = INKREALM standard', () => {
  it('m4a: AAC mono 24 kHz 56 kbps', () => {
    expect(encodeArgs('m4a')).toEqual(['-c:a', 'aac', '-ac', '1', '-ar', '24000', '-b:a', '56k']);
  });

  it('mp3: same rate/channels/bitrate', () => {
    expect(encodeArgs('mp3')).toEqual(['-c:a', 'libmp3lame', '-ac', '1', '-ar', '24000', '-b:a', '56k']);
  });

  it('stays within what the website accepts without re-encoding (≤ 64 kbps · ≤ 32 kHz)', () => {
    expect(EXPORT_KBPS).toBeLessThanOrEqual(64);
    expect(EXPORT_SAMPLE_RATE).toBeLessThanOrEqual(32000);
  });
});
