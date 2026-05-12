import { useEffect, useState } from 'react';
import type { FieldDef } from '@/types/inktts';
import { Input, Select } from '@/ui/Input';
import { Codicon } from '@/ui/Codicon';
import { cn } from '@/ui/cn';

interface Props {
  field: FieldDef;
  value: any;
  onChange: (v: any) => void;
}

export function FieldRenderer({ field, value, onChange }: Props) {
  if (field.kind === 'combo') {
    const opts = field.options || [];
    const labels = field.optionLabels || opts;
    return (
      <Row label={field.label}>
        <Select
          className="w-full max-w-md"
          value={String(value ?? field.default)}
          onChange={(e) => onChange(e.target.value)}
        >
          {opts.map((o, i) => (
            <option key={o} value={o}>{labels[i] || o}</option>
          ))}
        </Select>
      </Row>
    );
  }
  if (field.kind === 'entry') {
    return (
      <Row label={field.label}>
        <Input
          type="text"
          className="w-full max-w-md"
          value={String(value ?? field.default)}
          onChange={(e) => onChange(e.target.value)}
        />
      </Row>
    );
  }
  if (field.kind === 'spinbox') {
    return (
      <Row label={field.label}>
        <Spinbox
          value={Number(value ?? field.default)}
          min={field.min ?? 1}
          max={field.max ?? 1000}
          onChange={onChange}
        />
      </Row>
    );
  }
  if (field.kind === 'rate') {
    return (
      <Row label={field.label}>
        <RateStepper
          value={value}
          defaultValue={Number(field.default) || 0}
          min={field.min ?? -Infinity}
          max={field.max ?? Infinity}
          step={field.step ?? 1}
          unit={field.unit ?? ''}
          precision={field.precision}
          onChange={onChange}
        />
      </Row>
    );
  }
  // scale (slider)
  const min = field.min ?? 0;
  const max = field.max ?? 1;
  const step = field.step ?? 0.01;
  return (
    <Row label={field.label}>
      <div className="flex items-center gap-3 w-full max-w-md">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Number(value ?? field.default)}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 accent-vscode-accent"
        />
        <span className="font-bold text-vscode-fg-bright text-[13px] tabular-nums w-12 text-right">
          {Number(value ?? field.default).toFixed(step < 1 ? 2 : 0)}
        </span>
      </div>
    </Row>
  );
}

function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[220px_1fr] items-center gap-3 py-1.5', className)}>
      <label className="text-[13px] text-vscode-fg">{label}</label>
      <div>{children}</div>
    </div>
  );
}

// === Rate value handling ===
//
// Storage (ใน fieldValues) ขึ้นกับ unit:
//   '%'        → เก็บ % ตรง ๆ เช่น 30
//   'mult-pct' → เก็บ multiplier เช่น 1.3 (engine ใช้ ffmpeg atempo) แต่ user เห็นเป็น "+30%"
//   'x'        → เก็บ multiplier เช่น 1.3 user เห็นเป็น "1.30x"
//   ''         → เก็บ number ตรง ๆ
//
// parseStorage(raw)  — อ่านจาก state (raw อาจเป็น string เก่าจาก settings.json)
// toDisplayPct(stor) — แปลง storage → ตัวเลข % สำหรับโชว์ (เฉพาะ '%' / 'mult-pct')
// fromDisplayPct(pct) — กลับทาง สำหรับเขียนกลับ storage
// formatRate(stor, unit, precision) — string ที่แสดงในกล่อง
// parseInput(text, unit) — user พิมพ์ → storage

type Unit = '%' | 'mult-pct' | 'x' | '';

