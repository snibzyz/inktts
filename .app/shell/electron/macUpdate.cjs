// Custom updater สำหรับ macOS (ad-hoc signed builds)
//
// electron-updater/Squirrel.Mac ต้องการ Apple Developer ID signature เพื่อ
// verify update — ad-hoc signed (`identity: null` ใน package.json) จะถูก
// reject เงียบ ๆ. ตอนนี้แอป INK ทุกตัวยังไม่มี Apple Developer Program ($99/ปี)
// เลยทำ custom updater pattern เดียวกับ portableUpdate.cjs (Windows):
//
//   1. ดึง latest-mac.yml จาก generic update server เพื่อรู้เวอร์ชันล่าสุด
//   2. ถ้าเวอร์ชันใหม่กว่า — แจ้งผ่าน IPC (mode='portable' reuse banner เดิม)
//   3. user กด Update → ดาวน์โหลด .zip artifact จาก manifest
//   4. ใช้ `unzip` (built-in macOS) extract เป็น <Product>.app
//   5. spawn helper.sh แบบ detached → รอ app ปิด → swap .app → re-apply ad-hoc
//      codesign (Sequoia 15+ require signature) → xattr -cr (clear quarantine) →
//      เปิด app ใหม่
//
// ใช้ zip ไม่ใช่ dmg เพราะ:
//   - latest-mac.yml ของ electron-builder generate เฉพาะ zip (dmg.writeUpdateInfo=false)
//   - unzip + swap ง่ายและเงียบกว่า mount/copy/eject DMG
//   - เป็น pattern เดียวกับ Squirrel.Mac (ภายในก็ใช้ zip channel)

const { app, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createLogger } = require('./helpers/logger.cjs');

const log = createLogger('macUpdate');

// Per-app config — only thing to change when copying this file to another
// INK desktop app. `UPDATE_BASE_ENV` is the env var name that overrides the
// packaged update URL (matches portableUpdate.cjs convention).
const RELEASES_URL = 'https://github.com/snibzyz/inktts/releases';
const UPDATE_BASE_ENV = 'INKTTS_UPDATE_BASE_URL';

function readPackagedUpdateBaseUrl() {
  const candidates = [
    path.join(process.resourcesPath || '', 'app-update.yml'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'app-update.yml'),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const m = text.match(/^url:\s*['"]?([^'"\n]+)['"]?/m);
      if (m && m[1]) return m[1].trim();
    } catch {
      // ignore
    }
  }
  return null;
}

function getUpdateBaseUrl() {
  const explicit = process.env[UPDATE_BASE_ENV];
  const packaged = app.isPackaged ? readPackagedUpdateBaseUrl() : null;
  const base = explicit || packaged;
  if (!base) {
    throw new Error(`missing update URL — set ${UPDATE_BASE_ENV} at build time`);
  }
  return base.replace(/\/?$/, '/');
}

function parseFileUrls(text) {
  const filesIdx = text.search(/^files:\s*$/m);
  if (filesIdx === -1) return [];
  const after = text.slice(filesIdx).split('\n').slice(1);
  const urls = [];
  for (const line of after) {
    if (/^\S/.test(line)) break;
    const m = line.match(/^\s*-\s*url:\s*['"]?([^'"\n]+)['"]?\s*$/);
    if (m) urls.push(m[1].trim());
  }
  return urls;
}

function pickArchZip(urls, arch) {
  const want = arch === 'arm64' ? /arm64/i : /(x64|x86_64)/i;
  return urls.find((u) => /\.zip$/i.test(u) && want.test(u) && !/blockmap/i.test(u)) || null;
}

function latestUrl() {
  return `${getUpdateBaseUrl()}latest-mac.yml`;
}

