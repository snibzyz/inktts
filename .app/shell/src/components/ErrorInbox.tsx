import { useEffect, useState } from 'react';
import { useStore } from '@/state/store';
import { Codicon } from '@/ui/Codicon';
import { AppButton } from '@/ui/AppButton';
import { cn } from '@/ui/cn';
import { buildErrorReport, buildAllErrorsReport, copyToClipboard } from '@/lib/errorBus';

// Modal ที่โชว์ทุก error ใน session — list + copy แต่ละตัว + copy รวม
// เปิดผ่าน setErrorInboxOpen(true) จาก: Sidebar badge, ErrorToast "ดูทั้งหมด"
// ปิด: backdrop click หรือ ESC

export function ErrorInbox() {
  const open = useStore((s) => s.errorInboxOpen);
  const setOpen = useStore((s) => s.setErrorInboxOpen);
  const errors = useStore((s) => s.errors);
  const clearErrors = useStore((s) => s.clearErrors);
  const [copyAllState, setCopyAllState] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const copyOne = async (id: string) => {
    const e = errors.find((x) => x.id === id);
    if (!e) return;
    const ok = await copyToClipboard(buildErrorReport(e));
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  const copyAll = async () => {
    setCopyAllState('busy');
    try {
      const text = await buildAllErrorsReport();
      const ok = await copyToClipboard(text);
      setCopyAllState(ok ? 'ok' : 'fail');
      setTimeout(() => setCopyAllState('idle'), 2000);
    } catch {
      setCopyAllState('fail');
      setTimeout(() => setCopyAllState('idle'), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-6"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-vscode-surface border border-vscode-border rounded-sm shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-vscode-border flex items-center gap-3 flex-none">
          <Codicon name="inbox" size={18} className="text-vscode-error" />
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-vscode-fg-bright">รายการ Error ใน session นี้</div>
            <div className="text-[11px] text-vscode-fg-dim mt-0.5">
              ทั้งหมด {errors.length} รายการ · คัดลอกเพื่อส่งให้ผู้ดูแลระบบ
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-sm text-vscode-fg-dim hover:text-vscode-fg-bright hover:bg-vscode-list-hover"
          >
            <Codicon name="close" size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-5 py-3">
          {errors.length === 0 ? (
            <div className="text-[13px] text-vscode-muted text-center py-12 flex flex-col items-center gap-3">
              <Codicon name="pass-filled" size={32} className="text-vscode-success" />
              <div>ยังไม่มี error ใน session นี้</div>
            </div>
          ) : (
            <div className="space-y-2">
              {errors.map((e) => (
                <div
                  key={e.id}
                  className="bg-vscode-editor border border-vscode-border rounded-sm p-3 space-y-1.5"
                >
                  <div className="flex items-baseline gap-2 text-[11px] text-vscode-muted">
                    <span className="font-medium text-vscode-error">{e.source}</span>
                    <span>·</span>
                    <span>{new Date(e.ts).toLocaleString()}</span>
                  </div>
                  <div className="text-[13px] text-vscode-fg break-words leading-snug">
                    {e.message}
                  </div>
                  {e.details && (
                    <details className="group">
                      <summary className="text-[11px] text-vscode-fg-dim hover:text-vscode-fg cursor-pointer select-none list-none flex items-center gap-1">
                        <Codicon name="chevron-right" size={11} className="group-open:rotate-90 transition-transform" />
                        รายละเอียด
                      </summary>
                      <pre className="mt-1.5 max-h-48 overflow-auto bg-vscode-editor border border-vscode-border/50 rounded-sm p-2 text-[11px] text-vscode-fg-dim font-mono whitespace-pre-wrap break-all leading-relaxed">
                        {e.details}
                      </pre>
                    </details>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => copyOne(e.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-sm text-[11px] font-medium border',
                        copiedId === e.id
                          ? 'border-vscode-success/40 text-vscode-success bg-vscode-success/10'
                          : 'border-vscode-border text-vscode-fg-dim hover:text-vscode-fg-bright hover:bg-vscode-list-hover',
                      )}
                    >
                      <Codicon name={copiedId === e.id ? 'check' : 'copy'} size={11} />
                      {copiedId === e.id ? 'คัดลอกแล้ว' : 'คัดลอก'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-vscode-border flex items-center gap-2 flex-none">
          <AppButton
            tone="primary"
            variant="flat"
            disabled={!errors.length || copyAllState === 'busy'}
            onClick={copyAll}
          >
            <Codicon
              name={copyAllState === 'ok' ? 'check' : copyAllState === 'busy' ? 'sync' : 'copy'}
              size={14}
              spin={copyAllState === 'busy'}
            />
            {copyAllState === 'ok' ? 'คัดลอกแล้ว — paste ส่งได้เลย'
              : copyAllState === 'fail' ? 'คัดลอกไม่สำเร็จ'
              : 'คัดลอกทั้งหมด + ข้อมูลระบบ'}
          </AppButton>
          <div className="flex-1" />
          {errors.length > 0 && (
            <AppButton tone="zinc" variant="flat" onClick={clearErrors}>
              <Codicon name="trash" size={14} />
              ล้างรายการ
            </AppButton>
          )}
          <AppButton tone="zinc" variant="flat" onClick={() => setOpen(false)}>
            ปิด
          </AppButton>
        </footer>
      </div>
    </div>
  );
}
