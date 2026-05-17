// afterSign hook — รัน หลัง electron-builder ad-hoc sign บน mac
//
// ปัญหาที่แก้: ad-hoc signed app บน Apple Silicon + quarantine xattr
// → "is damaged and can't be opened" (ไม่มีปุ่ม Open)
//
// แก้ด้วย deep sign ทับอีกครั้ง → ครอบคลุม native modules (msedge-tts ws, ฯลฯ)
// → ลดเคส signature integrity fail
//
// quarantine xattr ถูกใส่ตอนผู้ใช้โหลด DMG (Safari/Finder) — ไม่ใช่ตอน build
// ผู้ใช้ต้อง `xattr -cr /Applications/INKTTS.app` ถ้ายังเจอ "damaged" หลังติดตั้ง
// (ดู Mac install section ใน README.md)

const { execSync } = require('node:child_process');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productName}.app`;

  console.log(`[afterSign] re-applying ad-hoc deep sign to ${appPath}`);
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' });
    console.log('[afterSign] deep sign + verify success');
  } catch (err) {
    console.error('[afterSign] codesign failed:', err.message);
    // ไม่ throw — ให้ build ดำเนินต่อได้
  }
};
