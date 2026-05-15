import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/state/store';
import { getService, buildOptionsFromFields } from '@/lib/services';
import type { ServiceKey, TtsEvent, ProgStatus } from '@/types/inktts';
import { FieldRenderer, Spinbox } from './FieldRenderer';
import { FileRow } from './FileRow';
import { Codicon } from '@/ui/Codicon';
import { AppButton } from '@/ui/AppButton';
import { AppCard } from '@/ui/AppCard';
import { cn } from '@/ui/cn';

interface Props { serviceKey: ServiceKey }

const SERVICE_ICON: Record<string, string> = {
  edge: 'star-full',
  google: 'globe',
  rv: 'mic',
};

export function ServicePanel({ serviceKey }: Props) {
  const svc = getService(serviceKey);
  const state = useStore((s) => s.services[serviceKey]);
  const updateService = useStore((s) => s.updateService);
  const patchField = useStore((s) => s.patchServiceField);
  const patchRow = useStore((s) => s.patchRow);
  const upsertRow = useStore((s) => s.upsertRow);
  const resetRun = useStore((s) => s.resetServiceRun);
  const setStatus = useStore((s) => s.setStatus);
  const inputDir = useStore((s) => s.inputDir);
  const outputDir = useStore((s) => s.outputDir);

  const [globFiles, setGlobFiles] = useState<string[]>([]);

  useEffect(() => {
    // อ่าน jobId ผ่าน getState ทุกครั้งที่ event เข้า — ไม่ใช่จาก closure
    // เหตุผล: ตอน job เริ่ม runner emit event sync ก่อน IPC reply กลับมาที่ renderer
    //         ถ้า capture จาก closure จะได้ค่าเก่า (null) → filter ทิ้ง event "SKIP" ของไฟล์
    //         ที่ output เสร็จไว้แล้ว → row ติด PENDING ตลอด (อาการ "ค้าง 3000+ วิ")
    //         renderer ตอนนี้ pre-set state.jobId ก่อนยิง IPC → getState ได้ค่าใหม่ทัน
    const off = window.inktts.tts.onEvent((evt: TtsEvent) => {
      const currentJobId = useStore.getState().services[serviceKey].jobId;
      if (evt.jobId !== currentJobId) return;
      if (evt.type === 'start') {
        // Runner just acquired a slot for this file — start the actual timer
        patchRow(serviceKey, evt.fileBase, { startTime: Date.now(), endTime: undefined });
      } else if (evt.type === 'prog') {
        const base = evt.fileBase;
        const cur = useStore.getState().services[serviceKey].rowsByBase[base];
        const isFinal = ['DONE', 'FAIL', 'FFMPEG_FAIL', 'SKIP', 'EMPTY'].includes(evt.status);
        if (cur == null) {
          upsertRow(serviceKey, {
            base, status: evt.status as ProgStatus, done: evt.done, total: evt.total,
            startTime: null,
            ...(isFinal ? { endTime: Date.now() } : {}),
          });
        } else {
          patchRow(serviceKey, base, {
            status: evt.status, done: evt.done, total: evt.total,
            ...(isFinal ? { endTime: Date.now() } : {}),
          });
        }
      } else if (evt.type === 'limit') {
        updateService(serviceKey, { limitInfo: { kind: evt.kind, old: evt.old, new: evt.new, initial: evt.initial } });
      } else if (evt.type === 'done') {
        updateService(serviceKey, { jobId: null, endTime: Date.now(), cancelled: !!evt.cancelled });
        const fail = evt.stats?.filesFailed ?? 0;
        const ok = evt.stats?.filesDone ?? 0;
        const skip = evt.stats?.filesSkipped ?? 0;
        if (fail > 0) setStatus({ kind: 'fail', message: `เสร็จพร้อมความผิดพลาด · สำเร็จ ${ok} · ล้มเหลว ${fail} · ข้าม ${skip} · ใช้เวลา ${evt.elapsedSec.toFixed(1)} วินาที` });
        else setStatus({ kind: 'ok', message: `สำเร็จ ${ok} ไฟล์ · ข้าม ${skip} · ใช้เวลา ${evt.elapsedSec.toFixed(1)} วินาที` });
      } else if (evt.type === 'error') {
        updateService(serviceKey, { jobId: null });
        setStatus({ kind: 'fail', message: `ผิดพลาด: ${evt.message}` });
      }
    });
    return off;
  }, [serviceKey]);

  const resolvedFiles = useMemo(() => {
    if (state.selectedFiles.length) return state.selectedFiles;
    return globFiles;
  }, [state.selectedFiles, globFiles]);

  const effectiveFiles = useMemo(() => {
    if (state.limitAll) return resolvedFiles;
    return resolvedFiles.slice(0, state.limitN);
  }, [resolvedFiles, state.limitAll, state.limitN]);

  useEffect(() => {
    const refresh = async () => {
      if (state.selectedFiles.length || !state.pattern) {
        setGlobFiles([]);
        return;
      }
      const list = await window.inktts.fs.listGlob(state.pattern);
      setGlobFiles(list);
    };
    refresh();
  }, [state.pattern, state.selectedFiles.length]);

  useEffect(() => {
    if (!state.pattern && !state.selectedFiles.length && inputDir) {
      updateService(serviceKey, { pattern: inputDir });
    }
  }, [inputDir, state.pattern, state.selectedFiles.length, serviceKey]);

  const onPresetChange = (idx: number) => {
    const p = svc.presets[idx];
    updateService(serviceKey, { presetIdx: idx, batch: p.batch, conn: p.conn });
  };

  const browseFolder = async () => {
    const dir = await window.inktts.fs.chooseFolder({ defaultPath: inputDir, title: 'เลือกโฟลเดอร์' });
    if (dir) updateService(serviceKey, { pattern: dir, selectedFiles: [] });
  };
  const browseFiles = async () => {
    const files = await window.inktts.fs.chooseFiles({ defaultPath: inputDir, title: 'เลือกไฟล์' });
    if (files.length) updateService(serviceKey, { selectedFiles: files, pattern: '' });
  };

  const running = !!state.jobId;
  const totalConn = state.batch * state.conn;
  const overCap = totalConn > svc.maxTotal;

  const onStart = async () => {
    if (!effectiveFiles.length) {
      setStatus({ kind: 'warn', message: 'ไม่มีไฟล์ให้แปลง' });
      return;
    }
    resetRun(serviceKey);
    effectiveFiles.forEach((f) => {
      const base = f.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
      upsertRow(serviceKey, { base, status: 'PENDING', done: 0, total: 1, startTime: null });
    });
    // pre-set jobId ก่อนยิง IPC → runner emit event ช่วง sync prelude (log+SKIP/PENDING ไฟล์แรก)
    // จะ match jobId ทันที ไม่หล่นในช่วงระหว่าง IPC reply กับ React setState
    const localJobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    updateService(serviceKey, { jobId: localJobId, startTime: Date.now(), lastRunFiles: effectiveFiles });
    const opts = buildOptionsFromFields(svc, state.fieldValues);
    const result = await window.inktts.tts.start({
      service: serviceKey,
      files: effectiveFiles,
      options: { ...opts, batchSize: state.batch, connectionsPerFile: state.conn },
      jobId: localJobId,
    });
    if (!result.ok) {
      updateService(serviceKey, { jobId: null });
      setStatus({ kind: 'fail', message: result.error || 'เริ่มงานไม่สำเร็จ' });
      return;
    }
    setStatus({ kind: 'run', message: `กำลังแปลง ${svc.name} · ${effectiveFiles.length} ไฟล์` });
  };

  const onRetryFailed = async () => {
    const failedBases = new Set(state.rows
      .filter((r) => r.status === 'FAIL' || r.status === 'FFMPEG_FAIL')
      .map((r) => r.base));
    if (!failedBases.size) {
      setStatus({ kind: 'info', message: 'ไม่มีไฟล์ที่ล้มเหลวให้ลองใหม่' });
      return;
    }
    const retryFiles = state.lastRunFiles.filter((f) => {
      const base = f.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
      return failedBases.has(base);
    });
    if (!retryFiles.length) {
      setStatus({ kind: 'warn', message: 'หาที่อยู่ไฟล์เดิมไม่เจอ — กรุณากด "เริ่มแปลงเสียง" ใหม่' });
      return;
    }
    // reset the failed rows to PENDING; keep DONE/SKIP rows intact
    failedBases.forEach((base) => {
      patchRow(serviceKey, base, { status: 'PENDING', done: 0, total: 1, startTime: null, endTime: undefined });
    });
    // pre-set jobId เหมือน onStart — กัน event หล่นช่วง sync prelude
    const localJobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    updateService(serviceKey, { jobId: localJobId, startTime: Date.now() });
    const opts = buildOptionsFromFields(svc, state.fieldValues);
    const result = await window.inktts.tts.start({
      service: serviceKey,
      files: retryFiles,
      options: { ...opts, batchSize: state.batch, connectionsPerFile: state.conn },
      jobId: localJobId,
    });
    if (!result.ok) {
      updateService(serviceKey, { jobId: null });
      setStatus({ kind: 'fail', message: result.error || 'ลองใหม่ไม่สำเร็จ' });
      return;
    }
    setStatus({ kind: 'run', message: `กำลังลองใหม่ ${retryFiles.length} ไฟล์ที่ล้มเหลว` });
  };

  const onStop = async () => {
    if (!state.jobId) return;
    await window.inktts.tts.cancel(state.jobId);
    updateService(serviceKey, { cancelled: true });
    setStatus({ kind: 'warn', message: 'กำลังขอหยุด... (รอตอนที่กำลังทำอยู่ให้เสร็จก่อน)' });
  };

  const onOpenOutput = () => {
    const dir = `${outputDir.replace(/[\\/]+$/, '')}\\${svc.outputSubdir}`.replace(/\\/g, '/');
    window.inktts.fs.revealFolder(dir);
  };

  const inputSummary = useMemo(() => {
    if (state.selectedFiles.length) {
      const names = state.selectedFiles.slice(0, 3).map((f) => f.split(/[\\/]/).pop());
      const tail = state.selectedFiles.length > 3 ? `, …และอีก ${state.selectedFiles.length - 3}` : '';
      return { icon: 'files', tone: 'fg-dim', text: `${state.selectedFiles.length} ไฟล์ที่เลือก: ${names.join(', ')}${tail}` };
    }
    if (state.pattern) {
      if (resolvedFiles.length) return { icon: 'folder-opened', tone: 'fg-dim', text: `พบ ${resolvedFiles.length} ไฟล์ใน ${state.pattern}` };
      return { icon: 'warning', tone: 'warning', text: `ไม่พบไฟล์ .txt ใน ${state.pattern}` };
    }
    return { icon: 'info', tone: 'muted', text: 'เลือกโฟลเดอร์หรือไฟล์ด้านบน' };
  }, [state.selectedFiles, state.pattern, resolvedFiles]);

  const stats = useMemo(() => {
    let ok = 0, fail = 0, work = 0, skip = 0;
    for (const r of state.rows) {
      if (r.status === 'DONE') ok += 1;
      else if (r.status === 'FAIL' || r.status === 'FFMPEG_FAIL') fail += 1;
      else if (r.status === 'SKIP' || r.status === 'EMPTY') skip += 1;
      else if (r.status === 'WORK') work += 1;
    }
    const finished = ok + fail;
    const elapsed = state.startTime ? ((state.endTime ?? Date.now()) - state.startTime) / 1000 : 0;
    const avg = finished > 0 ? elapsed / finished : 0;
    const remaining = state.rows.length - finished - skip;
    const eta = avg > 0 && remaining > 0 ? remaining * avg : 0;
    return { ok, fail, work, skip, finished, total: state.rows.length, avg, eta, elapsed };
  }, [state.rows, state.startTime, state.endTime]);

  const outputPath = `${outputDir}/${svc.outputSubdir}`.replace(/\\/g, '/');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 pt-6 pb-5 border-b border-vscode-border flex items-start gap-3.5 flex-none">
        <Codicon name={SERVICE_ICON[serviceKey] || 'star'} size={26} className="text-vscode-focus mt-1" />
        <div>
          <div className="text-[20px] font-semibold text-vscode-fg-bright leading-tight">{svc.title}</div>
          <div className="text-[13px] text-vscode-fg-dim mt-1">{svc.subtitle}</div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
        {/* Input file selection */}
        <AppCard title="ไฟล์ที่จะแปลง" bodyClassName="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <AppButton tone="zinc" variant="chrome" onClick={browseFolder}>
              <Codicon name="folder" size={13} />
              เลือกโฟลเดอร์
            </AppButton>
            <AppButton tone="zinc" variant="chrome" onClick={browseFiles}>
              <Codicon name="files" size={13} />
              เลือกไฟล์ (เลือกได้หลาย)
            </AppButton>
          </div>
          <div className={cn('flex items-center gap-2 text-[13px]',
            inputSummary.tone === 'warning' ? 'text-vscode-warning' :
            inputSummary.tone === 'muted' ? 'text-vscode-muted' : 'text-vscode-fg-dim',
          )}>
            <Codicon name={inputSummary.icon} size={14} />
            <span className="truncate">{inputSummary.text}</span>
          </div>

          <div className="flex items-center gap-3 pt-1 flex-wrap">
            <label className="flex items-center gap-2 text-[13px] text-vscode-fg cursor-pointer h-10">
              <input
                type="checkbox"
                checked={state.limitAll}
                onChange={(e) => updateService(serviceKey, { limitAll: e.target.checked })}
                className="accent-vscode-focus w-4 h-4"
              />
              <span>แปลงทุกไฟล์</span>
            </label>
            <span className={cn('text-[13px]', state.limitAll ? 'text-vscode-muted' : 'text-vscode-fg-dim')}>หรือเลือกแค่</span>
            <Spinbox
              value={state.limitN}
              min={1}
              max={10000}
              onChange={(n) => updateService(serviceKey, { limitN: n })}
              width={120}
            />
            <span className={cn('text-[13px]', state.limitAll ? 'text-vscode-muted' : 'text-vscode-fg-dim')}>ไฟล์แรก</span>
          </div>
        </AppCard>

        {/* Settings card */}
        <AppCard title="ตั้งค่าการแปลง" bodyClassName="space-y-2">
          <FieldRow label="พรีเซต">
            <select
              className="h-10 px-3 text-[13px] bg-vscode-input border border-vscode-input-border rounded-sm text-vscode-fg focus:outline-none focus:border-vscode-focus w-full max-w-md"
              value={state.presetIdx}
              onChange={(e) => onPresetChange(Number(e.target.value))}
            >
              {svc.presets.map((p, i) => (
                <option key={i} value={i}>{p.label}</option>
              ))}
            </select>
          </FieldRow>

          {svc.fields.filter((f) => !f.advanced).map((f) => (
            <FieldRenderer
              key={f.name}
              field={f}
              value={state.fieldValues[f.name]}
              onChange={(v) => patchField(serviceKey, f.name, v)}
            />
          ))}

          <button
            type="button"
            className="w-full h-10 text-left text-[13px] text-vscode-fg-dim hover:text-vscode-fg hover:bg-vscode-list-hover rounded-sm px-3 flex items-center gap-2"
            onClick={() => updateService(serviceKey, { advancedOpen: !state.advancedOpen })}
          >
            <Codicon name={state.advancedOpen ? 'chevron-down' : 'chevron-right'} size={14} />
            <span>{state.advancedOpen ? 'ตั้งค่าขั้นสูง (คลิกเพื่อซ่อน)' : 'ตั้งค่าขั้นสูง (สำหรับผู้ใช้ที่ต้องการปรับ)'}</span>
          </button>

          {state.advancedOpen && (
            <div className="space-y-2 pl-2 border-l-2 border-vscode-border ml-1">
              <FieldRow label="จำนวนไฟล์ต่อรอบ">
                <div className="flex items-center gap-3 w-full max-w-md">
                  <input
                    type="range"
                    min={1}
                    max={svc.maxTotal}
                    value={state.batch}
                    onChange={(e) => updateService(serviceKey, { batch: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-vscode-accent"
                  />
                  <span className="font-bold text-vscode-fg-bright text-[14px] tabular-nums w-12 text-right">{state.batch}</span>
                </div>
              </FieldRow>
              <FieldRow label="การเชื่อมต่อต่อไฟล์">
                <div className="flex items-center gap-3 w-full max-w-md">
                  <input
                    type="range"
                    min={1}
                    max={svc.maxTotal}
                    value={state.conn}
                    onChange={(e) => updateService(serviceKey, { conn: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-vscode-accent"
                  />
                  <span className="font-bold text-vscode-fg-bright text-[14px] tabular-nums w-12 text-right">{state.conn}</span>
                </div>
              </FieldRow>
              <div className={cn('text-[12px] flex items-center gap-2', overCap ? 'text-vscode-error' : 'text-vscode-fg-dim')}>
                <Codicon name={overCap ? 'warning' : 'info'} size={14} />
                {overCap
                  ? `รวมการเชื่อมต่อเกินเพดาน (${svc.maxTotal}) — ลดจำนวนไฟล์ต่อรอบหรือการเชื่อมต่อต่อไฟล์`
                  : `การเชื่อมต่อรวม: ${state.batch} × ${state.conn} = ${totalConn}  (เพดาน ${svc.maxTotal})`}
              </div>
              {svc.fields.filter((f) => f.advanced).map((f) => (
                <FieldRenderer
                  key={f.name}
                  field={f}
                  value={state.fieldValues[f.name]}
                  onChange={(v) => patchField(serviceKey, f.name, v)}
                />
              ))}
            </div>
          )}

          <div className="text-[12px] text-vscode-fg-dim flex items-center gap-2 pt-1">
            <Codicon name="output" size={14} />
            <span>ไฟล์เสียงจะอยู่ที่: {outputPath}</span>
          </div>

          <div className="flex items-center gap-2 pt-3 flex-wrap">
            <AppButton tone="primary" disabled={running || !effectiveFiles.length} onClick={onStart}>
              <Codicon name="play" size={15} />
              เริ่มแปลงเสียง
            </AppButton>
            <AppButton tone="zinc" disabled={!running} onClick={onStop}>
              <Codicon name="stop-circle" size={15} />
              หยุด
            </AppButton>
            <AppButton
              tone="amber"
              variant="flat"
              disabled={running || !stats.fail}
              onClick={onRetryFailed}
            >
              <Codicon name="refresh" size={15} />
              ลองใหม่เฉพาะที่ล้มเหลว {stats.fail > 0 ? `(${stats.fail})` : ''}
            </AppButton>
            <AppButton tone="zinc" variant="flat" onClick={onOpenOutput}>
              <Codicon name="folder-opened" size={15} />
              เปิดโฟลเดอร์ผลลัพธ์
            </AppButton>
          </div>
        </AppCard>

        {/* Summary */}
        <div className="bg-vscode-surface border border-vscode-border rounded-sm px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <div className="text-[14px] font-semibold text-vscode-fg-bright">
            {state.rows.length === 0 ? 'พร้อมเริ่มงาน' :
              `ทั้งหมด ${state.rows.length}  ·  สำเร็จ ${stats.ok}  ·  ล้มเหลว ${stats.fail}  ·  รอ ${state.rows.length - stats.finished - stats.skip}  ·  ข้าม ${stats.skip}`}
          </div>
          {stats.finished > 0 && (
            <div className="text-[12px] text-vscode-fg-dim">เฉลี่ย {stats.avg.toFixed(2)} วินาที/ไฟล์</div>
          )}
          {running && stats.eta > 0 && (
            <div className="text-[12px] text-vscode-fg-dim">เหลืออีก ≈ {Math.round(stats.eta)} วินาที</div>
          )}
          {state.limitInfo && (
            <div className={cn('text-[12px] flex items-center gap-1.5', state.limitInfo.kind === 'shrink' ? 'text-vscode-warning' : 'text-vscode-success')}>
              <Codicon name={state.limitInfo.kind === 'shrink' ? 'arrow-down' : 'arrow-up'} size={13} />
              {state.limitInfo.kind === 'shrink'
                ? `ลดความเร็วอัตโนมัติ: ${state.limitInfo.new}/${state.limitInfo.initial}`
                : `เพิ่มความเร็วกลับ: ${state.limitInfo.new}/${state.limitInfo.initial}`}
            </div>
          )}
        </div>

        {/* Progress grid */}
        <AppCard title="ความคืบหน้าแต่ละไฟล์" bodyClassName="p-0">
          <div className="max-h-[520px] overflow-auto bg-vscode-editor p-2">
            {state.rows.length === 0 ? (
              <div className="text-[13px] text-vscode-muted px-3 py-4">ยังไม่ได้เริ่ม — กด "เริ่มแปลงเสียง" ด้านบน</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
                {state.rows.map((r) => <FileRow key={r.base} row={r} />)}
              </div>
            )}
          </div>
        </AppCard>
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
