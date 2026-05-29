// Auto-update orchestrator. portable mode → custom helper-cmd swap.
// dev mode → skip.

const { ipcMain, app } = require('electron');
const portable = require('./portableUpdate.cjs');
const macUpdater = require('./macUpdate.cjs');
const { createLogger } = require('./helpers/logger.cjs');

const log = createLogger('autoupdate');

// เก็บ getter ไม่ใช่ window ตรง ๆ — บน Mac ถ้า user ปิดแล้วเปิดใหม่ window จะถูกสร้าง instance ใหม่
// แต่ ref เดิมชี้ instance ที่ destroyed แล้ว → checkForUpdates เด้ง banner ใส่ window เก่าทุกครั้ง
let getMainWindow = () => null;
let pendingUpdate = null;
let pendingMacUpdate = null;
let periodicTimer = null;
const PERIODIC_MS = 30 * 60 * 1000; // ทุก 30 นาที

// guard เพื่อกัน:
//   1. periodic poll ทำงานซ้อน (poll N+1 ระหว่าง stage ของ poll N ยังไม่เสร็จ)
//   2. re-stage รุ่นเดียวที่ apply ค้างอยู่แล้ว (banner เด้งทุก 30 นาที)
let _staging = false;

// All current INK mac builds ship ad-hoc signed. Squirrel.Mac requires Apple
// Developer ID signature for auto-update verification — ad-hoc fails silently.
// macUpdate.cjs does a manual zip swap (mirrors portableUpdate.cjs for Win).
function useMacCustomUpdater() {
  return macUpdater.isMacPackaged();
}

async function checkMacOnce(mainWindow) {
  const result = await macUpdater.checkForUpdates();
  if (!result || !result.available) {
    log.info('no mac update');
    return;
  }
  pendingMacUpdate = result;
  log.info('mac update available', { version: result.latest });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:updateAvailable', {
      mode: 'portable',
      version: result.latest,
      current: result.current,
      downloadUrl: result.downloadUrl,
      releaseUrl: result.releaseUrl,
      releaseDate: result.releaseDate,
    });
  }
}

async function checkOnce(mainWindow, prefetchedResult) {
  if (_staging) {
    log.info('skip check — stage already in progress');
    return;
  }
  const result = prefetchedResult || await portable.checkForUpdates();
  if (!result || !result.available) {
    log.info('no update');
    return;
  }
  if (!result.downloadUrl) {
    log.warn('update available but no matching asset', { latest: result.latest, platform: process.platform });
    return;
  }

  pendingUpdate = result;
  const mode = portable.canAutoApply() ? 'portable' : 'manual';

  // Mac (and any non-portable Win path) — แจ้งเตือนอย่างเดียว ไม่ stage/apply เอง
  if (mode === 'manual') {
    log.info('manual update available', { version: result.latest, platform: process.platform });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:updateAvailable', {
        mode,
        version: result.latest,
        current: result.current,
        downloadUrl: result.downloadUrl,
        releaseUrl: result.releaseUrl,
        releaseDate: result.releaseDate,
      });
    }
    return;
  }

  // ถ้ารุ่นนี้ stage ไว้แล้ว → ส่ง event "ready" อย่างเดียว ไม่ต้องดาวน์โหลดใหม่
  const marker = portable.readStageMarker();
  const alreadyStaged = marker && marker.version === result.latest && marker.path;

  log.info('update available', { ...result, alreadyStaged: !!alreadyStaged });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:updateAvailable', {
      mode: 'portable',
      version: result.latest,
      current: result.current,
      downloadUrl: result.downloadUrl,
      releaseUrl: result.releaseUrl,
      releaseDate: result.releaseDate,
    });
    if (alreadyStaged) {
      // skip stage flow — แจ้ง renderer เลยว่า ready
      mainWindow.webContents.send('app:updateDownloaded', {
        mode: 'portable', version: result.latest,
      });
      return;
    }
  } else if (alreadyStaged) {
    return;
  }

  // Silent stage — ดาวน์โหลดในพื้นหลังทันที (ไม่รอ user คลิก)
  _staging = true;
  try {
    log.info('starting silent stage download');
    await portable.stageUpdate(result.downloadUrl, result.latest, (p) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:updateProgress', {
          percent: Math.round(p.percent), received: p.received, total: p.total,
        });
      }
    });
    log.info('silent stage complete');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:updateDownloaded', {
        mode: 'portable', version: result.latest,
      });
    }
  } catch (err) {
    log.warn('silent stage failed', { error: err && err.message });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:updateError', { message: err && err.message });
    }
  } finally {
    _staging = false;
  }
}

