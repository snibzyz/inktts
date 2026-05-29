#!/usr/bin/env node
// Verify post-release: poll GitHub Actions workflow + ตรวจ assets
//
// Usage:
//   pnpm verify:release           → ใช้ tag ล่าสุดในเครื่อง
//   pnpm verify:release v1.2.3    → ระบุ tag

import { readFileSync } from 'node:fs';
import https from 'node:https';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPO = process.env.INKTTS_REPO || 'snibzyz/inktts';
const WORKFLOW_FILE = 'release.yml';

function fetchJson(url, headers = {}) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'inktts-verify',
        'Accept': 'application/vnd.github+json',
        ...headers,
      },
    }, (r) => {
      let body = '';
      r.on('data', (c) => { body += c.toString('utf-8'); });
      r.on('end', () => {
        if (r.statusCode >= 400) {
          rej(new Error(`HTTP ${r.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try { res(JSON.parse(body)); } catch (e) { rej(e); }
      });
    });
    req.on('error', rej);
    req.end();
  });
}

async function getTag() {
  if (process.argv[2]) return process.argv[2];
  const v = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
  return `v${v}`;
}

async function pollWorkflow(tag) {
  const headers = process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {};
  console.log(`[1/2] รอ GitHub Actions workflow ของ ${tag} จบ...`);
  const start = Date.now();
  const maxMs = 30 * 60 * 1000; // 30 min
  // กรองเฉพาะ workflow release.yml + tag ที่ตรง — กัน match runs ของ workflow อื่น
  const runsUrl = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=10&event=push`;
  while (Date.now() - start < maxMs) {
    const list = await fetchJson(runsUrl, headers);
    const run = list.workflow_runs?.find((r) => r.head_branch === tag);
    if (!run) {
      process.stdout.write('.');
      await sleep(15000);
      continue;
    }
    if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        console.log(`\n  ✓ workflow success (${run.html_url})`);
        return run;
      }
      console.error(`\n  ✗ workflow ${run.conclusion} (${run.html_url})`);
      process.exit(1);
    }
    process.stdout.write(`[${run.status}]`);
    await sleep(15000);
  }
  console.error('\n  ✗ timeout — workflow ยังไม่จบใน 30 นาที');
  process.exit(1);
}

async function verifyAssets(tag) {
  console.log(`\n[2/2] ตรวจ release assets ของ ${tag}...`);
  const headers = process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {};
  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, headers);
  const assetNames = (release.assets || []).map((a) => a.name);
  const ver = tag.replace(/^v/, '');
  const required = [
    new RegExp(`^INKTTS-Setup-${ver}\\.exe$`),
    new RegExp(`^INKTTS-Portable-${ver}\\.exe$`),
    /^latest\.yml$/,
  ];
  let ok = true;
  for (const re of required) {
    const found = assetNames.find((n) => re.test(n));
    if (found) console.log(`  ✓ ${found}`);
    else { console.error(`  ✗ ขาด ${re}`); ok = false; }
  }
  if (!ok) process.exit(1);
  console.log(`\n✓ release พร้อมใช้: ${release.html_url}`);
  console.log('  → ผู้ใช้ทั้ง Setup (NSIS) และ Portable จะตรวจเจอ + อัปเดตอัตโนมัติภายใน 30 นาที');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const tag = await getTag();
await pollWorkflow(tag);
await verifyAssets(tag);
