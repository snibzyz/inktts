import { create } from 'zustand';
import type { ServiceKey, ProgStatus } from '@/types/inktts';

export type ViewKey = ServiceKey | 'merge' | 'settings';

export interface FileRowState {
  base: string;
  status: ProgStatus | 'PENDING';
  done: number;
  total: number;
  /** ตั้งเมื่อ slot acquire จริง (รับ 'start' event จาก runner) — null ตอน standby */
  startTime: number | null;
  endTime?: number;
  /** ข้อความ error ตอน FAIL/FFMPEG_FAIL — UI โชว์ tooltip + ใช้ใน Copy Report */
  error?: string;
  /** โครงสร้าง diagnostic เต็มของ FFMPEG_FAIL — ใส่ใน "คัดลอกบันทึกให้แอดมิน"
   *  (path/argv/stderr/listPreview/exit code) — UI โชว์ collapsible block */
  details?: Record<string, any>;
}

export interface ServiceState {
  // selected files (file picker mode)
  selectedFiles: string[];
  // glob pattern (folder mode)
  pattern: string;
  // limit
  limitAll: boolean;
  limitN: number;
  // preset index
  presetIdx: number;
  // batch / conn (advanced)
  batch: number;
  conn: number;
  advancedOpen: boolean;
  // service-specific field values (by field.name)
  fieldValues: Record<string, any>;
  /** Per-service output folder override — null = ใช้ default (<global outputDir>/<service-subdir>)
   *  user เลือกได้อิสระต่อ service: edge → D:/audio, google → E:/google_voices ฯลฯ */
  outputDir: string | null;
  // run state
  jobId: string | null;
  rows: FileRowState[]; // ordered list
  rowsByBase: Record<string, number>; // base → index
  /** absolute paths ของไฟล์ที่ส่งให้ runner รอบล่าสุด — ใช้สำหรับ retry */
  lastRunFiles: string[];
  startTime: number | null;
  endTime: number | null;
  cancelled: boolean;
  limitInfo: { kind: 'shrink' | 'grow'; old: number; new: number; initial: number } | null;
}

export interface MergeState {
  srcDir: string;
  prefix: string;
  start: number;
  end: number;
  group: number;
  ext: 'm4a' | 'mp3';
  detected: { prefix: string; start: number; end: number; count: number } | null;
  running: boolean;
  log: { level: string; message: string }[];
  result: { totalGroups: number; failed: number } | null;
}

/** เก็บ error ทุกตัวที่เกิดใน session — UI ใช้สำหรับ Toast (ล่าสุด) + Inbox (รวม) */
export interface ErrorEntry {
  id: string;
  /** source ของ error — ใช้เป็น tag ใน UI ("Edge TTS", "ffmpeg", "update", ...) */
  source: string;
  /** ข้อความหลัก โผล่ใน toast + ขึ้นต้นใน inbox */
  message: string;
  /** รายละเอียดเพิ่มเติม — stack, payload, etc. — เก็บแยกเพื่อให้ copy ออกมาเป็น block */
  details?: string;
  /** unix timestamp ตอนสร้าง */
  ts: number;
  /** true ถ้า user dismiss toast แล้ว (ไม่ลบ — แค่ไม่ show toast อีก) */
  dismissed: boolean;
}

interface AppState {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  appRoot: string;
  inputDir: string;
  outputDir: string;
  setRoots: (r: { appRoot: string; inputDir: string; outputDir: string }) => void;
  status: { kind: 'info' | 'ok' | 'fail' | 'warn' | 'run'; message: string };
  setStatus: (s: { kind: 'info' | 'ok' | 'fail' | 'warn' | 'run'; message: string }) => void;
  errors: ErrorEntry[];
  addError: (e: Omit<ErrorEntry, 'id' | 'ts' | 'dismissed'>) => void;
  dismissError: (id: string) => void;
  clearErrors: () => void;
  errorInboxOpen: boolean;
  setErrorInboxOpen: (open: boolean) => void;
  services: Record<ServiceKey, ServiceState>;
  updateService: (key: ServiceKey, patch: Partial<ServiceState>) => void;
  resetServiceRun: (key: ServiceKey) => void;
  /** ล้างทุก state ที่เกี่ยวกับ "การรัน" (rows, lastRunFiles, จับเวลา) + ไฟล์ที่เลือก/pattern
   *  ใช้เมื่อ user กดปุ่ม "เริ่มใหม่" หรือ เปลี่ยน selectedFiles หลังรันเสร็จ
   *  ไม่แตะ presetIdx / batch / conn / fieldValues / outputDir — settings ของ user คงไว้ */
  resetServiceAll: (key: ServiceKey) => void;
  patchServiceField: (key: ServiceKey, field: string, value: any) => void;
  upsertRow: (key: ServiceKey, row: FileRowState) => void;
  patchRow: (key: ServiceKey, base: string, patch: Partial<FileRowState>) => void;
  merge: MergeState;
  setMerge: (patch: Partial<MergeState>) => void;
  appendMergeLog: (line: { level: string; message: string }) => void;
  resetMergeLog: () => void;
  update: { available: boolean; mode?: 'portable' | 'manual'; version?: string; current?: string; downloadUrl?: string; releaseUrl?: string; releaseDate?: string | null; releaseNotes?: string; progress?: number; downloading?: boolean; ready?: boolean; error?: string | null };
  setUpdate: (patch: Partial<AppState['update']>) => void;
}

