// Bridge ที่ preload exposes ไปบน window.inktts

export type ServiceKey = 'edge' | 'google' | 'rv';

export type FieldKind = 'combo' | 'entry' | 'spinbox' | 'scale' | 'rate';

export interface FieldDef {
  name: string;
  kind: FieldKind;
  label: string;
  default: string | number;
  options?: string[];
  optionLabels?: string[];
  min?: number;
  max?: number;
  step?: number;
  advanced?: boolean;
  // 'rate' kind only — สร้าง stepper +/- ที่ user กด/พิมพ์ปรับเองได้
  // unit='%':         เก็บ % โดยตรง (Edge) → engine รับ "+30%"
  // unit='mult-pct':  เก็บ multiplier (Google/RV tempo) → engine รับ number, แต่ user เห็นเป็น "+30%"
  //                   storage 1.3 ↔ display "+30%", storage 0.5 ↔ display "-50%"
  // unit='x':         เก็บ + แสดง multiplier เช่น "1.30x"
  // unit='':          เก็บ + แสดง number ตรง ๆ (RV ขั้นสูง)
  unit?: '%' | 'mult-pct' | 'x' | '';
  precision?: number; // จำนวนทศนิยมที่แสดง (default: 0 ถ้า step>=1, 1 ถ้า step>=0.1, 2 อื่น ๆ)
}

export interface PresetDef {
  label: string;
  batch: number;
  conn: number;
}

export interface ServiceDef {
  key: ServiceKey;
  icon: string;
  name: string;
  title: string;
  subtitle: string;
  outputSubdir: string;
  maxTotal: number;
  presets: PresetDef[];
  defaultPreset: number;
  fields: FieldDef[];
}

export type ProgStatus = 'PENDING' | 'WORK' | 'DONE' | 'FAIL' | 'FFMPEG_FAIL' | 'SKIP' | 'EMPTY';

export interface TtsProgEvent {
  jobId: string;
  type: 'prog';
  fileBase: string;
  status: ProgStatus;
  done: number;
  total: number;
  /** กรณี FAIL / FFMPEG_FAIL — ข้อความสั้น ๆ บอกเหตุที่ fail (UI โชว์ tooltip + copy report) */
  error?: string;
  /** กรณี FFMPEG_FAIL — โครงสร้าง diagnostic เต็ม (path/argv/stderr/listPreview)
   *  ใช้แนบใน Error Inbox "คัดลอกบันทึกให้แอดมิน" ให้แอดมิน reproduce ได้ */
  details?: {
    reason: string;
    ffmpegPath?: string | null;
    ffmpegSize?: number;
    exitCode?: number | null;
    spawnError?: string | null;
    durationMs?: number;
    argv?: string[];
    listPreview?: string[];
    validChunks?: number;
    stderr?: string;
    diagnostic?: any;
    rejectedSample?: Array<{ path: string; reason: string }>;
    [k: string]: any;
  };
}
export interface TtsLimitEvent {
  jobId: string;
  type: 'limit';
  label: string;
  kind: 'shrink' | 'grow';
  old: number;
  new: number;
  initial: number;
}
export interface TtsStartEvent { jobId: string; type: 'start'; fileBase: string; }
export interface TtsLogEvent { jobId: string; type: 'log'; level: string; message: string; }
export interface TtsDoneEvent { jobId: string; type: 'done'; stats: any; elapsedSec: number; cancelled: boolean; }
export interface TtsErrorEvent { jobId: string; type: 'error'; message: string; }
export type TtsEvent = TtsProgEvent | TtsLimitEvent | TtsStartEvent | TtsLogEvent | TtsDoneEvent | TtsErrorEvent;

export interface UpdateInfo {
  mode: 'portable' | 'manual';
  version: string;
  current: string;
  downloadUrl: string;
  releaseUrl: string;
  releaseDate?: string;
}

// ───────── Queue (คิวรายเรื่อง — รันทีละเรื่อง) ─────────
export type QueueItemStatus =
  | 'idle'           // ยังไม่เริ่ม
  | 'queued'         // รออยู่ในคิว
  | 'running'        // กำลังแปลง
  | 'done'           // เสร็จครบ
  | 'done-with-errors' // เสร็จแต่บางไฟล์ล้มเหลว (ลองใหม่หมดแล้ว)
  | 'failed'         // ล้มเหลวก่อนเริ่ม (ไม่มีไฟล์ ฯลฯ)
  | 'cancelled';     // ถูกยกเลิก