function parseStorage(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = v.match(/^([-+]?\d+(?:\.\d+)?)\s*%?$/);
    if (m) {
      const n = parseFloat(m[1]);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function formatRate(stored: number, unit: Unit, precision: number): string {
  if (unit === '%') {
    return (stored >= 0 ? '+' : '') + (precision > 0 ? stored.toFixed(precision) : Math.round(stored).toString()) + '%';
  }
  if (unit === 'mult-pct') {
    const pct = (stored - 1) * 100;
    return (pct >= 0 ? '+' : '') + Math.round(pct).toString() + '%';
  }
  if (unit === 'x') return `${stored.toFixed(precision)}x`;
  return stored.toFixed(precision);
}

// user พิมพ์ "+30%", "30", "30%", "-20%", "1.3x", "1.3" → storage number
function parseInput(text: string, unit: Unit): number | null {
  const t = text.trim();
  const m = t.match(/^([-+]?\d+(?:\.\d+)?)\s*([%x]?)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2].toLowerCase();
  // 'mult-pct': ถ้า user พิมพ์ "+30%" / "30%" / "+30" → multiplier 1.3
  //             ถ้า user พิมพ์ "1.3" / "1.3x" → multiplier 1.3 ตรง ๆ
  if (unit === 'mult-pct') {
    if (suffix === 'x') return n;
    // มี % หรือไม่มี suffix แต่ค่าเกินช่วง multiplier (เช่น 30) → เป็น %
    if (suffix === '%' || Math.abs(n) > 5) return 1 + n / 100;
    // กรณีพิมพ์ "1.3" ไม่มี suffix → multiplier
    return n;
  }
  return n;
}

// step ใน "หน่วยที่แสดง" สำหรับ tooltip
function displayStep(storageStep: number, unit: Unit): string {
  if (unit === '%') return `${storageStep}%`;
  if (unit === 'mult-pct') return `${Math.round(storageStep * 100)}%`;
  if (unit === 'x') return `${storageStep}x`;
  return String(storageStep);
}

export function RateStepper({
  value, defaultValue, min, max, step, unit, precision, onChange,
}: {
  value: any;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit: Unit;
  precision?: number;
  onChange: (v: number) => void;
}) {
  const auto = precision ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  const parsed = parseStorage(value);
  const current = parsed != null ? parsed : defaultValue;

  // local string ระหว่าง user กำลังพิมพ์ — กัน "—" / ".5" ฯลฯ ถูก parse ระหว่างทาง
  const [draft, setDraft] = useState<string>(formatRate(current, unit, auto));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(formatRate(current, unit, auto));
  }, [current, unit, auto, editing]);

  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const commit = (n: number) => {
    const next = clamp(Number(n.toFixed(auto + 4))); // กัน floating point creep
    onChange(next);
  };
  const step1 = (dir: 1 | -1) => commit(current + dir * step);
  const stepBig = (dir: 1 | -1) => commit(current + dir * step * 5);

  const commitDraft = () => {
    const n = parseInput(draft, unit);
    if (n != null) commit(n);
    else setDraft(formatRate(current, unit, auto));
    setEditing(false);
  };

  const stepLabel = displayStep(step, unit);
  return (
    <div className="inline-flex items-stretch text-[13px]" style={{ width: 220 }}>
      <button
        type="button"
        className="w-9 h-10 flex items-center justify-center bg-vscode-button hover:bg-vscode-button-hover border border-r-0 border-vscode-input-border rounded-l-sm text-vscode-fg disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => step1(-1)}
        onContextMenu={(e) => { e.preventDefault(); stepBig(-1); }}
        disabled={current <= min}
        title={`ช้าลง ${stepLabel} (คลิกขวา = ช้าลงเร็ว ×5)`}
      >
        <Codicon name="chevron-left" size={14} />
      </button>
      <input
        type="text"
        className="flex-1 h-10 text-center bg-vscode-input border-y border-vscode-input-border text-vscode-fg-bright text-[13px] font-medium tabular-nums focus:outline-none focus:border-vscode-focus min-w-0"
        value={draft}
        onFocus={(e) => { setEditing(true); e.target.select(); }}
        onBlur={commitDraft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { setDraft(formatRate(current, unit, auto)); setEditing(false); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); step1(1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); step1(-1); }
        }}
      />
      <button
        type="button"
        className="w-9 h-10 flex items-center justify-center bg-vscode-button hover:bg-vscode-button-hover border border-l-0 border-vscode-input-border rounded-r-sm text-vscode-fg disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => step1(1)}
        onContextMenu={(e) => { e.preventDefault(); stepBig(1); }}
        disabled={current >= max}
        title={`เร็วขึ้น ${stepLabel} (คลิกขวา = เร็วขึ้น ×5)`}
      >
        <Codicon name="chevron-right" size={14} />
      </button>
      <button
        type="button"
        className="ml-2 h-10 px-2 text-[11px] text-vscode-fg-dim hover:text-vscode-fg-bright"
        onClick={() => commit(defaultValue)}
        title="กลับเป็นค่าเริ่มต้น"
        disabled={current === defaultValue}
      >
        <Codicon name="discard" size={13} />
      </button>
    </div>
  );
}

export function Spinbox({ value, min, max, onChange, width = 110 }: { value: number; min: number; max: number; onChange: (v: number) => void; width?: number }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="inline-flex items-stretch text-[13px]" style={{ width }}>
      <button
        type="button"
        className="w-9 h-10 flex items-center justify-center bg-vscode-button hover:bg-vscode-button-hover border border-r-0 border-vscode-input-border rounded-l-sm text-vscode-fg"
        onClick={() => onChange(clamp(value - 1))}
        title="ลด"
      >
        <Codicon name="chevron-down" size={14} />
      </button>
      <input
        type="number"
        className="flex-1 h-10 text-center bg-vscode-input border-y border-vscode-input-border text-vscode-fg text-[13px] focus:outline-none focus:border-vscode-focus min-w-0"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(clamp(n));
        }}
      />
      <button
        type="button"
        className="w-9 h-10 flex items-center justify-center bg-vscode-button hover:bg-vscode-button-hover border border-l-0 border-vscode-input-border rounded-r-sm text-vscode-fg"
        onClick={() => onChange(clamp(value + 1))}
        title="เพิ่ม"
      >
        <Codicon name="chevron-up" size={14} />
      </button>
    </div>
  );
}
