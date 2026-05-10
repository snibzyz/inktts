import { useEffect, useState } from 'react';
import { useStore } from '@/state/store';
import { Sidebar } from '@/components/Sidebar';
import { ServicePanel } from '@/components/ServicePanel';
import { MergePanel } from '@/components/MergePanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { UpdateBanner } from '@/components/UpdateBanner';
import { hydrate, startAutosave } from '@/lib/persistence';

export function App() {
  const view = useStore((s) => s.view);
  const setRoots = useStore((s) => s.setRoots);
  const setUpdate = useStore((s) => s.setUpdate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // โหลด settings + appRoot/inputDir/outputDir ก่อนแสดง UI
    Promise.all([
      hydrate(),
      window.inktts.fs.getAppRoot().then(setRoots),
    ]).finally(() => {
      setReady(true);
      // เริ่ม autosave หลัง hydrate เสร็จ — กันบันทึก default ทับของจริง
      startAutosave();
    });
    const offAvail = window.inktts.app.onUpdateAvailable((info) => {
      const auto = info.mode === 'portable';
      setUpdate({
        available: true,
        mode: info.mode,
        version: info.version,
        current: info.current,
        downloadUrl: info.downloadUrl,
        releaseUrl: info.releaseUrl,
        downloading: auto,
        ready: false,
      });
    });
    const offProg = window.inktts.app.onUpdateProgress((p) => {
      setUpdate({ progress: p.percent });
    });
    const offDone = window.inktts.app.onUpdateDownloaded(() => {
      setUpdate({ downloading: false, ready: true });
    });
    const offErr = window.inktts.app.onUpdateError(() => {
      // ดาวน์โหลดล้มเหลว → ออกจากสถานะ "downloading" จะ retry รอบหน้า (30 นาที)
      setUpdate({ downloading: false, ready: false });
    });
    return () => { offAvail(); offProg(); offDone(); offErr(); };
  }, []);

  if (!ready) {
    // hydrate ใช้เวลาแค่หลักสิบ ms — แต่กัน flash ก่อน load settings เสร็จ
    return <div className="h-full bg-vscode-editor" />;
  }

  return (
    <div className="h-full flex flex-col bg-vscode-editor">
      <UpdateBanner />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        {view === 'merge' ? <MergePanel /> :
         view === 'settings' ? <SettingsPanel /> :
         <ServicePanel serviceKey={view} />}
      </div>
    </div>
  );
}
