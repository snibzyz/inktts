import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/state/store';
import { Codicon } from '@/ui/Codicon';
import { cn } from '@/ui/cn';
import { buildErrorReport, copyToClipboard } from '@/lib/errorBus';

// แสดง toast ของ error ล่าสุดที่ยังไม่ dismiss — bottom-right
// หลายตัวพร้อมกัน: stack ขึ้นไป (เก่าอยู่บน, ใหม่ล่าง) แต่จำกัด 3 ใบ
// auto-dismiss 12 วินาที — user กดปิดหรือคัดลอกก่อนได้
// คลิก "ดูทั้งหมด" → เปิด Inbox modal

const AUTO_DISMISS_MS = 12000;

export function ErrorToast() {
  const errors = useStore((s) => s.errors);
  const dismissError = useStore((s) => s.dismissError);
  const setErrorInboxOpen = useStore((s) => s.setErrorInboxOpen);

  // visible = ยังไม่ dismiss + 3 ตัวล่าสุด
  const visible = useMemo(
    () => errors.filter((e) => !e.dismissed).slice(0, 3),
    [errors],
  );

  if (!visible.length) return null;

  return (
    <div className="fixed bottom-7 right-4 z-50 flex flex-col-reverse gap-2 max-w-[460px]">
      {visible.map((e, idx) => (
        <ToastCard
          key={e.id}
          entry={e}
          onDismiss={() => dismissError(e.id)}
          onOpenInbox={() => setErrorInboxOpen(true)}
          /** ปุ่มแรกเท่านั้นที่ auto-dismiss — กัน toast ใหม่ดัน toast เก่าหายก่อนอ่าน */
          autoDismiss={idx === 0}
        />
      ))}
    </div>
  );
}

function ToastCard({
  entry,
  onDismiss,
  onOpenInbox,
  autoDismiss,
}: {
  entry: ReturnType<typeof useStore.getState>['errors'][number];
  onDismiss: () => void;
  onOpenInbox: () => void;
  autoDismiss: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!autoDismiss || hover) return;
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [autoDismiss, hover, onDismiss]);

  const onCopy = async () => {
    const text = buildErrorReport(entry);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        'bg-vscode-surface border border-vscode-error/40 rounded-sm shadow-lg',
        'pl-3 pr-2 py-2.5 flex items-start gap-2.5 animate-in slide-in-from-right-4',
      )}
    >
      <Codicon name="error" size={16} className="text-vscode-error mt-0.5 flex-none" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[11px] text-vscode-muted mb-0.5">
          <span className="font-medium text-vscode-fg-dim">{entry.source}</span>
          <span>·</span>
          <span>{new Date(entry.ts).toLocaleTimeString()}</span>
        </div>
        <div className="text-[12px] text-vscode-fg break-words leading-snug">
          {entry.message}
        </div>
        {entry.details && (
          <details className="mt-1.5 group">
            <summary className="text-[10px] text-vscode-fg-dim hover:text-vscode-fg cursor-pointer select-none list-none flex items-center gap-1">
              <Codicon name="chevron-right" size={10} className="group-open:rotate-90 transition-transform" />
              ดูรายละเอียด
            </summary>
            <pre className="mt-1.5 max-h-32 overflow-auto bg-vscode-editor border border-vscode-border/50 rounded-sm p-1.5 text-[10px] text-vscode-fg-dim font-mono whitespace-pre-wrap break-all leading-relaxed">
              {entry.details}
            </pre>
          </details>
        )}
        <div className="flex items-center gap-1 mt-1.5">
          <button
            type="button"
            onClick={onCopy}
            className={cn(
              'inline-flex items-center gap-1 h-6 px-2 rounded-sm text-[10px] font-medium border',
              copied
                ? 'border-vscode-success/40 text-vscode-success bg-vscode-success/10'
                : 'border-vscode-border text-vscode-fg-dim hover:text-vscode-fg-bright hover:bg-vscode-list-hover',
            )}
          >
            <Codicon name={copied ? 'check' : 'copy'} size={10} />
            {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
          </button>
          <button
            type="button"
            onClick={onOpenInbox}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-sm text-[10px] font-medium border border-vscode-border text-vscode-fg-dim hover:text-vscode-fg-bright hover:bg-vscode-list-hover"
          >
            <Codicon name="inbox" size={10} />
            ดูทั้งหมด
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        title="ปิด"
        className="flex-none w-6 h-6 flex items-center justify-center rounded-sm text-vscode-fg-dim hover:text-vscode-fg-bright hover:bg-vscode-list-hover"
      >
        <Codicon name="close" size={12} />
      </button>
    </div>
  );
}
