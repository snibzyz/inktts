import { useState } from 'react';
import { useStore } from '@/state/store';
import { cn } from '@/ui/cn';

export function UpdateBanner() {
  const update = useStore((s) => s.update);
  const setUpdate = useStore((s) => s.setUpdate);
  const [hidden, setHidden] = useState(false);

  if (hidden || !update.available) return null;

  const isError = !!update.error;
  const mode = update.mode || 'portable';
  const isReady = !!update.ready;
  const isDownloading = !!update.downloading && !isReady;
  const percent = Math.max(2, Math.min(100, update.progress ?? 0));

  const onApply = async () => {
    const r = await window.inktts.app.applyUpdate();
    if (!r.ok) setUpdate({ ready: false, error: r.error || 'อัพเดตล้มเหลว' });
  };
  const onOpenRelease = () => {
    if (update.releaseUrl) window.inktts.fs.openExternal(update.releaseUrl);
  };
  const onOpenDownload = () => {
    if (update.downloadUrl) window.inktts.fs.openExternal(update.downloadUrl);
  };

  const iconClass = isError
    ? 'codicon-error'
    : isReady
      ? 'codicon-pass-filled'
      : isDownloading
        ? 'codicon-cloud-download codicon-modifier-spin'
        : 'codicon-arrow-circle-up';

  const headline = isError
    ? 'อัพเดตไม่สำเร็จ'
    : isReady
      ? (mode === 'portable' ? 'อัพเดตพร้อมใช้งาน — กดรีสตาร์ท' : 'อัพเดตพร้อมแล้ว')
      : isDownloading
        ? 'กำลังดาวน์โหลดเวอร์ชันใหม่'
        : (mode === 'manual' ? 'มีเวอร์ชันใหม่' : 'พบเวอร์ชันใหม่');

  const subline = isError
    ? update.error
    : isReady
      ? 'ไฟล์พร้อมแล้ว — รีสตาร์ทเพื่อใช้เวอร์ชันใหม่ (หรือปิดแอพแล้วเปิดใหม่)'
      : isDownloading
        ? `${percent}%`
        : (mode === 'manual'
          ? 'กดดาวน์โหลดเองเพื่อโหลดตัวติดตั้งจาก GitHub Releases'
          : 'ระบบกำลังดาวน์โหลดเงียบ ๆ ในพื้นหลัง');

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Bangkok',
      });
    } catch {
      return iso;
    }
  };

  const canApply = mode === 'portable' && isReady;
  const canManualDownload = mode === 'manual' && !!update.downloadUrl;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'relative isolate flex items-center gap-3.5 px-4 py-2.5 border-b text-[13px] flex-none',
        'transition-colors duration-200',
        isError
          ? 'bg-vscode-error-bg/60 text-vscode-fg-bright border-vscode-error/40'
          : 'bg-gradient-to-r from-vscode-accent/15 via-vscode-accent/10 to-vscode-accent/5 text-vscode-fg-bright border-vscode-accent/25',
      )}
    >
      {!isError ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-vscode-accent/60 to-transparent"
        />
      ) : null}

      <span
        className={cn(
          'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1',
          isError
            ? 'bg-vscode-error/20 ring-vscode-error/40 text-vscode-error'
            : isReady
              ? 'bg-vscode-success/15 ring-vscode-success/30 text-vscode-success'
              : 'bg-vscode-accent/25 ring-vscode-accent/40 text-vscode-fg-bright',
        )}
      >
        <i className={cn('codicon text-[14px]', iconClass)} />
      </span>

      <div className="flex flex-1 min-w-0 items-center gap-2.5">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold truncate">{headline}</span>
            {update.version ? (
              <span className="inline-flex items-center rounded-sm px-1.5 py-px font-mono text-[11px] font-medium bg-vscode-accent/25 text-vscode-fg-bright ring-1 ring-vscode-accent/40 shrink-0">
                v{update.version}
              </span>
            ) : null}
            {update.releaseDate ? (
              <span className="text-[11px] text-vscode-fg-dim shrink-0">
                · ออก {formatDate(update.releaseDate)}
              </span>
            ) : null}
            {update.current ? (
              <span className="text-[11px] text-vscode-fg-dim shrink-0">
                · ปัจจุบัน v{update.current}
              </span>
            ) : null}
          </div>
          {subline && !isDownloading ? (
            <span className={cn('text-[11.5px] mt-0.5 truncate', isError ? 'text-vscode-error/90' : 'text-vscode-fg-dim')}>
              {subline}
            </span>
          ) : null}
        </div>

        {isDownloading ? (
          <div className="flex items-center gap-2 ml-auto min-w-0">
            <div className="relative h-1.5 w-40 overflow-hidden rounded-full bg-vscode-border/60 ring-1 ring-vscode-border/40">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-vscode-accent to-vscode-accent-hover transition-[width] duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
              <div
                aria-hidden
                className="absolute inset-y-0 -inset-x-1 animate-progress-slide bg-gradient-to-r from-transparent via-white/15 to-transparent"
              />
            </div>
            <span className="font-mono text-[11px] tabular-nums text-vscode-fg-dim shrink-0 w-10 text-right">
              {percent.toFixed(0)}%
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {update.releaseUrl ? (
          <button
            type="button"
            onClick={onOpenRelease}
            className="inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-[12px] font-medium text-vscode-fg hover:text-vscode-fg-bright hover:bg-vscode-list-hover transition-colors"
          >
            <i className="codicon codicon-link-external text-[12px]" />
            รายละเอียด
          </button>
        ) : null}
        {canManualDownload ? (
          <button
            type="button"
            onClick={onOpenDownload}
            className="inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-[12px] font-medium text-vscode-fg hover:text-vscode-fg-bright hover:bg-vscode-list-hover transition-colors"
          >
            <i className="codicon codicon-cloud-download text-[12px]" />
            ดาวน์โหลดเอง
          </button>
        ) : null}
        {canApply ? (
          <button
            type="button"
            onClick={onApply}
            className={cn(
              'group inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-[12px] font-semibold',
              'bg-vscode-accent text-white hover:bg-vscode-accent-hover',
              'shadow-sm shadow-vscode-accent/30 transition-all',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-vscode-focus',
            )}
          >
            <i className="codicon codicon-debug-restart text-[12px] transition-transform group-hover:-translate-y-px" />
            รีสตาร์ทเดี๋ยวนี้
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setHidden(true)}
          title="ซ่อน"
          aria-label="ซ่อน"
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-vscode-fg-dim hover:text-vscode-fg-bright hover:bg-vscode-list-hover transition-colors"
        >
          <i className="codicon codicon-close text-[13px]" />
        </button>
      </div>
    </div>
  );
}
