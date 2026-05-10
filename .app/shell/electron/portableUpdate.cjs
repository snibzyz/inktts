// Custom updater for Win portable .exe — checks GitHub releases for new portable
// .exe artifact, downloads to %TEMP%, spawns helper .cmd that swaps the running
// .exe and restarts. Same pattern as INKCRAW.

const { app, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createLogger } = require('./helpers/logger.cjs');

const log = createLogger('portableUpdate');

// GitHub Releases — read from build config
function getRepoInfo() {
  const env = process.env.INKTTS_REPO || '';
  if (env && env.includes('/')) {
    const [owner, repo] = env.split('/');
    return { owner, repo };
  }
  return { owner: 'snibzyz', repo: 'inktts' };
}

function isPortableWin() {
  return process.platform === 'win32' && !!process.env.PORTABLE_EXECUTABLE_FILE;
}

function isMac() {
  return process.platform === 'darwin';
}

function canAutoApply() {
  return isPortableWin();
}

function compareSemver(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    req.setHeader('Accept', 'application/vnd.github+json');
    req.setHeader('User-Agent', 'INKTTS-updater');
    let body = '';
    req.on('response', (res) => {
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        return;
      }
      res.on('data', (c) => { body += c.toString('utf-8'); });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(err); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// 10 นาที — ถ้าโหลดเกินนี้ถือว่า hang
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    let settled = false;
    let ws = null;
    let timer = null;

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { if (ws) ws.destroy(); } catch { /* noop */ }
      try { fs.unlinkSync(destPath); } catch { /* noop */ }
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    timer = setTimeout(() => fail(new Error(`download timeout (${DOWNLOAD_TIMEOUT_MS}ms)`)), DOWNLOAD_TIMEOUT_MS);

    req.on('response', (res) => {
      if (res.statusCode >= 400) {
        fail(new Error(`HTTP ${res.statusCode} ${url}`));
        res.on('data', () => {});
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      ws = fs.createWriteStream(destPath);
      ws.on('error', fail);
      ws.on('finish', succeed);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress({ received, total, percent: total ? (received / total) * 100 : 0 });
      });
      res.on('error', fail);
      res.pipe(ws);
    });
    req.on('error', fail);
    req.end();
  });
}

async function checkForUpdates() {
  if (!isPortableWin() && !isMac()) return null;
  const { owner, repo } = getRepoInfo();
  try {
    const release = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    if (!release || !release.tag_name) return null;
    const latest = String(release.tag_name).replace(/^v/, '');
    const current = app.getVersion();
    const available = compareSemver(latest, current) > 0;
    let asset = null;
    if (isPortableWin()) {
      asset = (release.assets || []).find((a) =>
        /portable.*\.exe$/i.test(a.name) || /^INKTTS-Portable.*\.exe$/i.test(a.name));
    } else if (isMac()) {
      asset = (release.assets || []).find((a) => /\.dmg$/i.test(a.name));
    }
    log.info('checked', { latest, current, available, platform: process.platform, hasAsset: !!asset });
    return {
      available,
      latest,
      current,
      releaseDate: release.published_at || null,
      releaseUrl: release.html_url,
      downloadUrl: asset ? asset.browser_download_url : null,
      releaseNotes: release.body || '',
    };
  } catch (err) {
    log.warn('check failed', { error: err && err.message });
    return null;
  }
}

// ─── Two-phase update flow (silent) ─────────────────────────────────────────
//
// Phase 1: stage  — ดาวน์โหลดไฟล์ใหม่ลง %TEMP% เงียบ ๆ ในพื้นหลัง (ทันทีที่ตรวจเจอ
//                   เวอร์ชันใหม่) → save state ใน userData
// Phase 2: apply  — เมื่อ user ปิดแอพ (หรือกด Restart now) → spawn helper.cmd
//                   ที่จะรอ 2 วิ → swap exe → start ใหม่ → ลบ helper
//
// ผลลัพธ์: user ไม่ต้องคลิก ไม่ต้องเห็นกล่องโต้ตอบ ครั้งหน้าที่เปิดแอพได้รุ่นใหม่ทันที

function getStagePath(version) {
  return path.join(app.getPath('temp'), `INKTTS-Portable-${version}.exe`);
}

function getStageMarkerPath() {
  return path.join(app.getPath('userData'), 'update-staged.json');
}

