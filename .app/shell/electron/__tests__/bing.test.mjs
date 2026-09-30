/**
 * บริการ Bing (Premwadee ผ่าน Bing Translator) — session parsing + การจัดประเภท error + ลองใหม่ในตัว
 * วัดจริง 30-09-2026: ช่วง Edge Premwadee ช้า Bing ตอบ ~2 วิ/ประโยค · HTTP 500 สุ่มตอนยิงหนัก (ลองใหม่ผ่าน)
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { parseSessionPage, toSsmlText, toProsodyRate, minBytesFor } = require('../tts/bingTts.cjs');
const bing = require('../tts/bing.cjs');
const { ENGINES } = require('../tts/runner.cjs');

describe('bingTts — session จากหน้า translator', () => {
  it('แกะ IG / IID / key / token / อายุ', () => {
    const html = '<div data-iid="translator.5023"></div><script>_G={IG:"ABC123",x:1};var params_AbusePreventionHelper = [1759200000000,"tok_xyz",3600000];</script>';
    expect(parseSessionPage(html)).toEqual({ IG: 'ABC123', IID: 'translator.5023', key: '1759200000000', token: 'tok_xyz', ttlMs: 3600000 });
  });

  it('ไม่มี data-iid → ใช้ค่าเริ่มต้น', () => {
    const html = '_G={IG:"Q"};params_AbusePreventionHelper=[1,"t",900000]';
    expect(parseSessionPage(html)).toMatchObject({ IG: 'Q', IID: 'translator.5023', ttlMs: 900000 });
  });

  it('หน้าไม่มี token (โดนบล็อก/หน้าเปลี่ยน) → null ไม่เดาค่า', () => {
    expect(parseSessionPage('<html>captcha</html>')).toBeNull();
    expect(parseSessionPage('_G={IG:"X"}')).toBeNull();
  });
});

describe('bingTts — ข้อความ / ความเร็ว / ขนาดขั้นต่ำ', () => {
  it('escape & < > และตัด control char ที่ XML ไม่รับ', () => {
    expect(toSsmlText('A&B <ทักษะ>\u0001')).toBe('A&amp;B &lt;ทักษะ&gt;');
  });

  it('ความเร็วแปลงเป็น prosody rate แบบ Edge', () => {
    expect(toProsodyRate('+30%')).toBe('+30%');
    expect(toProsodyRate('-10%')).toBe('-10%');
    expect(toProsodyRate('0%')).toBe('+0%');
    expect(toProsodyRate(25)).toBe('+25%');
    expect(toProsodyRate(undefined)).toBe('+0%');
    expect(toProsodyRate('<bad>')).toBe('+0%');
  });

  it('byte floor ยืดตามความยาว (ไม่นับช่องว่าง)', () => {
    expect(minBytesFor('สั้น')).toBe(1500);
    expect(minBytesFor('ก'.repeat(100))).toBe(6000);
    expect(minBytesFor('ก '.repeat(100))).toBe(6000);
  });
});

describe('bing engine — จัดประเภท error', () => {
  it('HTTP 5xx / too-small / timeout / เส้นหลุด = ลองใหม่เร็ว', () => {
    for (const m of ['bing: HTTP 500', 'bing: HTTP 503', 'bing: too-small (900/1500)', 'timeout', 'This operation was aborted']) {
      expect(bing.classifyError(new Error(m))).toBe('retry');
    }
    const net = new Error('fetch failed');
    net.cause = { code: 'ECONNRESET', message: 'socket hang up' };
    expect(bing.classifyError(net)).toBe('retry');
  });

  it('401 / 403 / 429 / เปิด session ไม่ได้ = พักแล้วขอ session ใหม่', () => {
    for (const m of ['bing: HTTP 401', 'bing: HTTP 403', 'bing: HTTP 429', 'bing: เปิด session ไม่ได้ (HTTP 200)']) {
      expect(bing.classifyError(new Error(m))).toBe('session');
    }
  });

  it('HTTP 400 (ข้อความพัง) = โยนทันที ไม่วนเปล่า', () => {
    expect(bing.classifyError(new Error('bing: HTTP 400'))).toBe('fatal');
  });

  it('เพดานต่อคำขอยืดตามความยาว', () => {
    expect(bing.requestTimeoutFor('ก'.repeat(900))).toBeGreaterThan(bing.requestTimeoutFor('ก'));
  });
});

describe('bing engine — fetchChunk ลองใหม่ในตัว + เขียน atomic', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inktts-bing-'));
  afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('500 สองครั้งแล้วผ่าน → เขียนไฟล์ ไม่มี .tmp ค้าง', async () => {
    let calls = 0;
    const outPath = path.join(tmpDir, 'ok.mp3');
    await bing.fetchChunk({
      text: 'สวัสดี', outPath, gapMs: 1,
      synth: async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('bing: HTTP 500'), { status: 500 });
        return Buffer.alloc(4000, 1);
      },
    });
    expect(calls).toBe(3);
    expect(fs.statSync(outPath).size).toBe(4000);
    expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('error fatal → โยนทันทีครั้งเดียว', async () => {
    let calls = 0;
    await expect(bing.fetchChunk({
      text: 'x', outPath: path.join(tmpDir, 'fatal.mp3'), gapMs: 1,
      synth: async () => { calls += 1; throw new Error('bing: HTTP 400'); },
    })).rejects.toThrow('HTTP 400');
    expect(calls).toBe(1);
  });

  it('ล้มครบทุกรอบ → โยน error ล่าสุด ไม่สร้างไฟล์', async () => {
    let calls = 0;
    const outPath = path.join(tmpDir, 'fail.mp3');
    await expect(bing.fetchChunk({
      text: 'x', outPath, gapMs: 1, tries: 3,
      synth: async () => { calls += 1; throw new Error('bing: too-small (10/1500)'); },
    })).rejects.toThrow('too-small');
    expect(calls).toBe(3);
    expect(fs.existsSync(outPath)).toBe(false);
  });

  it('ลงทะเบียนใน runner เป็นบริการที่ 4 · splitter แบบบรรทัดเหมือน Edge', () => {
    expect(ENGINES.bing).toBe(bing);
    expect(bing.splitMode).toBe(ENGINES.edge.splitMode);
    expect(bing.DEFAULT_BATCH_SIZE * bing.DEFAULT_CONNECTIONS_PER_FILE).toBe(10);
  });
});
