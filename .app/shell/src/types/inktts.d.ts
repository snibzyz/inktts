// Bridge ที่ preload exposes ไปบน window.inktts

export type ServiceKey = 'edge' | 'google' | 'rv';

export type FieldKind = 'combo' | 'entry' | 'spinbox' | 'scale';

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
        start: (payload: { service: ServiceKey; files: string[]; options: Record<string, any> }) => Promise<{ ok: boolean; jobId?: string; outputDir?: string; error?: string }>;
        cancel: (jobId: string) => Promise<{ ok: boolean; error?: string }>;
        onEvent: (handler: (evt: TtsEvent) => void) => () => void;
      };
      merge: {
        start: (payload: { srcDir: string; dstDir?: string; prefix: string; start: number; end: number; group: number; ext?: string }) => Promise<{ ok: boolean; totalGroups?: number; failed?: number; error?: string }>;
        detect: (srcDir: string, ext?: string) => Promise<{ prefix: string; start: number; end: number; count: number } | null>;
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
}

export interface PersistedSettings {
  version: number;
  paths: { inputDir: string | null; outputDir: string | null };
  services: Record<ServiceKey, PersistedServiceState | null>;
  merge: { srcDir?: string; prefix?: string; group?: number; ext?: 'm4a' | 'mp3' } | null;
  view: ViewKey;
}

type ViewKey = ServiceKey | 'merge' | 'settings';