export interface QueueItem {
  id: string;
  name: string;
  service: ServiceKey;
  presetIdx: number;
  fieldValues: Record<string, any>;
  /** engine opts ที่ renderer build ไว้แล้ว (buildOptionsFromFields + batchSize/connectionsPerFile) */
  runOptions: Record<string, any>;
  /** โฟลเดอร์ต้นทาง — ใช้เมื่อไม่ได้เลือกไฟล์รายตัว (list .txt ทั้งโฟลเดอร์) */
  inputDir: string;
  /** ไฟล์ .txt ที่เลือกรายตัว — ถ้ามี ใช้ตามนี้แทน inputDir */
  inputFiles: string[];
  outputDir: string;
  status: QueueItemStatus;
  jobId: string | null;
  progress: { done: number; fail: number; total: number; current: string | null };
  retryCount: number;
  throttled: boolean;
  error: string | null;
  /** ms timestamp ที่เริ่มรันจริงครั้งแรก (รวม retry) — null ถ้ายังไม่เริ่ม */
  startedAt: number | null;
  /** ms timestamp ที่จบ (terminal) — null ถ้ายังรันอยู่ */
  endedAt: number | null;
  /** เวลาที่ใช้แต่ละตอน (ไฟล์) แยก — วินาที */
  times: { base: string; sec: number }[];
  createdAt: number;
  updatedAt: number;
}

export interface QueueAddInput {
  name: string;
  service: ServiceKey;
  presetIdx: number;
  fieldValues: Record<string, any>;
  runOptions: Record<string, any>;
  inputDir: string;
  inputFiles?: string[];
  outputDir: string;
}

export type QueueUpdateEvent =
  | { type: 'snapshot'; items: QueueItem[] }
  | { type: 'item'; item: QueueItem };
export interface QueueLogEvent { itemId: string; level: string; message: string; ts: number; }
export interface QueueNoticeEvent { itemId: string; kind: 'throttle' | 'retry' | 'done' | 'done-with-errors' | 'failed'; message: string; }

