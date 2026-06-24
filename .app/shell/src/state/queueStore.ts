import { create } from 'zustand';
import type { QueueItem, QueueUpdateEvent, QueueLogEvent } from '@/types/inktts';

export interface QueueLogEntry { level: string; message: string; ts: number; }

interface QueueState {
  items: QueueItem[];
  loaded: boolean;
  /** log buffer ต่อ item — เก็บไว้ใน memory โชว์ตอน expand row (จำกัด 300 บรรทัด) */
  logsByItem: Record<string, QueueLogEntry[]>;
  /** id ของ row ที่กางดู log อยู่ */
  expandedId: string | null;
  setExpanded: (id: string | null) => void;
  load: () => Promise<void>;
  applyUpdate: (evt: QueueUpdateEvent) => void;
  appendLog: (evt: QueueLogEvent) => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  items: [],
  loaded: false,
  logsByItem: {},
  expandedId: null,

  setExpanded: (id) => set((s) => ({ expandedId: s.expandedId === id ? null : id })),

  load: async () => {
    try {
      const snap = await window.inktts.queue.snapshot();
      set({ items: snap?.items || [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  applyUpdate: (evt) => {
    if (!evt) return;
    if (evt.type === 'snapshot') {
      set({ items: evt.items || [] });
    } else if (evt.type === 'item' && evt.item) {
      set((s) => {
        const idx = s.items.findIndex((it) => it.id === evt.item.id);
        if (idx < 0) return { items: [...s.items, evt.item] };
        const items = s.items.slice();
        items[idx] = evt.item;
        return { items };
      });
    }
  },

  appendLog: ({ itemId, level, message, ts }) => set((s) => {
    const cur = s.logsByItem[itemId] || [];
    const next = [...cur, { level, message, ts }].slice(-300);
    return { logsByItem: { ...s.logsByItem, [itemId]: next } };
  }),
}));