function readStageMarker() {
  try {
    const txt = fs.readFileSync(getStageMarkerPath(), 'utf-8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function writeStageMarker(data) {
  try {
    fs.mkdirSync(path.dirname(getStageMarkerPath()), { recursive: true });
    fs.writeFileSync(getStageMarkerPath(), JSON.stringify(data), 'utf-8');
  } catch (err) {
    log.warn('writeStageMarker failed', { error: err && err.message });
  }
}

function clearStageMarker() {
  try { fs.unlinkSync(getStageMarkerPath()); } catch { /* noop */ }
}

// เรียกตอน app boot — เคลียร์ marker ที่ค้างจากการ swap ที่ล้มเหลว
// (เช่น helper.cmd swap fail → app รีสตาร์ทกลับมาเป็นเวอร์ชันเดิม → marker ยังชี้ไป tmpExe เก่า)
// ถ้า marker.version <= currentVersion → stale → ลบ
function pruneStaleMarker() {
  if (!isPortableWin()) return;
  const marker = readStageMarker();
  if (!marker || !marker.version) return;
  const current = app.getVersion();
  if (compareSemver(marker.version, current) <= 0) {
    log.info('pruning stale marker', { marker, current });
    clearStageMarker();
    // ลบไฟล์ stage ใน %TEMP% ด้วยถ้ายังอยู่
    try { if (marker.path && fs.existsSync(marker.path)) fs.unlinkSync(marker.path); } catch { /* noop */ }
  }
}

// Stage = download only (no apply)
async function stageUpdate(downloadUrl, version, onProgress) {
  if (!isPortableWin()) throw new Error('portable Win only');
  const tmpExe = getStagePath(version);

  // ถ้าไฟล์ stage อยู่แล้วและขนาดดูสมเหตุผล (>10MB) → skip download
  if (fs.existsSync(tmpExe) && fs.statSync(tmpExe).size > 10 * 1024 * 1024) {
    const marker = readStageMarker();
    if (marker && marker.version === version && marker.path === tmpExe) {
      log.info('already staged', { version, tmpExe });
      return { staged: true, path: tmpExe, version };
    }
  }

  log.info('staging update', { url: downloadUrl, to: tmpExe });
  await downloadFile(downloadUrl, tmpExe, onProgress);
  writeStageMarker({ version, path: tmpExe, downloadedAt: new Date().toISOString() });
  log.info('staged', { version, tmpExe });
  return { staged: true, path: tmpExe, version };
}

// Apply = swap + restart using already-staged file
function applyStaged() {
  if (!isPortableWin()) return false;
  const oldExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!oldExe || !fs.existsSync(oldExe)) {
    log.warn('not running as portable .exe — cannot apply');
    return false;
  }
  const marker = readStageMarker();
  if (!marker || !marker.path || !fs.existsSync(marker.path)) {
    log.info('no staged update to apply');
    return false;
  }

  const tmpExe = marker.path;
  const helperPath = path.join(app.getPath('temp'), `inktts-update-${Date.now()}.cmd`);
  const script = [
    '@echo off',
    'timeout /t 2 /nobreak > nul',
    `move /Y "${tmpExe}" "${oldExe}"`,
    'if errorlevel 1 (',
    '  echo INKTTS update failed: cannot replace exe',
    '  exit /b 1',
    ')',
    `start "" "${oldExe}"`,
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n');
  fs.writeFileSync(helperPath, script, 'utf8');

  spawn('cmd.exe', ['/c', helperPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();

  clearStageMarker();
  log.info('apply: helper spawned', { from: tmpExe, to: oldExe });
  return true;
}

// Legacy single-call: stage + apply immediately (used when user clicks "Update now")
async function downloadAndApply(downloadUrl, version, mainWindow) {
  await stageUpdate(downloadUrl, version, (p) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:updateProgress', {
        percent: Math.round(p.percent), received: p.received, total: p.total,
      });
    }
  });
  if (applyStaged()) {
    setTimeout(() => app.quit(), 200);
  }
}

module.exports = {
  isPortableWin,
  isMac,
  canAutoApply,
  checkForUpdates,
  downloadAndApply,
  stageUpdate,
  applyStaged,
  readStageMarker,
  clearStageMarker,
  pruneStaleMarker,
};
