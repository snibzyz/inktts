/**
 * endpoint ของ Edge TTS — endpoint เดิมของ msedge-tts 2.0.5 (speech.platform.bing.com) ตอบ 403 ทุกเส้น
 * ตั้งแต่ 14-10-2026 (ต้องใช้ Sec-MS-GEC รุ่น 2) → edge.cjs ต้องชี้ไป api.msedgeservices.com
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;
require('../tts/edge.cjs');
const { MsEdgeTTS } = require('msedge-tts');
const { pointMsEdgeTTSEndpoint, EDGE_TTS_WSS_URL } = require('../tts/edgeEndpoint.cjs');

describe('edgeEndpoint', () => {
  it('โหลด edge.cjs แล้ว lib ต่อ endpoint ใหม่ + คีย์เป็น Ocp-Apim-Subscription-Key', async () => {
    const url = new URL(await MsEdgeTTS.getSynthUrl());
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(EDGE_TTS_WSS_URL);
    expect(url.searchParams.get('Ocp-Apim-Subscription-Key')).toBe(MsEdgeTTS.TRUSTED_CLIENT_TOKEN);
    expect(url.searchParams.has('TrustedClientToken')).toBe(false);
    expect(url.searchParams.get('Sec-MS-GEC')).toMatch(/^[0-9A-F]{64}$/);
    expect(url.searchParams.get('ConnectionId')).toBeTruthy();
  });

  it('เรียกซ้ำได้ · ไม่แตะ class อื่น', () => {
    const fn = MsEdgeTTS.getSynthUrl;
    expect(pointMsEdgeTTSEndpoint(MsEdgeTTS)).toBe(MsEdgeTTS);
    expect(MsEdgeTTS.getSynthUrl).toBe(fn);
    class Other {}
    expect(pointMsEdgeTTSEndpoint(Other).getSynthUrl).toBeUndefined();
  });
});
