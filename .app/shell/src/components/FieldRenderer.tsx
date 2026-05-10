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