function initialServiceState(presetIdx: number, presetBatch: number, presetConn: number, fieldDefaults: Record<string, any>): ServiceState {
  return {
    selectedFiles: [],
    pattern: '',
    limitAll: false,
    limitN: 50,
    presetIdx,
    batch: presetBatch,
    conn: presetConn,
    advancedOpen: false,
    fieldValues: { ...fieldDefaults },
    outputDir: null,
    jobId: null,
    rows: [],
    rowsByBase: {},
    lastRunFiles: [],
    startTime: null,
    endTime: null,
    cancelled: false,
    limitInfo: null,
  };
}

export const useStore = create<AppState>((set, get) => ({
  view: 'edge',
  setView: (v) => set({ view: v }),
  appRoot: '',
  inputDir: '',
  outputDir: '',
  setRoots: (r) => set(r),
  status: { kind: 'info', message: 'พร้อมใช้งาน' },
  setStatus: (s) => set({ status: s }),

  errors: [],
  // จำกัด 100 entries — เก็บไว้สำหรับ Inbox + ส่งให้ admin
  // ใหม่อยู่ index 0 (push เข้า front) เพื่อ render เรียงเวลาล่าสุดบนสุด
  addError: (e) => set((s) => {
    const entry: ErrorEntry = {
      ...e,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      dismissed: false,
    };
    const next = [entry, ...s.errors].slice(0, 100);
    return { errors: next };
  }),
  dismissError: (id) => set((s) => ({
    errors: s.errors.map((x) => x.id === id ? { ...x, dismissed: true } : x),
  })),
  clearErrors: () => set({ errors: [] }),
  errorInboxOpen: false,
  setErrorInboxOpen: (open) => set({ errorInboxOpen: open }),

  // เริ่มที่ preset MAX เสมอ (index 0) — AdaptiveLimiter จะลดเพดานอัตโนมัติเมื่อ throttle
  services: {
    edge: initialServiceState(0, 50, 1, { voice: 'th-TH-PremwadeeNeural', rate: '+30%', 'lines-per-chunk': 1 }),
    google: initialServiceState(0, 10, 2, { tempo: 1.3, 'chunk-chars': 120, jitter: 0.1 }),
    rv: initialServiceState(0, 8, 1, { gender: 'female', tempo: 1.3, rate: 0.5, 'chunk-chars': 100 }),
  },

  updateService: (key, patch) =>
    set((s) => ({ services: { ...s.services, [key]: { ...s.services[key], ...patch } } })),

  resetServiceRun: (key) =>
    set((s) => ({
      services: {
        ...s.services,
        [key]: { ...s.services[key], jobId: null, rows: [], rowsByBase: {}, lastRunFiles: [], startTime: null, endTime: null, cancelled: false, limitInfo: null },
      },
    })),

  resetServiceAll: (key) =>
    set((s) => ({
      services: {
        ...s.services,
        [key]: {
          ...s.services[key],
          selectedFiles: [],
          pattern: '',
          jobId: null,
          rows: [],
          rowsByBase: {},
          lastRunFiles: [],
          startTime: null,
          endTime: null,
          cancelled: false,
          limitInfo: null,
        },
      },
    })),

  patchServiceField: (key, field, value) => {
    const cur = get().services[key];
    set({
      services: {
        ...get().services,
        [key]: { ...cur, fieldValues: { ...cur.fieldValues, [field]: value } },
      },
    });
  },

  upsertRow: (key, row) => {
    const cur = get().services[key];
    const existing = cur.rowsByBase[row.base];
    if (existing != null) {
      const rows = cur.rows.slice();
      rows[existing] = row;
      set({ services: { ...get().services, [key]: { ...cur, rows } } });
    } else {
      const rows = [...cur.rows, row];
      const rowsByBase = { ...cur.rowsByBase, [row.base]: rows.length - 1 };
      set({ services: { ...get().services, [key]: { ...cur, rows, rowsByBase } } });
    }
  },

  patchRow: (key, base, patch) => {
    const cur = get().services[key];
    const idx = cur.rowsByBase[base];
    if (idx == null) {
      const row: FileRowState = { base, status: 'WORK', done: 0, total: 0, startTime: null, ...patch };
      const rows = [...cur.rows, row];
      set({ services: { ...get().services, [key]: { ...cur, rows, rowsByBase: { ...cur.rowsByBase, [base]: rows.length - 1 } } } });
      return;
    }
    const rows = cur.rows.slice();
    rows[idx] = { ...rows[idx], ...patch };
    set({ services: { ...get().services, [key]: { ...cur, rows } } });
  },

  merge: {
    srcDir: '',
    prefix: '',
    start: 1,
    end: 10,
    group: 10,
    ext: 'm4a',
    detected: null,
    running: false,
    log: [],
    result: null,
  },
  setMerge: (patch) => set((s) => ({ merge: { ...s.merge, ...patch } })),
  appendMergeLog: (line) => set((s) => ({ merge: { ...s.merge, log: [...s.merge.log, line] } })),
  resetMergeLog: () => set((s) => ({ merge: { ...s.merge, log: [], result: null } })),

  update: { available: false },
  setUpdate: (patch) => set((s) => ({ update: { ...s.update, ...patch } })),
}));
