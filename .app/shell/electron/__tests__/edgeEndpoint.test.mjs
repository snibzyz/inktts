/**
 * endpoint ของ Edge TTS — readaloud (speech.platform.bing.com) รับเฉพาะ Sec-MS-GEC รุ่น 2 ตั้งแต่ 14-10-2026
 * (รุ่น 1 ของ msedge-tts 2.0.5 = 403) · api.msedgeservices.com ที่เคยย้ายไปตอบ 200 ไม่ upgrade ตั้งแต่ 24-10-2026
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;
require('../tts/edge.cjs');
const { MsEdgeTTS } = require('msedge-tts');
const { pointMsEdgeTTSEndpoint, EDGE_TTS_WSS_URL, SEC_MS_GEC_VERSION } = require('../tts/edgeEndpoint.cjs');

describe('edgeEndpoint', () => {
  it('โหลด edge.cjs แล้ว lib ต่อ readaloud + Sec-MS-GEC รุ่น 2', async () => {
    const url = new URL(await MsEdgeTTS.getSynthUrl());
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(EDGE_TTS_WSS_URL);
    expect(url.host).toBe('speech.platform.bing.com');
    expect(url.searchParams.get('TrustedClientToken')).toBe(MsEdgeTTS.TRUSTED_CLIENT_TOKEN);
    expect(url.searchParams.has('Ocp-Apim-Subscription-Key')).toBe(false);
    expect(url.searchParams.get('Sec-MS-GEC')).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
    expect(url.searchParams.get('Sec-MS-GEC-Version')).toBe(SEC_MS_GEC_VERSION);
    expect(SEC_MS_GEC_VERSION).toMatch(/^2-/);
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
