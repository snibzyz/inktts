import type { ServiceDef } from '@/types/inktts';

// Preset เรียงจาก fast → safe — index 0 คือ MAX throughput (default)
// ระบบ AdaptiveLimiter จะลดเพดานอัตโนมัติเมื่อโดน throttle/429 → ไม่ต้องเลือกเอง

const EDGE_PRESETS = [
  { label: 'สูงสุด — เร็วที่สุด (50 ไฟล์พร้อมกัน)', batch: 50, conn: 1 },
  { label: 'สูง (20 ไฟล์พร้อมกัน)', batch: 20, conn: 2 },
  { label: 'กลาง (10 ไฟล์พร้อมกัน)', batch: 10, conn: 2 },
  { label: 'น้อย (5 ไฟล์พร้อมกัน)', batch: 5, conn: 8 },
  { label: 'ไฟล์เดียว — เร็วต่อไฟล์', batch: 1, conn: 48 },
  { label: 'ช้าแต่ปลอดภัย (กันถูกจำกัดเรท)', batch: 4, conn: 1 },
];

const GOOGLE_PRESETS = [
  { label: 'สูงสุด — เร็วที่สุด (10 ไฟล์พร้อมกัน)', batch: 10, conn: 2 },
  { label: 'กลาง (8 ไฟล์พร้อมกัน)', batch: 8, conn: 1 },
  { label: 'น้อย (6 ไฟล์พร้อมกัน)', batch: 6, conn: 1 },
  { label: 'ไฟล์เดียว — เร็วต่อไฟล์', batch: 1, conn: 6 },
  { label: 'ช้าแต่ปลอดภัย', batch: 4, conn: 1 },
];

const RV_PRESETS = [
  { label: 'สูงสุด — เร็วที่สุด (8 ไฟล์พร้อมกัน)', batch: 8, conn: 1 },
  { label: 'น้อย (6 ไฟล์พร้อมกัน)', batch: 6, conn: 1 },
  { label: 'ไฟล์เดียว — เร็วต่อไฟล์', batch: 1, conn: 6 },
  { label: 'ช้าแต่ปลอดภัย', batch: 3, conn: 1 },
];

const maxTotalOf = (presets: { batch: number; conn: number }[]) =>
  Math.max(...presets.map((p) => p.batch * p.conn));

