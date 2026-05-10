import { useEffect, useState } from 'react';
import type { FileRowState } from '@/state/store';
import { Codicon } from '@/ui/Codicon';
import { cn } from '@/ui/cn';

const STATUS_INFO: Record<string, { icon: string; color: string; spin?: boolean; text?: string }> = {
  WORK: { icon: 'sync', color: 'text-vscode-fg-dim', spin: true },
  DONE: { icon: 'pass-filled', color: 'text-vscode-success', text: 'เสร็จ' },
  FAIL: { icon: 'error', color: 'text-vscode-error', text: 'ล้มเหลว' },
  FFMPEG_FAIL: { icon: 'error', color: 'text-vscode-error', text: 'รวมเสียงพลาด' },
  SKIP: { icon: 'circle-slash', color: 'text-vscode-muted', text: 'ข้าม' },
  EMPTY: { icon: 'blank', color: 'text-vscode-muted', text: 'ว่าง' },
  PENDING: { icon: 'watch', color: 'text-vscode-muted', text: 'รอคิว' },
};

export function FileRow({ row }: { row: FileRowState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (['DONE', 'FAIL', 'FFMPEG_FAIL', 'SKIP', 'EMPTY', 'PENDING'].includes(row.status)) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [row.status]);

  // startTime is null until runner emits 'start' for this file (slot acquired).
  // While pending, show "—" instead of climbing seconds.
  const elapsed = row.startTime != null ? ((row.endTime ?? now) - row.startTime) / 1000 : null;
  const frac = row.total > 0 ? Math.min(1, row.done / row.total) : 0;
  const statusInfo = STATUS_INFO[row.status] || STATUS_INFO.PENDING;

  let pctText = statusInfo.text || `${Math.round(frac * 100)}%`;
  if (row.status === 'WORK') pctText = `${Math.round(frac * 100)}%`;

  let barColor = 'bg-vscode-accent';
  if (row.status === 'DONE') barColor = 'bg-vscode-success';
  else if (row.status === 'FAIL' || row.status === 'FFMPEG_FAIL') barColor = 'bg-vscode-error';
  else if (row.status === 'PENDING') barColor = 'bg-vscode-muted/30';

  const name = row.base.length > 36 ? row.base.slice(0, 33) + '…' : row.base;
  const elapsedText = elapsed == null ? '—' : `${elapsed.toFixed(1)}s`;

  return (
    <div className={cn(
      'bg-vscode-surface border rounded-sm px-3 py-2 transition-colors',
      row.status === 'PENDING' ? 'border-vscode-border/50 opacity-70' :
      row.status === 'FAIL' || row.status === 'FFMPEG_FAIL' ? 'border-vscode-error/40' :
      row.status === 'DONE' ? 'border-vscode-success/30' :
      'border-vscode-border',
    )}>
      <div className="flex items-center gap-2">
        <Codicon name={statusInfo.icon} size={14} className={cn('flex-none', statusInfo.color)} spin={statusInfo.spin} />
        <div className="text-[12px] font-medium text-vscode-fg truncate flex-1" title={row.base}>{name}</div>
        <div className={cn('text-[11px] flex-none font-medium tabular-nums', statusInfo.color)}>{pctText}</div>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-vscode-track rounded-sm overflow-hidden">
          <div className={cn('h-full transition-[width] duration-200', barColor)} style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="text-[10px] text-vscode-muted tabular-nums w-14 text-right">{row.done}/{row.total}</div>
        <div className="text-[10px] text-vscode-muted tabular-nums w-12 text-right">{elapsedText}</div>
      </div>
    </div>
  );
}
