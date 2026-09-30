import { cn } from '@/ui/cn';

/** ป้าย "ใหม่" เล็ก ๆ — ใช้ข้างชื่อบริการที่เพิ่งเพิ่ม (sidebar + หัวหน้าบริการ) */
export function NewBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center h-4 px-1.5 rounded-full text-[10px] font-bold leading-none',
        'bg-vscode-success/15 text-vscode-success border border-vscode-success/40',
        className,
      )}
    >
      ใหม่
    </span>
  );
}
