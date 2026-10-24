// ชี้ WebSocket สังเคราะห์เสียงของ msedge-tts ไป endpoint + token ที่ Microsoft ยังรับ
// ต้นแบบจาก INKIDEA `electron/audio/edgeTtsEndpoint.cjs`
//
// ประวัติ (Microsoft เปลี่ยนฝั่งตัวเอง 2 รอบในเดือนเดียว · ทั้งสองรอบ Edge สร้างเสียงไม่ได้เลยทุกเส้น):
//   - 14-10-2026: `speech.platform.bing.com/.../readaloud/edge/v1` รับเฉพาะ Sec-MS-GEC รุ่น 2
//     → token รุ่น 1 ของ msedge-tts 2.0.5 = HTTP 403 · ตอนนั้นย้ายไป `api.msedgeservices.com` (token รุ่น 1) แทน
//   - 24-10-2026: `api.msedgeservices.com` ตอบ HTTP 200 ว่าง ไม่ upgrade เป็น WebSocket
//     → "Edge TTS WebSocket error: Unexpected server response: 200" ทุกท่อน
//
// แก้ (24-10-2026): กลับไป readaloud เดิม + Sec-MS-GEC รุ่น 2 (port จาก `rany2/edge-tts` 7.3.1 → `edgeSecMsGec.cjs`)
// header ที่ msedge-tts ส่งอยู่แล้ว (User-Agent Edg/143 + Origin) พอ — ไม่ต้องใส่ cookie muid
// ถ้าพังอีก: เทียบกับ `rany2/edge-tts` (`constants.py`, `drm.py`) — ยิงเช็คด้วย `pip install edge-tts` ก่อนว่ายังได้เสียงไหม

const { generateSecMsGecV2 } = require('./edgeSecMsGec.cjs');

const EDGE_TTS_WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const SEC_MS_GEC_VERSION = '2-143.0.3650.75';

// แทน static getSynthUrl ของ class (idempotent)
function pointMsEdgeTTSEndpoint(MsEdgeTTS) {
  if (typeof MsEdgeTTS !== 'function' || MsEdgeTTS.__inkEndpoint) return MsEdgeTTS;
  if (typeof MsEdgeTTS.generateUUID !== 'function') return MsEdgeTTS;
  MsEdgeTTS.__inkEndpoint = true;
  MsEdgeTTS.getSynthUrl = async function getSynthUrl() {
    const token = MsEdgeTTS.TRUSTED_CLIENT_TOKEN;
    return `${EDGE_TTS_WSS_URL}?TrustedClientToken=${token}`
      + `&Sec-MS-GEC=${generateSecMsGecV2(Date.now() / 1000, token)}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`
      + `&ConnectionId=${MsEdgeTTS.generateUUID()}`;
  };
  return MsEdgeTTS;
}

module.exports = { pointMsEdgeTTSEndpoint, EDGE_TTS_WSS_URL, SEC_MS_GEC_VERSION };
