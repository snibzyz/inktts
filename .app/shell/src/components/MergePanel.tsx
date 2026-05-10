import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/state/store';
import { Codicon } from '@/ui/Codicon';
import { AppButton } from '@/ui/AppButton';
import { AppCard } from '@/ui/AppCard';
import { Input, Select } from '@/ui/Input';
import { cn } from '@/ui/cn';

export function MergePanel() {
  const merge = useStore((s) => s.merge);
  const setMerge = useStore((s) => s.setMerge);
  const appendLog = useStore((s) => s.appendMergeLog);
  const resetLog = useStore((s) => s.resetMergeLog);
  const setStatus = useStore((s) => s.setStatus);
  const outputDir = useStore((s) => s.outputDir);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offLog = window.inktts.merge.onLog((m) => appendLog(m));
    const offDone = window.inktts.merge.onDone((r) => {
      setMerge({ running: false, result: r });
      if (r.failed) setStatus({ kind: 'fail', message: `รวมเสร็จ — สำเร็จ ${r.totalGroups} กลุ่ม, ล้มเหลว ${r.failed}` });
      else setStatus({ kind: 'ok', message: `รวมสำเร็จ ${r.totalGroups} กลุ่ม` });
    });
    return () => { offLog(); offDone(); };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [merge.log.length]);

  const onPickFolder = async () => {
    const dir = await window.inktts.fs.chooseFolder({ defaultPath: outputDir, title: 'เลือกโฟลเดอร์ต้นทาง' });
    if (!dir) return;
    setMerge({ srcDir: dir });
    const det = await window.inktts.merge.detect(dir, merge.ext);
    if (det) {
      setMerge({ detected: det, prefix: det.prefix, start: det.start, end: det.end });
    } else {
      setMerge({ detected: null });
    }
  };

  const onChangeExt = async (ext: 'm4a' | 'mp3') => {
    setMerge({ ext });
    if (merge.srcDir) {
      const det = await window.inktts.merge.detect(merge.srcDir, ext);
      setMerge({ detected: det });
    }
  };

  const previewLines = useMemo(() => {
    if (!merge.prefix || merge.start > merge.end || merge.group < 1) return { items: [] as string[], total: 0 };
    const out: string[] = [];
    let i = merge.start;
    while (i <= merge.end && out.length < 4) {
      const j = Math.min(i + merge.group - 1, merge.end);
      out.push(`${merge.prefix}${i}-${j}.${merge.ext}`);
      i = j + 1;
    }
    let total = 0;
    let k = merge.start;
    while (k <= merge.end) {
      const j = Math.min(k + merge.group - 1, merge.end);
      total += 1;
      k = j + 1;
    }
    return { items: out, total };
  }, [merge.prefix, merge.start, merge.end, merge.group, merge.ext]);

  const onStart = async () => {
    if (!merge.srcDir || !merge.prefix) {
      setStatus({ kind: 'warn', message: 'เลือกโฟลเดอร์ต้นทาง + กรอก prefix ก่อน' });
      return;
    }
    resetLog();
    setMerge({ running: true });
    setStatus({ kind: 'run', message: 'กำลังรวมไฟล์เสียง...' });
    const result = await window.inktts.merge.start({
      srcDir: merge.srcDir,
      dstDir: `${merge.srcDir}_merged`,
      prefix: merge.prefix,
      start: merge.start,
      end: merge.end,
      group: merge.group,
      ext: merge.ext,
    });
    if (!result.ok) {
      setMerge({ running: false });
      setStatus({ kind: 'fail', message: result.error || 'รวมไฟล์ล้มเหลว' });
    }
  };

  const onOpenOutput = () => {
    if (!merge.srcDir) return;
    window.inktts.fs.revealFolder(`${merge.srcDir}_merged`);
  };

  const dstHint = merge.srcDir ? `${merge.srcDir}_merged` : '(เลือกโฟลเดอร์ต้นทางก่อน)';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 pt-6 pb-5 border-b border-vscode-border flex items-start gap-3.5 flex-none">
        <Codicon name="combine" size={26} className="text-vscode-focus mt-1" />
        <div>
          <div className="text-[20px] font-semibold text-vscode-fg-bright leading-tight">รวมไฟล์เสียงเป็นกลุ่มย่อย</div>
          <div className="text-[13px] text-vscode-fg-dim mt-1">เช่น มีตอน 401-600 → รวมเป็นไฟล์ 401-410, 411-420, … (ไฟล์ละ 10 ตอน)</div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
        <AppCard title="ตั้งค่าการรวม" bodyClassName="space-y-3">
          <FieldRow label={`โฟลเดอร์ต้นทาง (.${merge.ext})`}>
            <div className="flex items-center gap-2 w-full">
              <AppButton tone="zinc" variant="chrome" onClick={onPickFolder}>
                <Codicon name="folder" size={13} />
                เลือก
              </AppButton>
              <span className="text-[11px] text-vscode-fg-dim truncate flex-1">{merge.srcDir || '(ยังไม่เลือก)'}</span>
            </div>
          </FieldRow>

          {merge.srcDir && (
            <div className={cn('text-[12px] flex items-center gap-2 ml-[220px]', merge.detected ? 'text-vscode-success' : 'text-vscode-warning')}>
              <Codicon name={merge.detected ? 'pass-filled' : 'warning'} size={14} />
              {merge.detected
                ? `พบ '${merge.detected.prefix}' ตอน ${merge.detected.start}-${merge.detected.end} (${merge.detected.count} ไฟล์)`
                : `ไม่พบไฟล์ .${merge.ext} ในโฟลเดอร์`}
            </div>
          )}

          <FieldRow label="คำนำหน้าชื่อไฟล์">
            <Input
              type="text"
              className="w-full max-w-md"
              placeholder="เช่น  ติดหนี้สามสิบล้าน  (เว้นวรรคก่อนเลขตอน)"
              value={merge.prefix}
              onChange={(e) => setMerge({ prefix: e.target.value })}
            />
          </FieldRow>

          <FieldRow label="ตั้งแต่ตอน — ถึงตอน">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                className="w-28"
                value={merge.start}
                min={1}
                onChange={(e) => setMerge({ start: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
              <span className="text-[12px] text-vscode-fg-dim">ถึง</span>
              <Input
                type="number"
                className="w-28"
                value={merge.end}
                min={1}
                onChange={(e) => setMerge({ end: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
            </div>
          </FieldRow>

          <FieldRow label="จัดกลุ่มละ (ตอน)">
            <Input
              type="number"
              className="w-28"
              value={merge.group}
              min={1}
              max={1000}
              onChange={(e) => setMerge({ group: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
          </FieldRow>

          <FieldRow label="นามสกุล">
            <Select
              className="w-32"
              value={merge.ext}
              onChange={(e) => onChangeExt(e.target.value as 'm4a' | 'mp3')}
            >
              <option value="m4a">m4a</option>
              <option value="mp3">mp3</option>
            </Select>
          </FieldRow>

          {previewLines.items.length > 0 && (
            <div className="text-[12px] text-vscode-fg-dim ml-[220px] flex items-start gap-2">
              <Codicon name="list-tree" size={14} className="mt-0.5" />
              <span>จะได้ {previewLines.total} ไฟล์ผลลัพธ์: {previewLines.items.join(', ')}{previewLines.total > 4 ? ` …และอีก ${previewLines.total - 4}` : ''}</span>
            </div>
          )}

          <div className="text-[12px] text-vscode-fg-dim flex items-center gap-2 pt-1">
            <Codicon name="output" size={14} />
            <span>ไฟล์รวมจะอยู่ที่:  {dstHint}</span>
          </div>

          <div className="flex items-center gap-2 pt-3">
            <AppButton tone="primary" disabled={merge.running} onClick={onStart}>
              <Codicon name="play" size={15} />
              เริ่มรวม
            </AppButton>
            <AppButton tone="zinc" variant="flat" onClick={onOpenOutput}>
              <Codicon name="folder-opened" size={15} />
              เปิดโฟลเดอร์ผลลัพธ์
            </AppButton>
          </div>
        </AppCard>

        <AppCard title="บันทึกการรวม" bodyClassName="p-0">
          <div ref={logRef} className="h-72 overflow-auto bg-vscode-editor px-4 py-3 font-mono text-[12px] leading-relaxed">
            {merge.log.length === 0 ? (
              <div className="text-vscode-muted">(ยังไม่มีบันทึก — กด "เริ่มรวม")</div>
            ) : (
              merge.log.map((l, i) => {
                const labelMap: Record<string, string> = {
                  ok: 'สำเร็จ',
                  error: 'ผิดพลาด',
                  warn: 'เตือน',
                  skip: 'ข้าม',
                  info: 'ข้อมูล',
                };
                const label = labelMap[l.level] || l.level;
                return (
                  <div key={i} className={cn(
                    l.level === 'error' ? 'text-vscode-error' :
                    l.level === 'warn' ? 'text-vscode-warning' :
                    l.level === 'ok' ? 'text-vscode-success' :
                    l.level === 'skip' ? 'text-vscode-muted' : 'text-vscode-fg',
                  )}>
                    [{label}] {l.message}
                  </div>
                );
              })
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
