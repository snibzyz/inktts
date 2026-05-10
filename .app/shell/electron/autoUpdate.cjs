// Auto-update orchestrator. portable mode → custom helper-cmd swap.
// dev mode → skip.

const { ipcMain, app } = require('electron');
const portable = require('./portableUpdate.cjs');
const { createLogger } = require('./helpers/logger.cjs');

const log = createLogger('autoupdate');

let mainWindowRef = null;
let pendingUpdate = null;
let periodicTimer = null;
const PERIODIC_MS = 30 * 60 * 1000; // ทุก 30 นาที

// guard เพื่อกัน:
//   1. periodic poll ทำงานซ้อน (poll N+1 ระหว่าง stage ของ poll N ยังไม่เสร็จ)
//   2. re-stage รุ่นเดียวที่ apply ค้างอยู่แล้ว (banner เด้งทุก 30 นาที)
let _staging = false;

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

function start(mainWindow) {
  mainWindowRef = mainWindow;
  if (process.env.NODE_ENV === 'development') {
    log.info('auto-update disabled in dev');
    return;
  }
  if (!portable.isPortableWin() && !portable.isMac()) {
    log.info('update check unsupported on this platform/mode', { platform: process.platform });
    return;
  }
  // เคลียร์ marker ที่ค้างจาก swap ครั้งก่อน (Win portable เท่านั้น) —
  // Mac ไม่มี marker เพราะไม่ stage
  if (portable.isPortableWin()) portable.pruneStaleMarker();

  // ครั้งแรกหลัง 5 วิ (รอ UI พร้อม)
  setTimeout(() => {
    checkOnce(mainWindow).catch((err) => log.warn('first check failed', { error: err && err.message }));
  }, 5000);
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = setInterval(() => {
    checkOnce(mainWindow).catch((err) => log.warn('periodic check failed', { error: err && err.message }));
  }, PERIODIC_MS);
}

function registerIpc() {
  // Manual check (เช่น Settings ปุ่ม "ตรวจหาอัปเดต") —
  // ทริกเกอร์ flow เดียวกับ periodic poll: ส่ง app:updateAvailable +
  // silent stage download → app:updateDownloaded
  ipcMain.handle('app:checkUpdate', async () => {
    if (process.env.NODE_ENV === 'development') return { ok: false, error: 'disabled in dev' };
    if (!portable.isPortableWin() && !portable.isMac()) return { ok: false, error: 'platform not supported' };
    // เรียก checkOnce ที่จัดการ stage flow + IPC events เอง
    // ก่อน return ให้ renderer — fire-and-forget เพื่อไม่ block ปุ่ม
    const previewResult = await portable.checkForUpdates();
    if (previewResult && previewResult.available && !_staging) {
      checkOnce(mainWindowRef, previewResult).catch((err) => log.warn('manual checkOnce failed', { error: err && err.message }));
    }
    return { ok: true, result: previewResult };
  });

  ipcMain.handle('app:applyUpdate', async () => {
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
      await portable.downloadAndApply(pendingUpdate.downloadUrl, pendingUpdate.latest, mainWindowRef);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message };
    } finally {
      _staging = false;
    }
  });

}

// เรียกตอน app quit — ถ้ามี staged update → apply เงียบ ๆ ก่อนปิดจริง
function applyStagedOnQuit() {
  if (!portable.isPortableWin()) return false;
  const marker = portable.readStageMarker();
  if (!marker || !marker.path) return false;
  log.info('applying staged update on quit', marker);
  return portable.applyStaged();
}

module.exports = { start, registerIpc, applyStagedOnQuit };
