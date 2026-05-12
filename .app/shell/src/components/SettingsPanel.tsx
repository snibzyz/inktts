import { useEffect, useState } from 'react';
import { useStore } from '@/state/store';
import { Codicon } from '@/ui/Codicon';
import { AppButton } from '@/ui/AppButton';
import { AppCard } from '@/ui/AppCard';
import { cn } from '@/ui/cn';

interface FolderInfo {
  defaults: { inputDir: string; outputDir: string };
  settingsPath: string;
  userDataDir: string;
  custom: { inputDir: string | null; outputDir: string | null };
}

export function SettingsPanel() {
  const appRoot = useStore((s) => s.appRoot);
  const inputDir = useStore((s) => s.inputDir);
  const outputDir = useStore((s) => s.outputDir);
  const setRoots = useStore((s) => s.setRoots);
  const setStatus = useStore((s) => s.setStatus);
  const update = useStore((s) => s.update);
  const setUpdate = useStore((s) => s.setUpdate);
  const version = window.inktts?.app?.version || '–';
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [info, setInfo] = useState<FolderInfo | null>(null);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [cachePath, setCachePath] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const refreshCache = async () => {
    const r = await window.inktts.cache.size();
    if (r.ok) {
      setCacheBytes(r.bytes);
      if (r.path) setCachePath(r.path);
    }
  };

  const onClearCache = async () => {
    setClearing(true);
    const r = await window.inktts.cache.clear();
    setClearing(false);
    if (r.ok) {
      setStatus({ kind: 'ok', message: 'ล้างข้อมูลชั่วคราวเรียบร้อย' });
      refreshCache();
    } else {
      setStatus({ kind: 'fail', message: r.error || 'ล้างข้อมูลชั่วคราวไม่สำเร็จ' });
    }
  };

  const refreshInfo = async () => {
    const r = await window.inktts.settings.get();
    setInfo({
      defaults: r.defaults,
      settingsPath: r.settingsPath,
      userDataDir: r.userDataDir,
      custom: { inputDir: r.data?.paths?.inputDir ?? null, outputDir: r.data?.paths?.outputDir ?? null },
    });
    // refresh เผื่อ default change
    const root = await window.inktts.fs.getAppRoot();
    setRoots(root);
  };

  useEffect(() => { refreshInfo(); refreshCache(); }, []);

  useEffect(() => {
    if (update.available && update.version) {
      setLastCheck(`พบเวอร์ชัน ${update.version}`);
    }
  }, [update.available, update.version]);

  const onCheckUpdate = async () => {
    setChecking(true);
    setLastCheck(null);
    const r = await window.inktts.app.checkUpdate();
    setChecking(false);
    if (!r.ok) {
      setLastCheck(r.error || 'ตรวจไม่ได้ (ใช้ได้เฉพาะรุ่น portable)');
      return;
    }
    if (r.result && r.result.available) {
      setUpdate({
        available: true,
        version: r.result.latest,
        current: r.result.current,
        downloadUrl: r.result.downloadUrl,
        releaseUrl: r.result.releaseUrl,
      });
      setLastCheck(`พบเวอร์ชันใหม่ ${r.result.latest}`);
    } else {
      setLastCheck('เป็นเวอร์ชันล่าสุดแล้ว');
    }
  };

  const pickInputDir = async () => {
    const dir = await window.inktts.fs.chooseFolder({ defaultPath: inputDir, title: 'เลือกโฟลเดอร์ไฟล์ข้อความต้นฉบับ' });
    if (!dir) return;
    await window.inktts.settings.setInputDir(dir);
    await refreshInfo();
    setStatus({ kind: 'ok', message: `เปลี่ยนโฟลเดอร์ต้นฉบับเป็น ${dir}` });
  };
  const resetInputDir = async () => {
    await window.inktts.settings.setInputDir(null);
    await refreshInfo();
    setStatus({ kind: 'info', message: 'รีเซ็ตโฟลเดอร์ต้นฉบับเป็นค่าเริ่มต้น' });
  };
  const pickOutputDir = async () => {
    const dir = await window.inktts.fs.chooseFolder({ defaultPath: outputDir, title: 'เลือกโฟลเดอร์ไฟล์เสียงผลลัพธ์' });
    if (!dir) return;
    await window.inktts.settings.setOutputDir(dir);
    await refreshInfo();
    setStatus({ kind: 'ok', message: `เปลี่ยนโฟลเดอร์ผลลัพธ์เป็น ${dir}` });
  };
  const resetOutputDir = async () => {
    await window.inktts.settings.setOutputDir(null);
    await refreshInfo();
    setStatus({ kind: 'info', message: 'รีเซ็ตโฟลเดอร์ผลลัพธ์เป็นค่าเริ่มต้น' });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 pt-6 pb-5 border-b border-vscode-border flex items-start gap-3.5 flex-none">
        <Codicon name="gear" size={26} className="text-vscode-focus mt-1" />
        <div>
          <div className="text-[20px] font-semibold text-vscode-fg-bright leading-tight">ตั้งค่า</div>
          <div className="text-[13px] text-vscode-fg-dim mt-1">โฟลเดอร์ทำงาน · เวอร์ชัน · อัปเดต</div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
        <AppCard title="โฟลเดอร์ทำงาน" bodyClassName="space-y-3">
          <FolderRow
            label="ไฟล์ข้อความต้นฉบับ (.txt)"
            current={inputDir}
            isCustom={!!info?.custom?.inputDir}
            defaultPath={info?.defaults?.inputDir}
            onPick={pickInputDir}
            onReset={resetInputDir}
            onOpen={() => window.inktts.fs.revealFolder(inputDir)}
          />
          <FolderRow
            label="ไฟล์เสียงผลลัพธ์ (.m4a)"
            current={outputDir}
            isCustom={!!info?.custom?.outputDir}
            defaultPath={info?.defaults?.outputDir}
            onPick={pickOutputDir}
            onReset={resetOutputDir}
            onOpen={() => window.inktts.fs.revealFolder(outputDir)}
          />

          <div className="border-t border-vscode-border pt-3 space-y-1.5">
            <InfoRow
              icon="root-folder"
              label="โฟลเดอร์โปรแกรม"
              path={appRoot}
              onOpen={() => window.inktts.fs.revealFolder(appRoot)}
            />
            <InfoRow
              icon="database"
              label="โฟลเดอร์ตั้งค่า"
              path={info?.userDataDir || ''}
              hint="settings.json + cache + log"
              onOpen={() => info?.userDataDir && window.inktts.fs.revealFolder(info.userDataDir)}
            />
          </div>
        </AppCard>

        <AppCard title="เวอร์ชัน + อัปเดต" bodyClassName="space-y-3">
          <div className="flex items-center gap-2 text-[14px]">
            <Codicon name="versions" size={16} className="text-vscode-fg-dim" />
            <span className="text-vscode-fg">เวอร์ชันปัจจุบัน:</span>
            <span className="font-mono text-vscode-fg-bright">{version}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <AppButton tone="primary" variant="flat" onClick={onCheckUpdate} disabled={checking}>
              <Codicon name={checking ? 'sync' : 'cloud-download'} size={15} spin={checking} />
              {checking ? 'กำลังตรวจ...' : 'ตรวจหาอัปเดต'}
            </AppButton>
            {lastCheck && (
              <span className={cn('text-[13px]',
                lastCheck.startsWith('พบเวอร์ชันใหม่') ? 'text-vscode-success' :
                lastCheck === 'เป็นเวอร์ชันล่าสุดแล้ว' ? 'text-vscode-fg-dim' : 'text-vscode-warning'
              )}>{lastCheck}</span>
            )}
          </div>
          <div className="text-[12px] text-vscode-fg-dim flex items-start gap-2">
            <Codicon name="info" size={14} className="mt-0.5" />
            <span>การตรวจหาอัปเดตอัตโนมัติทำงานเฉพาะรุ่น portable บน Windows · ในโหมดพัฒนาจะไม่ตรวจ</span>
          </div>
        </AppCard>

        <AppCard title="ข้อมูลชั่วคราว (Cache)" bodyClassName="space-y-3">
          <div className="text-[13px] text-vscode-fg leading-relaxed">
            แอพเก็บชิ้นเสียงที่ดาวน์โหลดมาไว้ใช้รอบถัดไป — ถ้าไฟดับ ปิดเครื่อง หรือเปิดใหม่กลางทาง
            กดเริ่มใหม่จะ <span className="text-vscode-fg-bright">ทำต่อจากเดิม</span> ไม่เริ่มจาก 0
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-[14px]">
              <Codicon name="database" size={16} className="text-vscode-fg-dim" />
              <span className="text-vscode-fg">ขนาดที่ใช้:</span>
              <span className="font-mono text-vscode-fg-bright">{cacheBytes == null ? '–' : formatBytes(cacheBytes)}</span>
            </div>
            <AppButton tone="zinc" variant="flat" onClick={refreshCache} title="คำนวณใหม่">
              <Codicon name="refresh" size={14} />
              รีเฟรช
            </AppButton>
            <AppButton tone="zinc" variant="flat" onClick={onClearCache} disabled={clearing || (cacheBytes ?? 0) === 0}>
              <Codicon name={clearing ? 'sync' : 'trash'} size={14} spin={clearing} />
              {clearing ? 'กำลังล้าง...' : 'ล้างข้อมูลชั่วคราว'}
            </AppButton>
            {cachePath && (
              <AppButton tone="zinc" variant="icon" onClick={() => window.inktts.fs.revealFolder(cachePath)} title="เปิดในตัวจัดการไฟล์">
                <Codicon name="link-external" size={15} />
              </AppButton>
            )}
          </div>
          <div className="text-[12px] text-vscode-fg-dim flex items-start gap-2">
            <Codicon name="info" size={14} className="mt-0.5" />
            <span>กดล้างเมื่อยืนยันว่างานทุกไฟล์รวมเสร็จแล้ว — ล้างกลางทางจะต้องดาวน์โหลดใหม่</span>
          </div>
        </AppCard>

        <AppCard title="เกี่ยวกับ" bodyClassName="space-y-2">
          <div className="text-[13px] text-vscode-fg leading-relaxed">
            INKTTS คือเครื่องมือแปลงข้อความภาษาไทยเป็นเสียงทีละหลายไฟล์ ผ่านบริการ TTS ฟรี 3 ตัว
            (Microsoft Edge, Google Translate, ResponsiveVoice) — เป็นส่วนหนึ่งของตระกูล INKIDEA Hub
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <AppButton tone="zinc" variant="flat" onClick={() => window.inktts.fs.openExternal('https://github.com/snibzyz/inktts')}>
              <Codicon name="github" size={15} />
              GitHub
            </AppButton>
            <AppButton tone="zinc" variant="flat" onClick={() => window.inktts.fs.openExternal('https://github.com/snibzyz/inktts/releases')}>
              <Codicon name="package" size={15} />
              Releases
            </AppButton>
          </div>
        </AppCard>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function FolderRow({
  label, current, isCustom, defaultPath, onPick, onReset, onOpen,
}: {
  label: string;
  current: string;
  isCustom: boolean;
  defaultPath?: string;
  onPick: () => void;
  onReset: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="grid grid-cols-[220px_1fr] items-start gap-3 py-1">
      <label className="text-[13px] text-vscode-fg pt-2.5">{label}</label>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 h-10 px-3 flex items-center bg-vscode-input border border-vscode-input-border rounded-sm text-[12px] text-vscode-fg font-mono truncate" title={current}>
            {current || '–'}
          </div>
          <AppButton tone="zinc" variant="chrome" onClick={onPick}>
            <Codicon name="folder" size={14} />
            เลือก
          </AppButton>
          <AppButton tone="zinc" variant="icon" onClick={onOpen} title="เปิดในตัวจัดการไฟล์">
            <Codicon name="link-external" size={15} />
          </AppButton>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-vscode-fg-dim">
          {isCustom ? (
            <>
              <Codicon name="check" size={11} className="text-vscode-success" />
              <span>กำหนดเอง</span>
              <button
                type="button"
                className="text-vscode-focus hover:underline ml-1"
                onClick={onReset}
              >รีเซ็ตเป็นค่าเริ่มต้น</button>
              {defaultPath && <span className="text-vscode-muted truncate">({defaultPath})</span>}
            </>
          ) : (
            <>
              <Codicon name="info" size={11} />
              <span>ค่าเริ่มต้น (ข้าง .exe หรือ workspace ของ dev)</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon, label, path, hint, onOpen,
}: {
  icon: string;
  label: string;
  path: string;
  hint?: string;
  onOpen?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <Codicon name={icon} size={15} className="text-vscode-fg-dim flex-none" />
      <span className="text-[13px] text-vscode-fg w-48 flex-none">{label}</span>
      <span className="text-[12px] text-vscode-fg-dim font-mono truncate flex-1" title={path}>{path || '–'}</span>
      {hint && <span className="text-[11px] text-vscode-muted flex-none">({hint})</span>}
      {onOpen && path && (
        <AppButton tone="zinc" variant="icon" onClick={onOpen} title="เปิดในตัวจัดการไฟล์">
          <Codicon name="link-external" size={15} />
        </AppButton>
      )}
    </div>
  );
}
