import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueueStore } from '@/state/queueStore';
import { getService, SERVICES, buildOptionsFromFields } from '@/lib/services';
import type { ServiceKey, QueueItem } from '@/types/inktts';
import { FieldRenderer } from './FieldRenderer';
import { QueueItemRow } from './QueueItemRow';
import { Codicon } from '@/ui/Codicon';
import { AppButton } from '@/ui/AppButton';
import { AppCard } from '@/ui/AppCard';
import { Input, Select } from '@/ui/Input';
import { cn } from '@/ui/cn';
import { formatClock } from '@/lib/formatTime';

const SERVICE_LABEL: Record<string, string> = { edge: 'Edge', google: 'Google', rv: 'ResponsiveVoice' };

interface FormState {
  editingId: string | null;
  name: string;
  service: ServiceKey;
  presetIdx: number;
  fieldValues: Record<string, any>;
  inputDir: string;
  inputFiles: string[];
  outputDir: string;
}

function defaultFieldValues(service: ServiceKey): Record<string, any> {
  const svc = getService(service);
  const fv: Record<string, any> = {};
  for (const f of svc.fields) fv[f.name] = f.default;
  return fv;
}

const emptyForm = (): FormState => ({
  editingId: null,
  name: '',
  service: 'edge',
  presetIdx: 0,
  fieldValues: defaultFieldValues('edge'),
  inputDir: '',
  inputFiles: [],
  outputDir: '',
});

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
const parentDir = (p: string) => {
  const norm = p.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return idx > 0 ? norm.slice(0, idx) : '';
};

