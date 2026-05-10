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
      { name: 'rate', kind: 'entry', label: 'ความเร็วเสียง (เช่น +30%)', default: '+30%' },
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
      { name: 'tempo', kind: 'scale', label: 'ความเร็วเสียง', default: 1.3, min: 0.5, max: 2.0, step: 0.1 },
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
      { name: 'tempo', kind: 'scale', label: 'ความเร็วเสียง', default: 1.3, min: 0.5, max: 2.0, step: 0.1 },
      { name: 'rate', kind: 'scale', label: 'ความเร็วของ API', default: 0.5, min: 0.1, max: 1.5, step: 0.1, advanced: true },
      { name: 'chunk-chars', kind: 'spinbox', label: 'ตัวอักษรต่อส่วน', default: 100, min: 50, max: 100, advanced: true },
    ],
  },
];

export const getService = (key: string) => SERVICES.find((s) => s.key === key)!;

export function buildOptionsFromFields(service: ServiceDef, values: Record<string, any>) {
  const opts: Record<string, any> = {};
  for (const f of service.fields) {
    const v = values[f.name];
    if (v === undefined || v === '') continue;
    // map kebab-case → camelCase for runner
    if (f.name === 'lines-per-chunk') opts.linesPerChunk = Number(v);
    else if (f.name === 'chunk-chars') opts.chunkChars = Number(v);
    else if (f.kind === 'scale' || f.kind === 'spinbox') opts[f.name] = Number(v);
    else opts[f.name] = v;
  }
  return opts;
}