declare global {
  interface Window {
    inktts: {
      platform: string;
      isMac: boolean;
      app: {
        version: string;
        checkUpdate: () => Promise<{ ok: boolean; result?: any; error?: string }>;
        applyUpdate: () => Promise<{ ok: boolean; error?: string }>;
        onUpdateAvailable: (handler: (info: UpdateInfo) => void) => () => void;
        onUpdateProgress: (handler: (p: { percent: number; received: number; total: number }) => void) => () => void;
        onUpdateDownloaded: (handler: (info: { mode: string; version: string }) => void) => () => void;
        onUpdateError: (handler: (info: { message: string }) => void) => () => void;
        diagnostics: () => Promise<{
          version: string;
          platform: string;
          arch: string;
          osRelease: string;
          electron: string;
          node: string;
          isPackaged: boolean;
          portable: boolean;
          execPath: string;
          resourcesPath: string | null;
          userData: string;
          cacheRoot: string;
          logPath: string | null;
          ffmpeg: { path: string | null; exists: boolean; size: number; error: string | null };
        }>;
        verifyFfmpeg: (timeoutMs?: number) => Promise<{
          ok: boolean;
          path: string | null;
          exists: boolean;
          size: number;
          isFile: boolean;
          execBit: boolean | null;
          spawnOk: boolean;
          versionLine: string | null;
          exitCode: number | null;
          error: string | null;
          durationMs: number;
        }>;
        logTail: (bytes?: number) => Promise<{ ok: boolean; path?: string; content?: string; truncated?: boolean; totalSize?: number; error?: string }>;
        copyToClipboard: (text: string) => Promise<{ ok: boolean; error?: string }>;
        openLogFile: () => Promise<{ ok: boolean; path?: string; error?: string }>;
        revealLogFile: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      };
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
        toggleDevTools: () => Promise<void>;
        reload: () => Promise<void>;
      };
      fs: {
        getAppRoot: () => Promise<{ appRoot: string; inputDir: string; outputDir: string }>;
        listInputFiles: (dir?: string) => Promise<string[]>;
        listGlob: (pattern: string) => Promise<string[]>;
        chooseFolder: (opts?: { defaultPath?: string; title?: string }) => Promise<string | null>;
        chooseFiles: (opts?: { defaultPath?: string; title?: string }) => Promise<string[]>;
        revealFolder: (p: string) => Promise<boolean>;
        openExternal: (url: string) => Promise<boolean>;
        exists: (p: string) => Promise<boolean>;
      };
      tts: {
        start: (payload: { service: ServiceKey; files: string[]; options: Record<string, any>; jobId?: string }) => Promise<{ ok: boolean; jobId?: string; outputDir?: string; error?: string }>;
        cancel: (jobId: string) => Promise<{ ok: boolean; error?: string }>;
        onEvent: (handler: (evt: TtsEvent) => void) => () => void;
      };
      merge: {
        start: (payload: { srcDir: string; dstDir?: string; prefix?: string; outPrefix?: string; start: number; end: number; group: number; ext?: string; pad?: number }) => Promise<{ ok: boolean; totalGroups?: number; failed?: number; error?: string }>;
        detect: (srcDir: string, ext?: string) => Promise<{ prefix: string; start: number; end: number; count: number; pad?: number } | null>;
        onLog: (handler: (msg: { level: string; message: string }) => void) => () => void;
        onDone: (handler: (result: { totalGroups: number; failed: number }) => void) => () => void;
      };

      settings: {
        get: () => Promise<{
          data: PersistedSettings;
          defaults: { inputDir: string; outputDir: string };
          settingsPath: string;
          userDataDir: string;
        }>;
        patch: (partial: Partial<PersistedSettings>) => Promise<{ ok: boolean; error?: string }>;
        setInputDir: (dir: string | null) => Promise<{ ok: boolean }>;
        setOutputDir: (dir: string | null) => Promise<{ ok: boolean }>;
      };

      cache: {
        size: () => Promise<{ ok: boolean; bytes: number; path?: string; error?: string }>;
        clear: () => Promise<{ ok: boolean; error?: string }>;
        clearService: (service: ServiceKey) => Promise<{ ok: boolean; bytesFreed: number; error?: string }>;
        clearFiles: (service: ServiceKey, bases: string[]) => Promise<{ ok: boolean; bytesFreed: number; error?: string }>;
      };

      output: {
        clearFiles: (
          service: ServiceKey,
          bases: string[],
          opts?: { outputDir?: string; ext?: 'm4a' | 'mp3' },
        ) => Promise<{ ok: boolean; deleted: number; bytesFreed: number; failed?: { base: string; error: string }[]; error?: string }>;
      };

      queue: {
        snapshot: () => Promise<{ items: QueueItem[] }>;
        add: (item: QueueAddInput) => Promise<QueueItem>;
        update: (id: string, patch: Partial<QueueAddInput>) => Promise<{ ok: boolean; error?: string }>;
        remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
        clearDone: () => Promise<{ ok: boolean }>;
        move: (id: string, toIndex: number) => Promise<{ ok: boolean; error?: string }>;
        start: (id: string) => Promise<{ ok: boolean; error?: string }>;
        startAll: () => Promise<{ ok: boolean }>;
        cancel: (id: string) => Promise<{ ok: boolean; error?: string }>;
        cancelAll: () => Promise<{ ok: boolean }>;
        onUpdate: (handler: (evt: QueueUpdateEvent) => void) => () => void;
        onLog: (handler: (evt: QueueLogEvent) => void) => () => void;
        onNotice: (handler: (evt: QueueNoticeEvent) => void) => () => void;
      };
    };
  }
}

export interface PersistedServiceState {
  presetIdx?: number;
  batch?: number;
  conn?: number;
  fieldValues?: Record<string, any>;
  limitN?: number;
  limitAll?: boolean;
  advancedOpen?: boolean;
  /** Per-service output folder override — null/undefined = ใช้ default */
  outputDir?: string | null;
}

export interface PersistedSettings {
  version: number;
  paths: { inputDir: string | null; outputDir: string | null };
  services: Record<ServiceKey, PersistedServiceState | null>;
  merge: { srcDir?: string; prefix?: string; group?: number; ext?: 'm4a' | 'mp3'; pad?: number } | null;
  view: ViewKey;
}

type ViewKey = ServiceKey | 'queue' | 'merge' | 'settings';