export function QueuePanel() {
  const items = useQueueStore((s) => s.items);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [now, setNow] = useState(Date.now());
  const formRef = useRef<HTMLDivElement>(null);

  const svc = getService(form.service);
  const anyRunning = items.some((it) => it.status === 'running');

  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const summary = useMemo(() => {
    const by: Record<string, number> = {};
    let totalElapsed = 0;
    for (const it of items) {
      by[it.status] = (by[it.status] || 0) + 1;
      if (it.startedAt != null) totalElapsed += (it.endedAt ?? now) - it.startedAt;
    }
    return { by, totalElapsed };
  }, [items, now]);

  const onChangeService = (service: ServiceKey) =>
    setForm((f) => ({ ...f, service, presetIdx: 0, fieldValues: defaultFieldValues(service) }));

  const onPickInputFolder = async () => {
    const dir = await window.inktts.fs.chooseFolder({ defaultPath: form.inputDir, title: 'เลือกโฟลเดอร์ต้นทาง (.txt)' });
    if (!dir) return;
    // โหมดโฟลเดอร์ → ล้างไฟล์รายตัวที่เลือกไว้
    setForm((f) => ({ ...f, inputDir: dir, inputFiles: [], name: f.name || baseName(dir) }));
  };
  const onPickInputFiles = async () => {
    const files = await window.inktts.fs.chooseFiles({ defaultPath: form.inputDir, title: 'เลือกไฟล์ .txt (เลือกหลายไฟล์ได้)' });
    if (!files || !files.length) return;
    // โหมดไฟล์รายตัว → ล้างโฟลเดอร์, ตั้งชื่อ default จากโฟลเดอร์แม่ของไฟล์แรก
    setForm((f) => ({ ...f, inputFiles: files, inputDir: '', name: f.name || baseName(parentDir(files[0])) }));
  };
  const onPickOutput = async () => {
    const dir = await window.inktts.fs.chooseFolder({ defaultPath: form.outputDir || form.inputDir, title: 'เลือกโฟลเดอร์ปลายทาง' });
    if (!dir) return;
    setForm((f) => ({ ...f, outputDir: dir }));
  };

  const startEdit = (item: QueueItem) => {
    setForm({
      editingId: item.id,
      name: item.name,
      service: item.service,
      presetIdx: item.presetIdx,
      fieldValues: { ...defaultFieldValues(item.service), ...item.fieldValues },
      inputDir: item.inputDir,
      inputFiles: item.inputFiles || [],
      outputDir: item.outputDir,
    });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const canSubmit = (!!form.inputDir || form.inputFiles.length > 0) && !!form.outputDir;

  const onSubmit = async () => {
    if (!canSubmit) return;
    const preset = svc.presets[form.presetIdx] || svc.presets[0];
    const runOptions = {
      ...buildOptionsFromFields(svc, form.fieldValues),
      batchSize: preset.batch,
      connectionsPerFile: preset.conn,
    };
    const payload = {
      name: form.name.trim() || baseName(form.inputDir) || baseName(parentDir(form.inputFiles[0] || '')) || 'เรื่องใหม่',
      service: form.service,
      presetIdx: form.presetIdx,
      fieldValues: form.fieldValues,
      runOptions,
      inputDir: form.inputDir,
      inputFiles: form.inputFiles,
      outputDir: form.outputDir,
    };
    if (form.editingId) await window.inktts.queue.update(form.editingId, payload);
    else await window.inktts.queue.add(payload);
    setForm(emptyForm());
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 pt-6 pb-5 border-b border-vscode-border flex items-start gap-3.5 flex-none">
        <Codicon name="list-ordered" size={26} className="text-vscode-focus mt-1" />
        <div className="flex-1">
          <div className="text-[20px] font-semibold text-vscode-fg-bright leading-tight">คิวรายเรื่อง</div>
          <div className="text-[13px] text-vscode-fg-dim mt-1">เพิ่มหลายเรื่องเข้าคิว แล้วระบบจะแปลง <b>ทีละเรื่องเรียงกัน</b> (ไม่พร้อมกัน เพื่อกันโดนจำกัดเรท)</div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
        {/* ── ฟอร์มเพิ่ม/แก้ไขเรื่อง ── */}
        <div ref={formRef}>
          <AppCard
            title={form.editingId ? 'แก้ไขเรื่อง' : 'เพิ่มเรื่องเข้าคิว'}
            bodyClassName="space-y-3"
          >
            <FieldRow label="ชื่อเรื่อง (queue)">
              <Input
                type="text"
                className="w-full max-w-md"
                placeholder="ตั้งชื่อเรื่อง เช่น พลิกร้ายกลายเป็นดี 1-100"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </FieldRow>

            <FieldRow label="บริการเสียง">
              <Select className="w-full max-w-xs" value={form.service} onChange={(e) => onChangeService(e.target.value as ServiceKey)}>
                {SERVICES.map((s) => <option key={s.key} value={s.key}>{SERVICE_LABEL[s.key] || s.name}</option>)}
              </Select>
            </FieldRow>

            <FieldRow label="พรีเซ็ตความเร็ว">
              <Select
                className="w-full max-w-md"
                value={form.presetIdx}
                onChange={(e) => setForm((f) => ({ ...f, presetIdx: Number(e.target.value) }))}
              >
                {svc.presets.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
              </Select>
            </FieldRow>

            {/* service fields (ไม่รวม advanced) — voice/rate/gender ฯลฯ */}
            {svc.fields.filter((f) => !f.advanced).map((f) => (
              <FieldRenderer
                key={f.name}
                field={f}
                value={form.fieldValues[f.name]}
                onChange={(v) => setForm((s) => ({ ...s, fieldValues: { ...s.fieldValues, [f.name]: v } }))}
              />
            ))}

            <FieldRow label="ต้นทาง (.txt)">
              <div className="flex items-center gap-2 w-full">
                <AppButton tone="zinc" variant="chrome" onClick={onPickInputFolder}>
                  <Codicon name="folder" size={13} /> เลือกโฟลเดอร์
                </AppButton>
                <AppButton tone="zinc" variant="chrome" onClick={onPickInputFiles}>
                  <Codicon name="files" size={13} /> เลือกไฟล์
                </AppButton>
                <span
                  className="text-[11px] text-vscode-fg-dim truncate flex-1"
                  title={form.inputFiles.length ? form.inputFiles.join('\n') : form.inputDir}
                >
                  {form.inputFiles.length
                    ? `เลือก ${form.inputFiles.length} ไฟล์`
                    : (form.inputDir || '(ยังไม่เลือก)')}
                </span>
              </div>
            </FieldRow>

            <FieldRow label="โฟลเดอร์ปลายทาง (.m4a)">
              <div className="flex items-center gap-2 w-full">
                <AppButton tone="zinc" variant="chrome" onClick={onPickOutput}>
                  <Codicon name="folder" size={13} /> เลือก
                </AppButton>
                <span className="text-[11px] text-vscode-fg-dim truncate flex-1" title={form.outputDir}>{form.outputDir || '(ยังไม่เลือก)'}</span>
              </div>
            </FieldRow>

            <div className="flex items-center gap-2 pt-1">
              <AppButton tone="primary" onClick={onSubmit} disabled={!canSubmit}>
                <Codicon name={form.editingId ? 'check' : 'add'} size={15} />
                {form.editingId ? 'บันทึกการแก้ไข' : 'เพิ่มเข้าคิว'}
              </AppButton>
              {form.editingId && (
                <AppButton tone="zinc" variant="flat" onClick={() => setForm(emptyForm())}>
                  <Codicon name="close" size={15} /> ยกเลิกแก้ไข
                </AppButton>
              )}
            </div>
          </AppCard>
        </div>

        {/* ── แถบควบคุม + สรุป ── */}
        {items.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <AppButton tone="primary" onClick={() => window.inktts.queue.startAll()}>
              <Codicon name="run-all" size={15} /> เริ่มทั้งหมด
            </AppButton>
            <AppButton tone="zinc" variant="flat" onClick={() => window.inktts.queue.cancelAll()}>
              <Codicon name="debug-stop" size={15} /> หยุดทั้งหมด
            </AppButton>
            <AppButton tone="zinc" variant="flat" onClick={() => window.inktts.queue.clearDone()}>
              <Codicon name="clear-all" size={15} /> ล้างที่เสร็จแล้ว
            </AppButton>
            <div className="flex-1" />
            <div className="text-[11.5px] text-vscode-fg-dim flex items-center gap-2 tabular-nums">
              <span>ทั้งหมด {items.length} เรื่อง</span>
              {summary.by.running ? <span className="text-vscode-focus">· กำลังแปลง {summary.by.running}</span> : null}
              {summary.by.queued ? <span>· รอคิว {summary.by.queued}</span> : null}
              {summary.by.done ? <span className="text-vscode-success">· เสร็จ {summary.by.done}</span> : null}
              <span className="inline-flex items-center gap-1" title="เวลารวมที่ใช้ไปทุกเรื่อง">
                <Codicon name="clock" size={12} /> รวม <span className="font-mono text-vscode-fg">{formatClock(summary.totalElapsed)}</span>
              </span>
            </div>
          </div>
        )}

        {/* ── รายการคิว ── */}
        {items.length === 0 ? (
          <div className="text-[12px] text-vscode-muted py-8 text-center border border-dashed border-vscode-border rounded-sm">
            ยังไม่มีเรื่องในคิว — เพิ่มเรื่องด้านบนแล้วกด "เพิ่มเข้าคิว"
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it, i) => (
              <QueueItemRow key={it.id} item={it} index={i} count={items.length} onEdit={startEdit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRow({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[220px_1fr] items-center gap-3 py-1.5', className)}>
      <label className="text-[13px] text-vscode-fg">{label}</label>
      <div>{children}</div>
    </div>
  );
}
