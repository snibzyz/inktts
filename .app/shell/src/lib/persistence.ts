// Bridge ระหว่าง zustand store ↔ persistent settings.json (ใน %APPDATA%/INKTTS/)
//
// hydrate(): เรียกครั้งเดียวตอน boot — โหลดจากไฟล์ → push เข้า store
// startAutosave(): subscribe การเปลี่ยนแปลง store ที่ต้องเก็บ → debounced write กลับไฟล์
//                  คืน function สำหรับ unsubscribe

import { useStore } from '@/state/store';
import type { ServiceKey } from '@/types/inktts';

const PERSIST_KEYS: Array<keyof ReturnType<typeof useStore.getState>['services'][ServiceKey]> = [
  'presetIdx', 'batch', 'conn', 'fieldValues', 'limitN', 'limitAll', 'advancedOpen', 'outputDir',
];

function pickServicePersist(s: any) {
  const out: any = {};
  for (const k of PERSIST_KEYS) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  return out;
}

export async function hydrate() {
  const r = await window.inktts.settings.get();
  const s = r?.data;
  if (!s) return;

  const cur = useStore.getState();

  // services
  for (const key of ['edge', 'google', 'rv'] as ServiceKey[]) {
    const saved = s.services?.[key];
    if (saved && typeof saved === 'object') {
      cur.updateService(key, {
        ...(saved.presetIdx != null ? { presetIdx: saved.presetIdx } : {}),
        ...(saved.batch != null ? { batch: saved.batch } : {}),
        ...(saved.conn != null ? { conn: saved.conn } : {}),
        ...(saved.fieldValues ? { fieldValues: { ...cur.services[key].fieldValues, ...saved.fieldValues } } : {}),
        ...(saved.limitN != null ? { limitN: saved.limitN } : {}),
        ...(saved.limitAll != null ? { limitAll: saved.limitAll } : {}),
        ...(saved.advancedOpen != null ? { advancedOpen: saved.advancedOpen } : {}),
        ...(saved.outputDir !== undefined ? { outputDir: saved.outputDir } : {}),
      });
    }
  }

  // view
  if (s.view && ['edge', 'google', 'rv', 'merge', 'settings'].includes(s.view)) {
    cur.setView(s.view as any);
  }

  // merge
  if (s.merge && typeof s.merge === 'object') {
    cur.setMerge({
      ...(s.merge.srcDir ? { srcDir: s.merge.srcDir } : {}),
      ...(s.merge.prefix ? { prefix: s.merge.prefix } : {}),
      ...(s.merge.group != null ? { group: s.merge.group } : {}),
      ...(s.merge.ext ? { ext: s.merge.ext } : {}),
    });
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 600;

function persistNow() {
  const st = useStore.getState();
  const payload = {
    services: {
      edge: pickServicePersist(st.services.edge),
      google: pickServicePersist(st.services.google),
      rv: pickServicePersist(st.services.rv),
    },
    view: st.view,
    merge: {
      srcDir: st.merge.srcDir,
      prefix: st.merge.prefix,
      group: st.merge.group,
      ext: st.merge.ext,
    },
  };
  window.inktts.settings.patch(payload).catch(() => { /* noop */ });
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
}

export function startAutosave() {
  // subscribe ทุกการเปลี่ยน — debounce ให้เขียนไม่บ่อย
  // (zustand subscribe ส่ง full state — เราเปรียบเทียบด้วย shallow check ของ slice ที่สนใจ)
  let last: any = null;
  const unsub = useStore.subscribe((state) => {
    const slice = JSON.stringify({
      services: {
        edge: pickServicePersist(state.services.edge),
        google: pickServicePersist(state.services.google),
        rv: pickServicePersist(state.services.rv),
      },
      view: state.view,
      merge: { srcDir: state.merge.srcDir, prefix: state.merge.prefix, group: state.merge.group, ext: state.merge.ext },
    });
    if (slice !== last) {
      last = slice;
      scheduleSave();
    }
  });
  return () => {
    unsub();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  };
}
