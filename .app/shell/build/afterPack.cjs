// afterPack hook — รัน หลัง electron-builder แตก asar เสร็จ ก่อน sign
//
// แก้ปัญหา: ffmpeg-static binary บน mac บางครั้งโดน strip exec bit
//          ตอน extract จาก asar.unpacked → spawn ไม่ได้ → "ffmpeg not bundled"
//          (มีผลกับ rendering/merge เสียงบน mac เท่านั้น — Windows ไม่กระทบ)
//
// fix: หา ffmpeg binary ใน unpacked location → chmod 0o755 ให้แน่ใจว่ารันได้
//      ทำกับทุก platform (linux ก็มี issue คล้ายกัน) — Windows ข้าม

const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') return;

  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName;

  // mac: <appOutDir>/INKTTS.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg
  // linux: <appOutDir>/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg
  const macPath = path.join(
    appOutDir,
    `${context.packager.appInfo.productName}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'ffmpeg-static',
    'ffmpeg'
  );
  const linuxPath = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'ffmpeg-static',
    'ffmpeg'
  );
  const candidates = platform === 'darwin' ? [macPath] : [linuxPath];

  for (const ffmpegPath of candidates) {
    if (!fs.existsSync(ffmpegPath)) {
      console.warn(`[afterPack] ffmpeg not found at ${ffmpegPath} — skip chmod`);
      continue;
    }
    try {
      fs.chmodSync(ffmpegPath, 0o755);
      console.log(`[afterPack] chmod +x ${ffmpegPath}`);
    } catch (err) {
      console.error(`[afterPack] chmod failed for ${ffmpegPath}:`, err.message);
    }
  }
};
