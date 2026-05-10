import { useStore, type ViewKey } from '@/state/store';
import { SERVICES } from '@/lib/services';
import { Codicon } from '@/ui/Codicon';
import { cn } from '@/ui/cn';

const ICONS: Record<string, string> = {
  edge: 'star-full',
  google: 'globe',
  rv: 'mic',
  merge: 'combine',
};

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  return (
    <aside className="w-[220px] flex-none flex flex-col bg-vscode-sidebar border-r border-vscode-border">
      <div className="px-4 pt-5 pb-3">
        <div className="text-[17px] font-bold text-vscode-fg-bright tracking-wide">INKTTS</div>
        <div className="text-[11px] text-vscode-muted mt-1">แปลงข้อความเป็นเสียง</div>
      </div>
      <div className="mx-2.5 my-1 border-t border-vscode-border" />

      <SectionLabel>เลือกบริการ TTS</SectionLabel>
      {SERVICES.map((s) => (
        <NavItem
          key={s.key}
          active={view === s.key}
          icon={ICONS[s.key]}
          label={s.name}
          onClick={() => setView(s.key as ViewKey)}
        />
      ))}

      <SectionLabel className="mt-3">เครื่องมือ</SectionLabel>
      <NavItem
        active={view === 'merge'}
        icon={ICONS.merge}
        label="รวมไฟล์เสียง"
        onClick={() => setView('merge')}
      />

      <div className="flex-1" />
      <NavItem
        active={view === 'settings'}
        icon="gear"
        label="ตั้งค่า"
        onClick={() => setView('settings')}
      />
      <div className="h-2" />
    </aside>
  );
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('px-4 pt-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-vscode-muted', className)}>
      {children}
    </div>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'mx-2 my-0.5 h-10 flex items-center rounded-sm text-left text-[13px] cursor-pointer transition-colors px-3 gap-2.5',
        active
          ? 'bg-vscode-list-active text-vscode-fg-bright'
          : 'text-vscode-fg hover:bg-vscode-list-hover',
      )}
    >
      <Codicon name={icon} size={16} className={active ? 'text-vscode-focus' : 'text-vscode-fg-dim'} />
      <span>{label}</span>
    </button>
  );
}
