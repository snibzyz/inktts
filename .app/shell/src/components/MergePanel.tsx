import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/state/store';
import { Codicon } from '@/ui/Codicon';
import { AppButton } from '@/ui/AppButton';
import { AppCard } from '@/ui/AppCard';
import { Input, Select } from '@/ui/Input';
import { NumberField } from '@/ui/NumberField';
import { cn } from '@/ui/cn';
import { reportError } from '@/lib/errorBus';

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
      if (r.failed) {
        setStatus({ kind: 'fail', message: `รวมเสร็จ — สำเร็จ ${r.totalGroups} กลุ่ม, ล้มเหลว ${r.failed}` });
        // เอา log บรรทัด level=error มาเป็น details
        const errLines = useStore.getState().merge.log.filter((l) => l.level === 'error');
        reportError({
          source: 'รวมไฟล์',
          message: `${r.failed} กลุ่มรวมไม่สำเร็จ (สำเร็จ ${r.totalGroups})`,
          details: errLines.slice(-10).map((l) => l.message).join('\n') || undefined,
        });
      } else setStatus({ kind: 'ok', message: `รวมสำเร็จ ${r.totalGroups} กลุ่ม` });
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
      // auto-detect padding จากชื่อไฟล์ต้นทาง — override เฉพาะถ้า input เติมศูนย์จริง (>1 หลัก)
      // ไม่งั้นคงค่า default ไว้ (เช่น input "ตอน 1" ไม่ override default 4)
      setMerge({ detected: det, prefix: det.prefix, start: det.start, end: det.end, ...(det.pad && det.pad > 1 ? { pad: det.pad } : {}) });
    } else {
      setMerge({ detected: null });
    }
  };

  const onChangeExt = async (ext: 'm4a' | 'mp3') => {
    setMerge({ ext });
    if (merge.srcDir) {
      const det = await window.inktts.merge.detect(merge.srcDir, ext);
      if (det) setMerge({ detected: det, prefix: det.prefix, start: det.start, end: det.end, ...(det.pad && det.pad > 1 ? { pad: det.pad } : {}) });
      else setMerge({ detected: null });
    }
  };

  const previewLines = useMemo(() => {
    if (!merge.prefix || merge.start > merge.end || merge.group < 1) return { items: [] as string[], total: 0 };
    // แบ่งกลุ่มก่อน เพื่อหาเลขมากสุด → ใช้คำนวณความกว้าง padding (กรณีอัตโนมัติ)
    const ranges: Array<[number, number]> = [];
    let i = merge.start;
    while (i <= merge.end) {
      const j = Math.min(i + merge.group - 1, merge.end);
      ranges.push([i, j]);
      i = j + 1;
    }
    // pad>0 → เติมศูนย์ N หลัก · pad<=0 → ไม่เติม (เลขดิบ)
    const pad = (n: number) => (merge.pad > 0 ? String(n).padStart(merge.pad, '0') : String(n));
    const items = ranges.slice(0, 4).map(([a, b]) => `${merge.prefix}${pad(a)}-${pad(b)}.${merge.ext}`);
    return { items, total: ranges.length };
  }, [merge.prefix, merge.start, merge.end, merge.group, merge.ext, merge.pad]);

  // ปลายทาง: ถ้า user เลือกเอง (merge.dstDir) ใช้ตามนั้น, ไม่งั้น default `<srcDir>_merged`
  const defaultDst = merge.srcDir ? `${merge.srcDir}_merged` : '';
  const effectiveDst = merge.dstDir || defaultDst;

  const onPickDst = async () => {
    const dir = await window.inktts.fs.chooseFolder({
      defaultPath: merge.dstDir || merge.srcDir || outputDir,
      title: 'เลือกโฟลเดอร์ปลายทาง (ไฟล์รวม)',
    });
    if (!dir) return;
    setMerge({ dstDir: dir });
  };
  const resetDst = () => setMerge({ dstDir: null });

  const onStart = async () => {
    if (!merge.srcDir) {
      setStatus({ kind: 'warn', message: 'เลือกโฟลเดอร์ต้นทางก่อน' });
      return;
    }
    resetLog();
    setMerge({ running: true });
    setStatus({ kind: 'run', message: 'กำลังรวมไฟล์เสียง...' });
    const result = await window.inktts.merge.start({
      srcDir: merge.srcDir,
      dstDir: effectiveDst || `${merge.srcDir}_merged`,
      // merge ไม่ดูชื่อไฟล์ต้นทาง — แค่นับไฟล์ + เรียงตามชื่อ (natural sort) แล้วแบ่งกลุ่ม
      // outPrefix = ช่องที่ผู้ใช้พิมพ์ ใช้ตั้งชื่อไฟล์ผลลัพธ์อย่างเดียว · start = เลขเริ่มของชื่อ
      outPrefix: merge.prefix,
      start: merge.start,
      end: merge.end,
      group: merge.group,
      ext: merge.ext,
      pad: merge.pad,
    });
    if (!result.ok) {
      setMerge({ running: false });
      setStatus({ kind: 'fail', message: result.error || 'รวมไฟล์ล้มเหลว' });
      reportError({ source: 'รวมไฟล์', message: 'เริ่มรวมไม่สำเร็จ', details: result.error });
    }
  };

  const onOpenOutput = () => {
    if (!effectiveDst) return;
    window.inktts.fs.revealFolder(effectiveDst);
  };

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
                ? `พบ ${merge.detected.count} ไฟล์ .${merge.ext} — เรียงตามชื่อไฟล์แล้วแบ่งกลุ่ม`
                : `ไม่พบไฟล์ .${merge.ext} ในโฟลเดอร์`}
            </div>
          )}

          <FieldRow label="คำนำหน้าไฟล์ผลลัพธ์">
            <Input
              type="text"
              className="w-full max-w-md"
              placeholder="ตั้งชื่อนำหน้าไฟล์ที่รวมแล้ว เช่น  ตอน   (เว้นวรรคก่อนเลข)"
              value={merge.prefix}
              onChange={(e) => setMerge({ prefix: e.target.value })}
            />
          </FieldRow>

          <FieldRow label="ตั้งแต่ตอน — ถึงตอน">
            <div className="flex items-center gap-2">
              <NumberField
                className="w-28"
                value={merge.start}
                min={1}
                onChange={(n) => setMerge({ start: n })}
              />
              <span className="text-[12px] text-vscode-fg-dim">ถึง</span>
              <NumberField
                className="w-28"
                value={merge.end}
                min={1}
                onChange={(n) => setMerge({ end: n })}
              />
            </div>
          </FieldRow>

          <FieldRow label="จัดกลุ่มละ (ตอน)">
            <NumberField
              className="w-28"
              value={merge.group}
              min={1}
              max={1000}
              onChange={(n) => setMerge({ group: n })}
            />
          </FieldRow>

          <FieldRow label="เติมศูนย์เลขตอน (หลัก)">
            <div className="flex items-center gap-2 w-full">
              <NumberField
                className="w-24"
                value={merge.pad}
                min={0}
                max={8}
                onChange={(n) => setMerge({ pad: n })}
              />
              <span className="text-[11px] text-vscode-fg-dim truncate">
                {merge.pad === 0 ? 'ไม่เติมศูนย์ (เช่น 1-100)' : `${merge.pad} หลัก`}
                {' · ค่าเริ่มต้น 4 หลัก · ใส่ 0 = ไม่เติม'}
                {merge.detected?.pad ? ` · ตรวจจากไฟล์ต้นทาง: ${merge.detected.pad} หลัก` : ''}
              </span>
            </div>
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

          <FieldRow label="โฟลเดอร์ปลายทาง (ไฟล์รวม)">
            <div className="flex items-center gap-2 w-full">
              <AppButton tone="zinc" variant="chrome" onClick={onPickDst}>
                <Codicon name="folder" size={13} />
                เลือก
              </AppButton>
              <span className="text-[11px] text-vscode-fg-dim truncate flex-1" title={effectiveDst}>
                {effectiveDst || '(เลือกโฟลเดอร์ต้นทางก่อน)'}
              </span>
              {merge.dstDir && (
                <AppButton tone="zinc" variant="icon" onClick={resetDst} title={`รีเซ็ตเป็นค่าเริ่มต้น (${defaultDst})`}>
                  <Codicon name="discard" size={14} />
                </AppButton>
              )}
            </div>
          </FieldRow>

          <div className="text-[12px] text-vscode-fg-dim flex items-center gap-2 pt-1">
            <Codicon name="output" size={14} />
            <span>ไฟล์รวมจะอยู่ที่:  {effectiveDst || '(เลือกโฟลเดอร์ต้นทางก่อน)'}{merge.dstDir ? ' · กำหนดเอง' : ' · ค่าเริ่มต้น'}</span>
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
