import { useState } from 'react';
import { useStore } from '@/state/store';
import { Codicon } from '@/ui/Codicon';
import { AppButton } from '@/ui/AppButton';

export function UpdateBanner() {
  const update = useStore((s) => s.update);
  const setUpdate = useStore((s) => s.setUpdate);
  const [hidden, setHidden] = useState(false);
  if (!update.available || hidden) return null;

  const onUpdate = async () => {
    if (!update.ready) return; // ยังดาวน์โหลดไม่เสร็จ — ห้าม restart
    const r = await window.inktts.app.applyUpdate();
    if (!r.ok) setUpdate({ ready: false });
  };
  const onOpen = () => {
    if (update.releaseUrl) window.inktts.fs.openExternal(update.releaseUrl);
  };

  return (
    <div className="bg-vscode-accent text-white px-4 py-2 flex items-center gap-3 text-[13px] flex-none">
      <Codicon
        name={update.ready ? 'rocket' : 'cloud-download'}
        size={16}
        spin={!!update.downloading && !update.ready}
      />
      {update.ready ? (
        <>
          <span className="font-semibold">เวอร์ชันใหม่ {update.version} พร้อมแล้ว</span>
          <span className="opacity-80">— จะอัปเดตอัตโนมัติเมื่อปิดแอพ</span>
          <AppButton tone="primary" variant="chrome" onClick={onUpdate} className="ml-auto">
            <Codicon name="refresh" size={15} />
            รีสตาร์ทเดี๋ยวนี้
          </AppButton>
          <AppButton tone="zinc" variant="chrome" onClick={onOpen}>
            <Codicon name="link-external" size={15} />
            ดูรายละเอียด
          </AppButton>
        </>
      ) : update.downloading ? (
        <>
          <span className="font-semibold">กำลังเตรียมเวอร์ชันใหม่ {update.version}</span>
          <span className="opacity-80">(ปัจจุบัน {update.current})</span>
          <span className="opacity-90 ml-auto">กำลังดาวน์โหลดอัตโนมัติ {update.progress ?? 0}%</span>
        </>
      ) : (
        <>
          <span className="font-semibold">มีเวอร์ชันใหม่ {update.version}</span>
          <span className="opacity-80">
            {update.mode === 'manual'
              ? '— ดาวน์โหลดเองจาก GitHub Releases'
              : '— ดาวน์โหลดอัตโนมัติล้มเหลว จะลองใหม่ใน 30 นาที'}
          </span>
          <AppButton tone="zinc" variant="chrome" onClick={onOpen} className="ml-auto">
            <Codicon name="link-external" size={15} />
            ดาวน์โหลด
          </AppButton>
        </>
      )}
      <button
        type="button"
        className="w-9 h-9 flex items-center justify-center hover:bg-white/15 rounded-sm"
        onClick={() => setHidden(true)}
        title="ปิด"
      >
        <Codicon name="close" size={16} />
      </button>
    </div>
  );
}