export const SERVICES: ServiceDef[] = [
  {
    key: 'edge',
    icon: 'star-full',
    name: 'Edge',
    title: 'Microsoft Edge — เสียง Premwadee Neural',
    subtitle: 'เสียงคุณภาพสูง · ฟรี · ไม่ต้องใช้ API key',
    outputSubdir: 'edge',
    maxTotal: maxTotalOf(EDGE_PRESETS),
    presets: EDGE_PRESETS,
    defaultPreset: 0,
    fields: [
      {
        name: 'voice',
        kind: 'combo',
        label: 'เสียงพากย์',
        default: 'th-TH-PremwadeeNeural',
        options: ['th-TH-PremwadeeNeural', 'th-TH-NiwatNeural'],
        optionLabels: ['Premwadee (หญิง)', 'Niwat (ชาย)'],
      },
      // ความเร็วเสียง: เก็บ % โดยตรง (-50% ถึง +100%), step 5% — default 0% (ความเร็วปกติ)
      { name: 'rate', kind: 'rate', label: 'ความเร็วเสียง', default: 0, min: -50, max: 100, step: 5, unit: '%' },
      { name: 'lines-per-chunk', kind: 'spinbox', label: 'จำนวนบรรทัดต่อส่วนเสียง', default: 1, min: 1, max: 50, advanced: true },
    ],
  },
  {
    key: 'google',
    icon: 'globe',
    name: 'Google',
    title: 'Google Translate — เสียงภาษาไทย',
    subtitle: 'เสียงปกติ · ฟรี · ไม่ต้องใช้ API key · เสถียรที่สุด',
    outputSubdir: 'google',
    maxTotal: maxTotalOf(GOOGLE_PRESETS),
    presets: GOOGLE_PRESETS,
    defaultPreset: 0,
    fields: [
      // ความเร็วเสียง: เก็บ multiplier (engine atempo) แต่ user เห็นเป็น "+30%" เหมือน Edge
      // storage 1.3 = display "+30%", step 0.05 = 5% — เหมือน Edge ทุกอย่าง
      { name: 'tempo', kind: 'rate', label: 'ความเร็วเสียง', default: 1.3, min: 0.5, max: 2.0, step: 0.05, unit: 'mult-pct' },
      { name: 'chunk-chars', kind: 'spinbox', label: 'ตัวอักษรต่อส่วน', default: 120, min: 50, max: 200, advanced: true },
      { name: 'jitter', kind: 'scale', label: 'หน่วงสุ่ม (กันถูกจำกัดเรท)', default: 0.1, min: 0, max: 1, step: 0.05, advanced: true },
    ],
  },
  {
    key: 'rv',
    icon: 'mic',
    name: 'ResponsiveVoice',
    title: 'ResponsiveVoice — เลือกเพศได้',
    subtitle: 'เสียงปกติ · ฟรี · เลือกเพศชาย/หญิงได้',
    outputSubdir: 'responsivevoice',
    maxTotal: maxTotalOf(RV_PRESETS),
    presets: RV_PRESETS,
    defaultPreset: 0,
    fields: [
      {
        name: 'gender',
        kind: 'combo',
        label: 'เพศของเสียง',
        default: 'female',
        options: ['female', 'male'],
        optionLabels: ['ผู้หญิง', 'ผู้ชาย'],
      },
      // ความเร็วเสียง: เก็บ multiplier แต่แสดงเป็น % เหมือน Edge/Google
      { name: 'tempo', kind: 'rate', label: 'ความเร็วเสียง', default: 1.3, min: 0.5, max: 2.0, step: 0.05, unit: 'mult-pct' },
      // ความเร็วฝั่ง API — คนละ concept จาก playback speed ของผู้ใช้
      { name: 'rate', kind: 'rate', label: 'ความเร็วฝั่งบริการ', default: 0.5, min: 0.1, max: 1.5, step: 0.1, unit: '', advanced: true },
      { name: 'chunk-chars', kind: 'spinbox', label: 'ตัวอักษรต่อส่วน', default: 100, min: 50, max: 100, advanced: true },
    ],
  },
];

export const getService = (key: string) => SERVICES.find((s) => s.key === key)!;

// แปลง "+30%" / "-10%" → number 30 / -10 (สำหรับค่าเก่าที่เก็บเป็น string)
function parseRateValue(v: any): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/^([-+]?\d+(?:\.\d+)?)\s*%?$/);
    if (m) return parseFloat(m[1]);
  }
  return NaN;
}

export function buildOptionsFromFields(service: ServiceDef, values: Record<string, any>) {
  const opts: Record<string, any> = {};
  for (const f of service.fields) {
    let v = values[f.name];
    if (v === undefined || v === '') continue;
    // rate field: ถ้า unit='%' ส่งเป็น string "+30%" ให้ engine (msedge-tts รับ format นี้)
    // ถ้า unit='x' หรือ '' ส่งเป็น number ตรง ๆ
    if (f.kind === 'rate') {
      const n = parseRateValue(v);
      if (!Number.isFinite(n)) continue;
      if (f.unit === '%') {
        const i = Math.round(n);
        opts[f.name] = (i >= 0 ? '+' : '') + i + '%';
      } else {
        opts[f.name] = n;
      }
      continue;
    }
    // map kebab-case → camelCase for runner
    if (f.name === 'lines-per-chunk') opts.linesPerChunk = Number(v);
    else if (f.name === 'chunk-chars') opts.chunkChars = Number(v);
    else if (f.kind === 'scale' || f.kind === 'spinbox') opts[f.name] = Number(v);
    else opts[f.name] = v;
  }
  return opts;
}
