/**
 * เทส Sec-MS-GEC รุ่น 2 — ค่าคาดหวังทุกตัวได้จาก `edge_tts.drm.generate_sec_ms_gec_v2(unix_timestamp=t)`
 * ของ edge-tts 7.3.1 (Python) ตรง ๆ · port ต้องตรงทุกไบต์ ไม่งั้น Edge ตอบ 403
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateSecMsGecV2 } = require('../tts/edgeSecMsGec.cjs');

const PYTHON_GOLDEN = [
  [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
  [300, 'F7535A20A262E331-28675BF85C7106BBF20035A78FCB0B6890813EAD5C3B983EF3424931B720BABB'],
  [1700000000, '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2'],
  [1761000000, '9875C7D8BB340E51-4AC084DC23E2DEA93DF952AE15BE8A23A325A2F010C0C277FBC15644D5A006C9'],
  [1792843269.75, '93DB3F87F3DDD46C-96BF27A21F13CEBC56B358D782475FFA8D9AB09D9572A45DD406E1140767DAF3'],
  [1792843500, '391BF43945A5ECE3-A464DB25BFFFEAE045C1E98519BC8F38F8AD2EDC2194A7AE3BE14C408C310CE1'],
  [1800000000, '99E54519B490BE5C-E162DB0977FBDCB9B86DD8148BF1BCDC3C0303176CE39852A42B415935C20654'],
  [2000000000.5, '2D62557F1142BC5D-FD9C30C68FF194A5EE6B45FEFC5E2BA1D1239F88A90569AB55CFFFAA7799F40E'],
  [4102444800, 'DD230DB44FEE2FD7-DA0D4FA797866E36C992FABB81DD2F9DB37EB74D675D63228277003DCD3F9F8C'],
];

describe('edgeSecMsGec v2', () => {
  it.each(PYTHON_GOLDEN)('t=%s ตรงกับ edge-tts Python', (t, expected) => {
    expect(generateSecMsGecV2(t)).toBe(expected);
  });

  it('ปัดลงทีละ 5 นาที — ในช่วงเดียวกันได้ค่าเดียวกัน ข้ามช่วงแล้วเปลี่ยน', () => {
    expect(generateSecMsGecV2(1)).toBe(generateSecMsGecV2(299));
    expect(generateSecMsGecV2(299)).not.toBe(generateSecMsGecV2(300));
  });

  it('รูปแบบ <16 hex>-<64 hex> ตัวพิมพ์ใหญ่ · ค่าเริ่มต้นใช้นาฬิกาเครื่อง', () => {
    expect(generateSecMsGecV2()).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
  });
});
