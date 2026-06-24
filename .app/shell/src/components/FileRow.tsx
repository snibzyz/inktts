import { useEffect, useState } from 'react';
import type { FileRowState } from '@/state/store';
import { Codicon } from '@/ui/Codicon';
import { cn } from '@/ui/cn';
import { formatClock, formatDuration } from '@/lib/formatTime';

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
  const [errorOpen, setErrorOpen] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'short' | 'admin'>('idle');
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
  const elapsedMs = elapsed == null ? null : elapsed * 1000;
  const elapsedText = formatClock(elapsedMs);
  const hasError = (row.status === 'FAIL' || row.status === 'FFMPEG_FAIL') && !!row.error;
  const d = row.details;

  const copyShort = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = `${row.base} — ${row.status}: ${row.error || '(ไม่มีข้อความ)'}`;
    try {
      await window.inktts.app.copyToClipboard(text);
      setCopied('short');
      setTimeout(() => setCopied('idle'), 1500);
    } catch { /* noop */ }
  };

  // คัดลอกบันทึก "เต็ม" ที่ส่งให้แอดมิน reproduce ได้ —
  // version/platform + ทุก field ของ details (ffmpeg path/argv/stderr/listPreview/exit code)
  const copyAdminReport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const lines: string[] = [
      `INKTTS — file error report (${new Date().toISOString()})`,
      `version:  ${window.inktts?.app?.version || '?'}`,
      `platform: ${window.inktts?.platform || '?'}`,
      ``,
      `file:     ${row.base}`,
      `status:   ${row.status}`,
      `progress: ${row.done}/${row.total}`,
      `message:  ${row.error || '(ไม่มีข้อความ)'}`,
    ];
    if (d) {
      lines.push('');
      lines.push('-- ffmpeg diagnostic --');
      if (d.reason) lines.push(`reason:    ${d.reason}`);
      if (d.ffmpegPath != null) lines.push(`ffmpeg:    ${d.ffmpegPath} (${d.ffmpegSize ?? '?'} bytes)`);
      if (d.exitCode != null || d.spawnError) {
        lines.push(`exit:      ${d.exitCode ?? '?'}${d.spawnError ? ` spawnErr=${d.spawnError}` : ''} in ${d.durationMs ?? '?'}ms`);
      }
      if (Array.isArray(d.argv)) lines.push(`argv:      ${d.argv.join(' ')}`);
      if (Array.isArray(d.listPreview)) {
        lines.push('list.txt preview:');
        for (const l of d.listPreview) lines.push(`  ${l}`);
      }
      if (typeof d.validChunks === 'number') lines.push(`validChunks: ${d.validChunks}`);
      if (Array.isArray(d.rejectedSample) && d.rejectedSample.length) {
        lines.push('rejected sample:');
        for (const r of d.rejectedSample) lines.push(`  - ${r.path}: ${r.reason}`);
      }
      if (typeof d.stderr === 'string' && d.stderr) {
        lines.push('stderr:');
        lines.push(d.stderr);
      }
      if (d.diagnostic) {
        lines.push('path resolution:');
        try { lines.push(JSON.stringify(d.diagnostic, null, 2)); } catch { /* noop */ }
      }
    }
    const text = lines.join('\n');
    try {
      await window.inktts.app.copyToClipboard(text);
      setCopied('admin');
      setTimeout(() => setCopied('idle'), 1800);
    } catch { /* noop */ }
  };

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
        {hasError && (
          <button
            type="button"
            onClick={() => setErrorOpen((o) => !o)}
            title={errorOpen ? 'ซ่อนรายละเอียด' : 'ดูสาเหตุที่ล้มเหลว'}
            className="flex-none w-5 h-5 flex items-center justify-center rounded-sm text-vscode-error hover:bg-vscode-list-hover"
          >
            <Codicon name={errorOpen ? 'chevron-up' : 'info'} size={12} />
          </button>
        )}
        <div className={cn('text-[11px] flex-none font-medium tabular-nums', statusInfo.color)}>{pctText}</div>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-vscode-track rounded-sm overflow-hidden">
          <div className={cn('h-full transition-[width] duration-200', barColor)} style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="text-[10px] text-vscode-muted tabular-nums w-14 text-right">{row.done}/{row.total}</div>
        <div
          className="text-[10px] text-vscode-muted tabular-nums w-[64px] text-right font-mono"
          title={elapsedMs == null ? undefined : `ใช้เวลา ${formatDuration(elapsedMs)}`}
        >{elapsedText}</div>
      </div>
      {hasError && errorOpen && (
        <div className="mt-2 bg-vscode-editor border border-vscode-error/30 rounded-sm p-2 space-y-2">
          <div className="text-[11px] text-vscode-error font-mono break-all whitespace-pre-wrap leading-relaxed">
            {row.error}
          </div>
          {d && (
            <details className="group">
              <summary className="text-[10px] text-vscode-fg-dim hover:text-vscode-fg cursor-pointer select-none list-none flex items-center gap-1">
                <Codicon name="chevron-right" size={10} className="group-open:rotate-90 transition-transform" />
                รายละเอียดเทคนิค (สำหรับแอดมิน)
              </summary>
              <div className="mt-1.5 bg-vscode-editor border border-vscode-border/50 rounded-sm p-2 text-[10.5px] text-vscode-fg-dim font-mono leading-relaxed space-y-0.5">
                {d.reason && <div><span className="text-vscode-muted">reason:</span> {d.reason}</div>}
                {d.ffmpegPath != null && <div className="break-all"><span className="text-vscode-muted">ffmpeg:</span> {d.ffmpegPath} <span className="text-vscode-muted">({d.ffmpegSize ?? '?'} bytes)</span></div>}
                {(d.exitCode != null || d.spawnError) && (
                  <div><span className="text-vscode-muted">exit:</span> {d.exitCode ?? '?'}{d.spawnError ? ` spawnErr=${d.spawnError}` : ''} in {d.durationMs ?? '?'}ms</div>
                )}
                {Array.isArray(d.argv) && (
                  <div className="break-all"><span className="text-vscode-muted">argv:</span> {d.argv.join(' ')}</div>
                )}
                {typeof d.validChunks === 'number' && (
                  <div><span className="text-vscode-muted">valid chunks:</span> {d.validChunks}</div>
                )}
                {Array.isArray(d.listPreview) && d.listPreview.length > 0 && (
                  <div>
                    <span className="text-vscode-muted">list.txt:</span>
                    <pre className="mt-0.5 pl-2 whitespace-pre-wrap break-all max-h-24 overflow-auto">{d.listPreview.join('\n')}</pre>
                  </div>
                )}
                {typeof d.stderr === 'string' && d.stderr && (
                  <div>
                    <span className="text-vscode-muted">stderr:</span>
                    <pre className="mt-0.5 pl-2 whitespace-pre-wrap break-all max-h-32 overflow-auto">{d.stderr.slice(-1200)}</pre>
                  </div>
                )}
              </div>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-vscode-border/30">
            <button
              type="button"
              onClick={copyAdminReport}
              title="คัดลอกบันทึกเต็ม (path / argv / stderr / system info) — ส่งให้แอดมินวิเคราะห์ได้เลย"
              className={cn(
                'inline-flex items-center gap-1.5 h-6 px-2 rounded-sm text-[10.5px] font-medium border',
                copied === 'admin'
                  ? 'border-vscode-success/40 text-vscode-success bg-vscode-success/10'
                  : 'border-vscode-error/40 text-vscode-error bg-vscode-error/10 hover:bg-vscode-error/15',
              )}
            >
              <Codicon name={copied === 'admin' ? 'check' : 'copy'} size={10} />
              {copied === 'admin' ? 'คัดลอกแล้ว' : 'คัดลอกบันทึกให้แอดมิน'}
            </button>
            <button
              type="button"
              onClick={copyShort}
              title="คัดลอกแค่ข้อความสั้น ๆ (ไม่รวม diagnostic)"
              className={cn(
                'inline-flex items-center gap-1.5 h-6 px-2 rounded-sm text-[10.5px] font-medium border',
                copied === 'short'
                  ? 'border-vscode-success/40 text-vscode-success bg-vscode-success/10'
                  : 'border-vscode-border text-vscode-fg-dim hover:text-vscode-fg-bright hover:bg-vscode-list-hover',
              )}
            >
              <Codicon name={copied === 'short' ? 'check' : 'copy'} size={10} />
              {copied === 'short' ? 'คัดลอกแล้ว' : 'คัดลอกสั้น'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
