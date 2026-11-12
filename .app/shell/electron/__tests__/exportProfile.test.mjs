import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { encodeArgs, EXPORT_KBPS, EXPORT_SAMPLE_RATE, parseAudioProbe, withinWebStandard } = require('../tts/ffmpeg.cjs');

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

// รวมไฟล์ (merge) + ต่อชิ้น mp3 แบบ copy ต้องรู้ว่าไฟล์ต้นทางอยู่ในมาตรฐานเว็บไหม — ไม่งั้น copy พาบิตเรตเกินไปทั้งก้อน (13-11-2026)
describe('parseAudioProbe / withinWebStandard', () => {
  const OLD_INKTTS_M4A = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'ตอน 1.m4a':",
    '  Duration: 00:12:31.02, start: 0.000000, bitrate: 91 kb/s',
    '  Stream #0:0[0x1](und): Audio: aac (LC) (mp4a / 0x6134706D), 24000 Hz, mono, fltp, 89 kb/s (default)',
  ].join('\n');
  const EDGE_MP3 = [
    "Input #0, mp3, from '000001.mp3':",
    '  Duration: 00:00:03.12, start: 0.025057, bitrate: 48 kb/s',
    '  Stream #0:0: Audio: mp3 (mp3float), 24000 Hz, mono, fltp, 48 kb/s',
  ].join('\n');
  const STEREO_44K = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.m4a':",
    '  Duration: 00:00:05.00, start: 0.000000, bitrate: 52 kb/s',
    '  Stream #0:0[0x1](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 50 kb/s (default)',
  ].join('\n');

  it('อ่านสเปกจากข้อความ ffmpeg -i (ใช้บิตเรตทั้งไฟล์ = แบบที่เว็บวัด)', () => {
    expect(parseAudioProbe(OLD_INKTTS_M4A)).toEqual({ codec: 'aac', sampleRate: 24000, channels: 1, kbps: 91 });
    expect(parseAudioProbe(EDGE_MP3)).toEqual({ codec: 'mp3', sampleRate: 24000, channels: 1, kbps: 48 });
    expect(parseAudioProbe(STEREO_44K)).toEqual({ codec: 'aac', sampleRate: 44100, channels: 2, kbps: 52 });
    expect(parseAudioProbe('x.m4a: Invalid data found when processing input')).toBeNull();
  });

  it('เกิน 64 kbps · เกิน 32 kHz · สเตอริโอ · อ่านไม่ออก = ไม่อยู่ในมาตรฐาน', () => {
    expect(withinWebStandard(parseAudioProbe(EDGE_MP3))).toBe(true);
    expect(withinWebStandard(parseAudioProbe(OLD_INKTTS_M4A))).toBe(false);
    expect(withinWebStandard(parseAudioProbe(STEREO_44K))).toBe(false);
    expect(withinWebStandard(null)).toBe(false);
  });
});
