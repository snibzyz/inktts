// Global error bus — รวบรวม error ทุกตัวจากทั่วแอป → store.errors[]
//
// API:
//   reportError({ source, message, details? })   → toast + เก็บใน inbox
//   buildErrorReport(entry)                       → string พร้อม paste ส่ง admin
//   buildAllErrorsReport()                        → รวมทุก error ใน session
//
// เรียกได้จาก React component หรือ effect handler — ไม่ผูกกับ component lifecycle

import { useStore, type ErrorEntry } from '@/state/store';

export interface ReportErrorOptions {
  source: string;
  message: string;
  details?: string | object | unknown;
}

/** push 1 error เข้า store + ติด toast — return id ของ entry ที่สร้าง */
export function reportError(opts: ReportErrorOptions): void {
  const detailsStr = formatDetails(opts.details);
  useStore.getState().addError({
    source: opts.source,
    message: opts.message,
    details: detailsStr,
  });
  // console เผื่อ user เปิด devtools เห็นเลย
  try {
    // eslint-disable-next-line no-console
    console.error(`[${opts.source}] ${opts.message}`, opts.details ?? '');
  } catch { /* noop */ }
}

function formatDetails(d: unknown): string | undefined {
  if (d == null) return undefined;
  if (typeof d === 'string') return d;
  if (d instanceof Error) {
    return d.stack || `${d.name}: ${d.message}`;
  }
  try {
    return JSON.stringify(d, null, 2);
  } catch {
    return String(d);
  }
}

/** สร้างข้อความรายงาน 1 error — สำหรับ user copy ส่ง admin */
export function buildErrorReport(entry: ErrorEntry): string {
  const lines: string[] = [
    `INKTTS Error — ${new Date(entry.ts).toISOString()}`,
    `Source: ${entry.source}`,
    `Message: ${entry.message}`,
  ];
  if (entry.details) {
    lines.push('');
    lines.push('Details:');
    lines.push(entry.details);
  }
  return lines.join('\n');
}

/** รวม error ทั้ง session + diagnostics ของระบบ — สำหรับ "ส่งทั้งหมด" */
export async function buildAllErrorsReport(): Promise<string> {
  const errors = useStore.getState().errors;
  const version = window.inktts?.app?.version || '?';
  const platform = window.inktts?.platform || '?';
  let diagBlock = '';
  try {
    const diag = await window.inktts.app.diagnostics();
    diagBlock = [
      '== System ==',
      `version:    ${diag.version}`,
      `platform:   ${diag.platform} ${diag.arch} (${diag.osRelease})`,
      `electron:   ${diag.electron}`,
      `packaged:   ${diag.isPackaged}${diag.portable ? ' (portable)' : ''}`,
      `userData:   ${diag.userData}`,
      `logPath:    ${diag.logPath || '(unavailable)'}`,
      '',
      '== ffmpeg ==',
      `path:   ${diag.ffmpeg.path || '(null)'}`,
      `exists: ${diag.ffmpeg.exists}`,
      `size:   ${diag.ffmpeg.size}`,
      '',
    ].join('\n');
  } catch (err: any) {
    diagBlock = `== diagnostics failed: ${err?.message || err} ==\n\n`;
  }

  const head = [
    `INKTTS All Errors Report — ${new Date().toISOString()}`,
    `Session: ${errors.length} error(s)`,
    `version: ${version}, platform: ${platform}`,
    '',
    diagBlock,
    '== Errors (newest first) ==',
    '',
  ].join('\n');

  if (!errors.length) return head + '(ไม่มี error ใน session นี้)';

  const body = errors
    .map((e, i) => {
      const lines = [
        `--- [${i + 1}/${errors.length}] ${new Date(e.ts).toISOString()} ---`,
        `Source: ${e.source}`,
        `Message: ${e.message}`,
      ];
      if (e.details) {
        lines.push('Details:');
        lines.push(e.details);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return head + body;
}

/** copy ข้อความไป clipboard ผ่าน main process (ปลอดภัยกว่า navigator.clipboard ใน Electron) */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const r = await window.inktts.app.copyToClipboard(text);
    return !!r?.ok;
  } catch {
    // fallback — navigator (renderer)
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
