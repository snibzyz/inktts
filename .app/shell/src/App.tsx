import { useEffect, useState } from 'react';
import { useStore } from '@/state/store';
import { useQueueStore } from '@/state/queueStore';
import { Sidebar } from '@/components/Sidebar';
import { ServicePanel } from '@/components/ServicePanel';
import { QueuePanel } from '@/components/QueuePanel';
import { MergePanel } from '@/components/MergePanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { UpdateBanner } from '@/components/UpdateBanner';
import { ErrorToast } from '@/components/ErrorToast';
import { ErrorInbox } from '@/components/ErrorInbox';
import { hydrate, startAutosave } from '@/lib/persistence';
import { reportError } from '@/lib/errorBus';

export function App() {
  const view = useStore((s) => s.view);
  const setRoots = useStore((s) => s.setRoots);
  const setUpdate = useStore((s) => s.setUpdate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // โหลด settings + appRoot/inputDir/outputDir + คิว ก่อนแสดง UI
    Promise.all([
      hydrate(),
      window.inktts.fs.getAppRoot().then(setRoots),
      useQueueStore.getState().load(),
    ]).finally(() => {
      setReady(true);
      // เริ่ม autosave หลัง hydrate เสร็จ — กันบันทึก default ทับของจริง
      startAutosave();
    });

    // คิว: รับ event push จาก main process (update/log/notice)
    const offQUpdate = window.inktts.queue.onUpdate((evt) => useQueueStore.getState().applyUpdate(evt));
    const offQLog = window.inktts.queue.onLog((evt) => useQueueStore.getState().appendLog(evt));
    const offQNotice = window.inktts.queue.onNotice((n) => {
      // ช่องทาง toast เดียวที่มีคือ Error Toast — ใช้แจ้งเตือน throttle/retry/ล้มเหลว
      if (n.kind === 'throttle') reportError({ source: 'คิว · จำกัดเรท', message: n.message });
      else if (n.kind === 'retry') reportError({ source: 'คิว · ลองใหม่อัตโนมัติ', message: n.message });
      else if (n.kind === 'failed' || n.kind === 'done-with-errors') reportError({ source: 'คิว', message: n.message });
      // 'done' (สำเร็จ) → ไม่ต้อง toast เห็นในหน้าคิวแล้ว
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
        releaseDate: info.releaseDate ?? null,
        downloading: auto,
        ready: false,
        error: null,
      });
    });
    const offProg = window.inktts.app.onUpdateProgress((p) => {
      setUpdate({ progress: p.percent });
    });
    const offDone = window.inktts.app.onUpdateDownloaded(() => {
      setUpdate({ downloading: false, ready: true, error: null });
    });
    const offErr = window.inktts.app.onUpdateError((info) => {
      // ดาวน์โหลดล้มเหลว → ออกจาก downloading + เก็บข้อความไว้ใน banner
      // periodic poll (30 นาที) จะ retry — ถ้าสำเร็จ banner กลับมาเป็น downloading/ready ตามปกติ
      setUpdate({ downloading: false, ready: false, error: info?.message || 'ดาวน์โหลดล้มเหลว' });
      reportError({ source: 'อัปเดต', message: info?.message || 'ดาวน์โหลด update ล้มเหลว' });
    });

    // Global handler — uncaught JS error ใน renderer
    // ครอบ try รอบ event handlers, async tasks ที่ไม่มี await จับ ฯลฯ
    const onWindowErr = (ev: ErrorEvent) => {
      reportError({
        source: 'Renderer',
        message: ev.message || 'JavaScript error',
        details: ev.error?.stack || `${ev.filename}:${ev.lineno}:${ev.colno}`,
      });
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason: any = ev.reason;
      reportError({
        source: 'Renderer',
        message: reason?.message || 'Unhandled Promise rejection',
        details: reason?.stack || (typeof reason === 'string' ? reason : JSON.stringify(reason)),
      });
    };
    window.addEventListener('error', onWindowErr);
    window.addEventListener('unhandledrejection', onRejection);

    // Global TTS error handler — runner emit 'error' ที่ไหนก็โผล่ toast
    // (ServicePanel ก็ handle ด้วย แต่ผูกกับ service ปัจจุบัน — global = แม้ user เปลี่ยน view ระหว่างที่ job รัน ก็ยังเห็น)
    const offTtsEvt = window.inktts.tts.onEvent((evt: any) => {
      if (evt?.type === 'error') {
        reportError({ source: 'TTS', message: evt.message || 'TTS job error', details: `jobId: ${evt.jobId}` });
      }
    });

    return () => {
      offAvail(); offProg(); offDone(); offErr(); offTtsEvt();
      offQUpdate(); offQLog(); offQNotice();
      window.removeEventListener('error', onWindowErr);
      window.removeEventListener('unhandledrejection', onRejection);
    };
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
        {view === 'queue' ? <QueuePanel /> :
         view === 'merge' ? <MergePanel /> :
         view === 'settings' ? <SettingsPanel /> :
         <ServicePanel serviceKey={view} />}
      </div>
      <ErrorToast />
      <ErrorInbox />
    </div>
  );
}
