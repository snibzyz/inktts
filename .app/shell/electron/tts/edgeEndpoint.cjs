// ชี้ WebSocket สังเคราะห์เสียงของ msedge-tts ไป endpoint ที่ Microsoft ยังรับ
// ตั้งแต่ 14-10-2026 `speech.platform.bing.com/.../readaloud/edge/v1` รับเฉพาะ Sec-MS-GEC รุ่น 2
// → token รุ่น 1 ที่ msedge-tts 2.0.5 สร้าง = HTTP 403 ทุกเส้น (Edge สร้างเสียงไม่ได้เลย)
// endpoint ใหม่ = `api.msedgeservices.com` + คีย์เป็น Ocp-Apim-Subscription-Key (token รุ่น 1 เดิม)
// ตรงกับที่ msedge-tts 2.1.0 ย้ายไป · ต้นแบบจาก INKIDEA `electron/audio/edgeTtsEndpoint.cjs`

const EDGE_TTS_WSS_URL = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1';
const SEC_MS_GEC_VERSION = '1-143.0.3650.96';

// แทน static getSynthUrl ของ class (idempotent)
function pointMsEdgeTTSEndpoint(MsEdgeTTS) {
  if (typeof MsEdgeTTS !== 'function' || MsEdgeTTS.__inkEndpoint) return MsEdgeTTS;
  if (typeof MsEdgeTTS.generateSecMsGec !== 'function' || typeof MsEdgeTTS.generateUUID !== 'function') return MsEdgeTTS;
  MsEdgeTTS.__inkEndpoint = true;
  MsEdgeTTS.getSynthUrl = async function getSynthUrl() {
    const token = MsEdgeTTS.TRUSTED_CLIENT_TOKEN;
    const secMsGec = await MsEdgeTTS.generateSecMsGec(token);
    return `${EDGE_TTS_WSS_URL}?Ocp-Apim-Subscription-Key=${token}`
      + `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`
      + `&ConnectionId=${MsEdgeTTS.generateUUID()}`;
  };
  return MsEdgeTTS;
}

module.exports = { pointMsEdgeTTSEndpoint, EDGE_TTS_WSS_URL };
