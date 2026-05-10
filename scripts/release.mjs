#!/usr/bin/env node
// INKTTS release helper:
//   1. รับ argv (เช่น 0.2.0) หรือ bump patch อัตโนมัติ
//   2. แก้ version ใน package.json + .app/shell/package.json
//   3. commit + tag + push (push tag จะ trigger GitHub Actions release.yml)
//
// Usage:
//   pnpm release           → bump patch (1.0.0 → 1.0.1)
//   pnpm release 1.2.0     → set explicit version
//   pnpm release minor     → bump minor (1.0.5 → 1.1.0)
//   pnpm release major     → bump major (1.5.0 → 2.0.0)

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const FILES = [
  resolve(ROOT, 'package.json'),
  resolve(ROOT, '.app/shell/package.json'),
];

function parseArg(arg, current) {
  if (!arg || arg === 'patch') return bump(current, 2);
  if (arg === 'minor') return bump(current, 1);
  if (arg === 'major') return bump(current, 0);
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg;
  throw new Error(`รูปแบบเวอร์ชันไม่ถูก: ${arg} (ใช้ x.y.z หรือ patch/minor/major)`);
}

function bump(current, idx) {
  const parts = current.split('.').map((n) => parseInt(n, 10));
  parts[idx] += 1;
  for (let i = idx + 1; i < parts.length; i += 1) parts[i] = 0;
  return parts.join('.');
}

function readVersion(file) {
  return JSON.parse(readFileSync(file, 'utf-8')).version;
}

// rewrite version field — ใช้ JSON.parse/stringify เพื่อกัน edge case ของ regex
// detect indentation จากไฟล์เดิม → preserve formatting หลัง stringify
function writeVersion(file, version) {
  const raw = readFileSync(file, 'utf-8');
  const data = JSON.parse(raw);
  if (data.version === version) return;
  data.version = version;
  const indentMatch = raw.match(/\n([ \t]+)"/);
  const indent = indentMatch ? indentMatch[1] : '  ';
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(file, JSON.stringify(data, null, indent) + trailingNewline, 'utf-8');
}

function verifyVersionWritten(file, expected) {
  const v = readVersion(file);
  if (v !== expected) throw new Error(`เขียน version ไม่สำเร็จใน ${file}: คาด ${expected} ได้ ${v}`);
}

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

// ตรวจ version ของทั้ง 2 ไฟล์ — ต้องตรงกันก่อน bump
const versions = FILES.map((f) => ({ file: f, version: readVersion(f) }));
const distinct = [...new Set(versions.map((v) => v.version))];
if (distinct.length > 1) {
  console.error('version ไม่ตรงกันระหว่างไฟล์ — แก้ให้ตรงก่อน:');
  for (const v of versions) console.error(`  ${v.file} = ${v.version}`);
  process.exit(1);
}

const current = versions[0].version;
const next = parseArg(process.argv[2], current);

if (next === current) {
  console.error(`เวอร์ชันเดิมแล้ว (${current}) — ระบุเวอร์ชันใหม่`);
  process.exit(1);
}

// ตรวจ tag ซ้ำ
try {
  const existing = execSync(`git tag --list v${next}`, { cwd: ROOT, encoding: 'utf-8' }).trim();
  if (existing) {
    console.error(`tag v${next} มีอยู่แล้ว — ลบก่อน หรือใช้เวอร์ชันใหม่กว่า`);
    process.exit(1);
  }
} catch { /* git tag --list ไม่ fail เมื่อไม่มี tag */ }

console.log(`\nbump: ${current} → ${next}\n`);

// ตรวจ git tree สะอาด
try {
  const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' });
  const dirty = status
    .split('\n')
    .filter((l) => l.trim())
    .filter((l) => {
      const filePath = l.slice(3).replace(/\\/g, '/');
      // อนุญาต .old/ (legacy reference) — ไม่ต้องสะอาด
      if (filePath.startsWith('.old/')) return false;
      return true;
    });
  if (dirty.length > 0) {
    console.error('git tree ไม่สะอาด — commit หรือ stash ก่อน:');
    console.error(dirty.join('\n'));
    process.exit(1);
  }
} catch (err) {
  console.error('ไม่สามารถตรวจ git status:', err.message);
  process.exit(1);
}

// แก้ version ทุกไฟล์ + verify
for (const f of FILES) {
  writeVersion(f, next);
  verifyVersionWritten(f, next);
  console.log(`  updated ${f}`);
}

// commit + tag + push
run(`git add ${FILES.map((f) => `"${f}"`).join(' ')}`);
run(`git commit -m "chore: release v${next}"`);
run(`git tag v${next}`);
run('git push');
run(`git push origin v${next}`);

console.log(`\n✓ Released v${next}`);
console.log('  → GitHub Actions กำลัง build... ดูที่ https://github.com/snibzyz/inktts/actions');
console.log('  → เมื่อเสร็จไฟล์จะอยู่ที่ https://github.com/snibzyz/inktts/releases');
console.log('  → ตรวจสถานะอัตโนมัติ: pnpm verify:release');
