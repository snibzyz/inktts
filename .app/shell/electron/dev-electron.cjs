// dev-electron.cjs — launcher สำหรับ `pnpm dev:electron`
//
// ทำไมต้องมีไฟล์นี้แทนที่จะเรียก `electron .` ตรง ๆ:
//   VS Code / Code Runner (ตัวมันเองเป็น Electron) เซ็ต ELECTRON_RUN_AS_NODE=1
//   ไว้ใน integrated terminal แล้ว leak ลงมาที่ลูก process. ถ้า env นี้ติดมา
//   `electron .` จะรันเป็น "node ธรรมดา" → `require('electron')` คืน path string
//   แทน module object → `app` undefined → crash ที่ main.cjs:
//     "Cannot read properties of undefined (reading 'isPackaged')"
//
//   Electron ถือว่า "มีตัวแปรนี้อยู่" = เปิดโหมด run-as-node เสมอ ไม่ว่าค่าจะเป็น
//   '', '0' หรืออะไรก็ตาม — cross-env เซ็ตค่าได้แต่ลบตัวแปรไม่ได้ จึงต้อง spawn เอง
//   โดย strip ตัวแปรนี้ออกจาก env ของลูกก่อนเปิด electron.exe
const { spawn } = require('node:child_process');

const env = { ...process.env, NODE_ENV: 'development' };
delete env.ELECTRON_RUN_AS_NODE;

// รันจาก context ของ node ธรรมดา → require('electron') คืน absolute path ของ
// electron.exe ซึ่งคือสิ่งที่เราต้องการ spawn พอดี
const electronExe = require('electron');

const child = spawn(electronExe, ['.'], { stdio: 'inherit', env, windowsHide: false });
child.on('close', (code) => process.exit(code == null ? 1 : code));
child.on('error', (err) => {
  console.error('[dev-electron] เปิด electron ไม่สำเร็จ:', err && err.message);
  process.exit(1);
});
