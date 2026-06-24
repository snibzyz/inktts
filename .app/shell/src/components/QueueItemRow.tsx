import { useEffect, useState } from 'react';
import type { QueueItem } from '@/types/inktts';
import { useQueueStore } from '@/state/queueStore';
import { Codicon } from '@/ui/Codicon';
import { cn } from '@/ui/cn';
import { formatClock, formatDuration, formatEta, estimateRemaining } from '@/lib/formatTime';

const SERVICE_LABEL: Record<string, string> = { edge: 'Edge', google: 'Google', rv: 'ResponsiveVoice' };

const STATUS: Record<string, { icon: string; color: string; label: string; spin?: boolean; barColor: string }> = {
  idle: { icon: 'circle-large-outline', color: 'text-vscode-muted', label: 'พร้อม', barColor: 'bg-vscode-muted/30' },
  queued: { icon: 'watch', color: 'text-vscode-focus', label: 'รอคิว', barColor: 'bg-vscode-muted/40' },
  running: { icon: 'sync', color: 'text-vscode-focus', label: 'กำลังแปลง', spin: true, barColor: 'bg-vscode-accent' },
  done: { icon: 'pass-filled', color: 'text-vscode-success', label: 'เสร็จแล้ว', barColor: 'bg-vscode-success' },
  'done-with-errors': { icon: 'warning', color: 'text-vscode-warning', label: 'เสร็จ (มีบางตอนพลาด)', barColor: 'bg-vscode-warning' },
  failed: { icon: 'error', color: 'text-vscode-error', label: 'ล้มเหลว', barColor: 'bg-vscode-error' },
  cancelled: { icon: 'circle-slash', color: 'text-vscode-muted', label: 'ยกเลิกแล้ว', barColor: 'bg-vscode-muted/40' },
};