function isMacPackaged() {
  return process.platform === 'darwin' && app.isPackaged;
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

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    let body = '';
    req.on('response', (res) => {
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        return;
      }
      res.on('data', (c) => { body += c.toString('utf-8'); });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    req.on('response', (res) => {
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const ws = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        ws.write(chunk);
        if (onProgress) onProgress({ received, total, percent: total ? (received / total) * 100 : 0 });
      });
      res.on('end', () => {
        ws.end();
        ws.on('finish', resolve);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function getInstalledAppBundle() {
  const exe = process.execPath;
  const macOsDir = path.dirname(exe);
  const contentsDir = path.dirname(macOsDir);
  const appBundle = path.dirname(contentsDir);
  if (!appBundle.endsWith('.app')) {
    throw new Error(`could not resolve .app bundle from ${exe}`);
  }
  return appBundle;
}

async function checkForUpdates() {
  if (!isMacPackaged()) return null;
  try {
    const text = await fetchText(latestUrl());
    const m = text.match(/^version:\s*['"]?([^'"\n]+)['"]?/m);
    if (!m) throw new Error('cannot parse latest-mac.yml');
    const latest = m[1].trim();
    const dateMatch = text.match(/^releaseDate:\s*['"]?([^'"\n]+)['"]?/m);
    const releaseDate = dateMatch ? dateMatch[1].trim().replace(/^'|'$/g, '') : null;
    const current = app.getVersion();
    const available = compareSemver(latest, current) > 0;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

    const urls = parseFileUrls(text);
    const archZipName = pickArchZip(urls, arch);
    if (!archZipName) {
      log.warn('no arch-specific zip in manifest', { arch, urls });
      return null;
    }
    const downloadUrl = `${getUpdateBaseUrl()}${archZipName}`;

    log.info('checked', { latest, current, available, arch, archZipName });
    return {
      available,
      latest,
      current,
      releaseDate,
      downloadUrl,
      releaseUrl: RELEASES_URL,
      releasesUrl: RELEASES_URL,
    };
  } catch (err) {
    log.warn('check failed', { error: err && err.message });
    return null;
  }
}

async function downloadAndApply(downloadUrl, version, mainWindow) {
  if (!isMacPackaged()) {
    throw new Error('mac apply only works in packaged mac build');
  }

  const installedApp = getInstalledAppBundle();
  const installParent = path.dirname(installedApp);
  const productSlug = path.basename(installedApp, '.app').toLowerCase().replace(/\s+/g, '-');
  const tmpDir = path.join(app.getPath('temp'), `${productSlug}-update-${Date.now()}`);
  const zipPath = path.join(tmpDir, `update-${version}.zip`);

  fs.mkdirSync(tmpDir, { recursive: true });
  log.info('downloading update', { url: downloadUrl, to: zipPath });

  await downloadFile(downloadUrl, zipPath, (p) => {
    if (mainWindow && mainWindow.webContents) {
      const reported = Math.round(Math.min(95, p.percent * 0.95));
      mainWindow.webContents.send('app:updateProgress', {
        percent: reported,
        received: p.received,
        total: p.total,
      });
    }
  });

  log.info('extracting zip', { zipPath, into: tmpDir });
  try {
    execFileSync('/usr/bin/unzip', ['-oq', zipPath, '-d', tmpDir]);
  } catch (err) {
    throw new Error(`unzip failed: ${err && err.message}`);
  }

  const extractedAppName = fs.readdirSync(tmpDir).find((entry) => entry.endsWith('.app'));
  if (!extractedAppName) {
    throw new Error(`no .app bundle found inside ${zipPath}`);
  }
  const extractedAppPath = path.join(tmpDir, extractedAppName);

  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('app:updateProgress', { percent: 98 });
  }

  const helperPath = path.join(app.getPath('temp'), `${productSlug}-mac-update-${Date.now()}.sh`);
  const script = [
    '#!/bin/bash',
    'set +e',
    'sleep 2',
    `OLD_APP='${installedApp}'`,
    `NEW_APP='${extractedAppPath}'`,
    `TMP_DIR='${tmpDir}'`,
    `INSTALL_PARENT='${installParent}'`,
    'rm -rf "$OLD_APP"',
    'if [ $? -ne 0 ]; then',
    '  echo "update failed: could not remove old app at $OLD_APP" >&2',
    '  exit 1',
    'fi',
    'mv "$NEW_APP" "$OLD_APP"',
    'if [ $? -ne 0 ]; then',
    '  echo "update failed: could not move new app into $INSTALL_PARENT" >&2',
    '  exit 1',
    'fi',
    'xattr -cr "$OLD_APP" 2>/dev/null',
    'codesign --force --deep --sign - "$OLD_APP" 2>/dev/null',
    'open "$OLD_APP"',
    'rm -rf "$TMP_DIR"',
    'rm -- "$0"',
    '',
  ].join('\n');
  fs.writeFileSync(helperPath, script, { encoding: 'utf8', mode: 0o755 });

  log.info('helper script written', { helperPath, oldApp: installedApp, newApp: extractedAppPath });

  spawn('/bin/bash', [helperPath], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  log.info('helper spawned, exiting');

  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('app:updateDownloaded', { mode: 'portable', version });
  }

  setTimeout(() => app.quit(), 400);
}

module.exports = { isMacPackaged, checkForUpdates, downloadAndApply };