function start(getMainWindowFn) {
  // รับ getter callback แทน window object เพื่อให้แต่ละ check ดึง window ปัจจุบัน (Mac re-create case)
  if (typeof getMainWindowFn === 'function') getMainWindow = getMainWindowFn;
  else getMainWindow = () => getMainWindowFn; // backwards compat ถ้าใครส่ง window มาตรง ๆ
  if (process.env.NODE_ENV === 'development') {
    log.info('auto-update disabled in dev');
    return;
  }
  if (useMacCustomUpdater()) {
    log.info('mac mode — using custom updater (ad-hoc signed builds)');
    setTimeout(() => {
      checkMacOnce(getMainWindow()).catch((err) => log.warn('first mac check failed', { error: err && err.message }));
    }, 5000);
    if (periodicTimer) clearInterval(periodicTimer);
    periodicTimer = setInterval(() => {
      checkMacOnce(getMainWindow()).catch((err) => log.warn('periodic mac check failed', { error: err && err.message }));
    }, PERIODIC_MS);
    return;
  }
  if (!portable.isPortableWin() && !portable.isMac() && !portable.isInstalledWin()) {
    log.info('update check unsupported on this platform/mode', { platform: process.platform });
    return;
  }
  // เคลียร์ marker ที่ค้างจาก swap/install ครั้งก่อน (Win portable + installed) —
  // Mac ไม่มี marker เพราะไม่ stage
  if (portable.isPortableWin() || portable.isInstalledWin()) portable.pruneStaleMarker();

  // ครั้งแรกหลัง 5 วิ (รอ UI พร้อม)
  setTimeout(() => {
    checkOnce(getMainWindow()).catch((err) => log.warn('first check failed', { error: err && err.message }));
  }, 5000);
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = setInterval(() => {
    checkOnce(getMainWindow()).catch((err) => log.warn('periodic check failed', { error: err && err.message }));
  }, PERIODIC_MS);
}

function registerIpc() {
  // Manual check (เช่น Settings ปุ่ม "ตรวจหาอัปเดต") —
  // ทริกเกอร์ flow เดียวกับ periodic poll: ส่ง app:updateAvailable +
  // silent stage download → app:updateDownloaded
  ipcMain.handle('app:checkUpdate', async () => {
    if (process.env.NODE_ENV === 'development') return { ok: false, error: 'disabled in dev' };
    if (useMacCustomUpdater()) {
      const result = await macUpdater.checkForUpdates();
      if (result && result.available) pendingMacUpdate = result;
      return { ok: true, result };
    }
    if (!portable.isPortableWin() && !portable.isMac() && !portable.isInstalledWin()) return { ok: false, error: 'platform not supported' };
    // เรียก checkOnce ที่จัดการ stage flow + IPC events เอง
    // ก่อน return ให้ renderer — fire-and-forget เพื่อไม่ block ปุ่ม
    const previewResult = await portable.checkForUpdates();
    if (previewResult && previewResult.available && !_staging) {
      checkOnce(getMainWindow(), previewResult).catch((err) => log.warn('manual checkOnce failed', { error: err && err.message }));
    }
    return { ok: true, result: previewResult };
  });

  ipcMain.handle('app:applyUpdate', async () => {
    if (useMacCustomUpdater()) {
      if (!pendingMacUpdate) return { ok: false, error: 'no pending update' };
      try {
        await macUpdater.downloadAndApply(pendingMacUpdate.downloadUrl, pendingMacUpdate.latest, getMainWindow());
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err && err.message };
      }
    }
    if (!portable.canAutoApply()) return { ok: false, error: 'auto-apply not supported on this platform' };
    // ห้าม apply ระหว่าง silent stage ยังไม่เสร็จ — UI ก็ blocked อยู่แล้ว
    // แต่กันไว้กรณี IPC ถูกเรียกตรง ๆ
    if (_staging) return { ok: false, error: 'กำลังดาวน์โหลด — รอสักครู่' };
    // ถ้า stage เสร็จแล้ว — apply ตรง ๆ (ไม่ต้อง download ซ้ำ)
    const marker = portable.readStageMarker();
    if (marker && marker.path) {
      const ok = portable.applyStaged();
      if (ok) {
        setTimeout(() => app.quit(), 200);
        return { ok: true };
      }
    }
    if (!pendingUpdate || !pendingUpdate.downloadUrl) return { ok: false, error: 'no pending update' };
    // fallback: stage + apply (สำหรับกรณีไม่มี marker — เช่น stage failed ก่อนหน้า)
    _staging = true;
    try {
      await portable.downloadAndApply(pendingUpdate.downloadUrl, pendingUpdate.latest, getMainWindow());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message };
    } finally {
      _staging = false;
    }
  });

}

// เรียกตอน app quit — ถ้ามี staged update → apply เงียบ ๆ ก่อนปิดจริง
// portable → swap exe + relaunch · installed → spawn Setup.exe /S --force-run
function applyStagedOnQuit() {
  if (!portable.isPortableWin() && !portable.isInstalledWin()) return false;
  const marker = portable.readStageMarker();
  if (!marker || !marker.path) return false;
  log.info('applying staged update on quit', marker);
  return portable.applyStaged();
}

module.exports = { start, registerIpc, applyStagedOnQuit };