export function QueueItemRow({ item, index, count, onEdit }: {
  item: QueueItem;
  index: number;
  count: number;
  onEdit: (item: QueueItem) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const expandedId = useQueueStore((s) => s.expandedId);
  const setExpanded = useQueueStore((s) => s.setExpanded);
  const logs = useQueueStore((s) => s.logsByItem[item.id]);
  const expanded = expandedId === item.id;

  // เดินนาฬิกาสดเฉพาะตอนกำลังรัน
  useEffect(() => {
    if (item.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [item.status]);

  const st = STATUS[item.status] || STATUS.idle;
  const p = item.progress || { done: 0, fail: 0, total: 0, current: null };
  const frac = p.total > 0 ? Math.min(1, (p.done + p.fail) / p.total) : 0;

  const elapsedMs = item.startedAt != null ? (item.endedAt ?? now) - item.startedAt : null;
  const etaMs = item.status === 'running' && elapsedMs != null
    ? estimateRemaining(elapsedMs, p.done + p.fail, p.total)
    : null;

  const running = item.status === 'running' || item.status === 'queued';
  const q = window.inktts.queue;

  return (
    <div className={cn(
      'bg-vscode-surface border rounded-sm transition-colors',
      item.status === 'running' ? 'border-vscode-accent/40' :
      item.status === 'failed' ? 'border-vscode-error/40' :
      item.status === 'done-with-errors' ? 'border-vscode-warning/40' :
      item.status === 'done' ? 'border-vscode-success/30' :
      'border-vscode-border',
    )}>
      <div className="px-3 py-2.5">
        {/* แถวบน: ชื่อ + บริการ + สถานะ + นาฬิกา */}
        <div className="flex items-center gap-2">
          <Codicon name={st.icon} size={15} className={cn('flex-none', st.color)} spin={st.spin} />
          <div className="text-[13px] font-semibold text-vscode-fg-bright truncate flex-1" title={item.name}>{item.name}</div>
          <span className="flex-none text-[10px] px-1.5 py-0.5 rounded-sm bg-vscode-list-active text-vscode-fg-dim">{SERVICE_LABEL[item.service] || item.service}</span>
          {item.throttled && (
            <span className="flex-none inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-vscode-warning/15 text-vscode-warning" title="โดนจำกัดเรท — ระบบลดความเร็วให้อัตโนมัติ">
              <Codicon name="warning" size={11} /> จำกัดเรท
            </span>
          )}
          <span className={cn('flex-none text-[11px] font-medium', st.color)}>{st.label}</span>
        </div>

        {/* progress bar + ตัวเลข + เวลา */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-2 bg-vscode-track rounded-sm overflow-hidden">
            <div className={cn('h-full transition-[width] duration-300', st.barColor)} style={{ width: `${frac * 100}%` }} />
          </div>
          <div className="text-[11px] text-vscode-fg-dim tabular-nums flex-none">
            {p.done}/{p.total}{p.fail > 0 && <span className="text-vscode-error"> · พลาด {p.fail}</span>}
          </div>
        </div>

        {/* แถวเวลา: ใช้ไป (HH:MM:SS) + คาดเหลือ */}
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-vscode-fg-dim flex-wrap">
          <span className="inline-flex items-center gap-1" title="เวลาที่ใช้ไปทั้งหมด (ตั้งแต่เริ่มตอนแรก)">
            <Codicon name="clock" size={12} className="text-vscode-muted" />
            ใช้ไป <span className="font-mono tabular-nums text-vscode-fg">{formatClock(elapsedMs)}</span>
            {elapsedMs != null && <span className="text-vscode-muted">({formatDuration(elapsedMs)})</span>}
          </span>
          {etaMs != null && (
            <span className="inline-flex items-center gap-1" title="เวลาที่คาดว่าเหลือ">
              <Codicon name="watch" size={12} className="text-vscode-muted" />
              เหลืออีก <span className="text-vscode-fg">{formatEta(etaMs)}</span>
            </span>
          )}
          {item.status === 'running' && p.current && (
            <span className="truncate text-vscode-muted" title={p.current}>· กำลังทำ: {p.current}</span>
          )}
        </div>

        {/* paths */}
        <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10.5px] text-vscode-muted">
          <span className="text-vscode-fg-dim">ต้นทาง</span><span className="truncate font-mono" title={item.inputDir}>{item.inputDir || '—'}</span>
          <span className="text-vscode-fg-dim">ปลายทาง</span><span className="truncate font-mono" title={item.outputDir}>{item.outputDir || '—'}</span>
        </div>

        {item.error && (
          <div className="mt-1.5 text-[11px] text-vscode-error break-words">{item.error}</div>
        )}

        {/* ปุ่ม */}
        <div className="mt-2 flex items-center gap-1">
          {running ? (
            <RowBtn icon="debug-stop" label="หยุด" tone="danger" onClick={() => q.cancel(item.id)} />
          ) : (
            <RowBtn icon="play" label="เริ่ม" tone="primary" onClick={() => q.start(item.id)} disabled={!item.inputDir || !item.outputDir} />
          )}
          <RowBtn icon="edit" label="แก้ไข" onClick={() => onEdit(item)} disabled={running} />
          <RowBtn icon="folder-opened" label="โฟลเดอร์" onClick={() => item.outputDir && window.inktts.fs.revealFolder(item.outputDir)} />
          <RowBtn
            icon={expanded ? 'chevron-up' : 'list-flat'}
            label={expanded ? 'ซ่อนเวลา/บันทึก' : 'เวลาแต่ละตอน/บันทึก'}
            onClick={() => setExpanded(item.id)}
          />
          <div className="flex-1" />
          <RowBtn icon="chevron-up" label="เลื่อนขึ้น" onClick={() => q.move(item.id, index - 1)} disabled={index === 0} />
          <RowBtn icon="chevron-down" label="เลื่อนลง" onClick={() => q.move(item.id, index + 1)} disabled={index >= count - 1} />
          <RowBtn icon="trash" label="ลบ" tone="danger" onClick={() => q.remove(item.id)} disabled={running} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-vscode-border/60 px-3 py-2 space-y-2 bg-vscode-editor/40">
          {/* เวลาแต่ละตอน */}
          <div>
            <div className="text-[11px] font-semibold text-vscode-fg-dim mb-1">เวลาแต่ละตอน (ไฟล์)</div>
            {item.times && item.times.length > 0 ? (
              <div className="max-h-40 overflow-auto grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[11px]">
                {item.times.map((t) => (
                  <FragmentRow key={t.base} base={t.base} sec={t.sec} />
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-vscode-muted">(ยังไม่มีข้อมูลเวลา)</div>
            )}
          </div>
          {/* log */}
          {logs && logs.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-vscode-fg-dim mb-1">บันทึก</div>
              <div className="max-h-40 overflow-auto bg-vscode-editor border border-vscode-border/50 rounded-sm px-2 py-1.5 font-mono text-[10.5px] leading-relaxed">
                {logs.slice(-100).map((l, i) => (
                  <div key={i} className={cn(
                    l.level === 'error' ? 'text-vscode-error' :
                    l.level === 'warn' ? 'text-vscode-warning' :
                    'text-vscode-fg-dim',
                  )}>
                    {new Date(l.ts).toLocaleTimeString()} · {l.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FragmentRow({ base, sec }: { base: string; sec: number }) {
  return (
    <>
      <span className="truncate text-vscode-fg" title={base}>{base}</span>
      <span className="tabular-nums text-vscode-fg-dim font-mono text-right">{formatClock(sec * 1000)} · {formatDuration(sec * 1000)}</span>
    </>
  );
}

function RowBtn({ icon, label, onClick, tone, disabled }: {
  icon: string; label: string; onClick: () => void; tone?: 'primary' | 'danger'; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        'inline-flex items-center gap-1 h-7 px-2 rounded-sm text-[11px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        tone === 'primary' ? 'border-vscode-focus/50 text-vscode-info hover:bg-vscode-focus/15' :
        tone === 'danger' ? 'border-vscode-border text-vscode-fg-dim hover:text-vscode-error hover:border-vscode-error/40 hover:bg-vscode-error/10' :
        'border-vscode-border text-vscode-fg-dim hover:text-vscode-fg hover:bg-vscode-list-hover',
      )}
    >
      <Codicon name={icon} size={12} />
      <span>{label}</span>
    </button>
  );
}
