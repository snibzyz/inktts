// Queue engine — รันงาน TTS หลาย "เรื่อง" (queue items) แบบ "เรียงทีละเรื่อง"
// (sequential เท่านั้น — ไม่รันพร้อมกัน เพื่อกัน rate-limit เพราะแต่ละเรื่องกิน
//  connection พร้อมกันเยอะอยู่แล้ว)
//
// แต่ละ item เก็บ config ครบในตัว: name + service + preset(batch/conn) + runOptions
// (engine opts ที่ renderer build จาก fieldValues ไว้แล้ว) + inputDir + outputDir
//
// ฟีเจอร์:
//   - scheduler `tick()` หยิบ item สถานะ 'queued' ตัวถัดไปมารัน ทีละตัว
//   - แจ้งเตือนเมื่อโดน throttle (จับจาก event 'limit' kind='shrink' ของ AdaptiveLimiter)
//   - auto-retry: จบแล้วถ้ามีไฟล์ fail → รันซ้ำ item เดิม (runner skip ไฟล์ที่ output มีแล้ว
//     = resume เฉพาะตัวที่ fail) สูงสุด MAX_AUTO_RETRIES รอบ + backoff (นานขึ้นถ้าโดน throttle)
//   - persist ลง userData/queue.json — เปิดแอปใหม่คิวยังอยู่ (งานที่ค้าง→กลับเป็น 'queued')
//
// architecture เลียนแบบ INKCRAW (engine อยู่ main process, sync กลับ renderer ผ่าน IPC)

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { TTSJob } = require('./runner.cjs');
const { createLogger } = require('../helpers/logger.cjs');

const log = createLogger('queue');

const MAX_AUTO_RETRIES = 3;
// backoff ฐาน (ms) ต่อรอบ retry — ×retryCount และ ×3 ถ้าโดน throttle
const RETRY_BACKOFF_MS = 5000;
const THROTTLE_BACKOFF_MS = 15000;

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const TERMINAL_STATUSES = new Set(['done', 'done-with-errors', 'failed', 'cancelled']);

let state = { items: [] };
let jobSeq = 0;

// runtime (ไม่ persist)
let activeJob = null;        // TTSJob ที่กำลังรัน
let activeItemId = null;     // id ของ item ที่ active (รวมช่วง backoff ระหว่าง retry)
let activeRetryCancel = null; // ฟังก์ชันยกเลิก backoff sleep (ระหว่างรอ retry)
const itemByJobId = new Map();

// callbacks ตั้งจาก ipc layer
let emitUpdate = () => {};   // (evt) => void   — { type:'snapshot'|'item', ... }
let emitLog = () => {};      // ({ itemId, level, message, ts }) => void
let emitNotice = () => {};   // ({ itemId, kind, message }) => void  (สำหรับ toast)

// ───────────────────────── persistence ─────────────────────────

function queueFile() {
  return path.join(app.getPath('userData'), 'queue.json');
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const persist = {
        version: 1,
        items: state.items.map((it) => ({
          ...it,
          // runtime fields ไม่ persist — งานที่ค้างจะ reset เป็น queued ตอนโหลด
          jobId: null,
          throttled: false,
        })),
      };
      const file = queueFile();
      const tmp = `${file}.tmp`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(persist, null, 2), 'utf-8');
      fs.renameSync(tmp, file);
    } catch (err) {
      log.warn('save failed', { error: err && err.message });
    }
  }, 250);
}

function loadFromDisk() {
  try {
    const file = queueFile();
    if (!fs.existsSync(file)) { state = { items: [] }; return; }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const items = Array.isArray(data?.items) ? data.items : [];
    state = {
      items: items.map((it) => ({
        ...it,
        jobId: null,
        throttled: false,
        // งานที่ค้างตอนปิดแอป (running/queued) → reset เป็น idle ให้ user กดเริ่มเอง
        status: ACTIVE_STATUSES.has(it.status) ? 'idle' : (it.status || 'idle'),
      })),
    };
  } catch (err) {
    log.warn('load failed — empty queue', { error: err && err.message });
    state = { items: [] };
  }
}

// ───────────────────────── helpers ─────────────────────────

function now() { return Date.now(); }

function touch(item) { item.updatedAt = now(); }

function emitItem(item) { emitUpdate({ type: 'item', item: stripRuntime(item) }); }

function emitSnapshot() { emitUpdate({ type: 'snapshot', items: state.items.map(stripRuntime) }); }

function logItem(item, level, message) {
  emitLog({ itemId: item.id, level, message, ts: now() });
}

function findItem(id) { return state.items.find((it) => it.id === id); }

function setStatus(item, status, patch = {}) {
  item.status = status;
  Object.assign(item, patch);
  if (TERMINAL_STATUSES.has(status)) item.endedAt = now();
  touch(item);
  emitItem(item);
}

// บันทึกเวลาที่ใช้ของไฟล์ (ตอน) นั้น ๆ — เรียกตอนไฟล์ถึงสถานะสุดท้าย
function recordFileTime(item, base) {
  const start = item._fileStart && item._fileStart[base];
  if (!start) return;
  const sec = Math.max(0, Math.round((now() - start) / 1000));
  const arr = item.times || (item.times = []);
  const existing = arr.find((t) => t.base === base);
  if (existing) existing.sec = sec;
  else arr.push({ base, sec });
  delete item._fileStart[base];
}

// list ไฟล์ .txt ในโฟลเดอร์ (เรียงตามชื่อ)
function listTxt(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch { return []; }
}

// input ของเรื่อง = เลือกได้ทั้ง "ไฟล์รายตัว" (inputFiles) หรือ "ทั้งโฟลเดอร์" (inputDir)
// ถ้ามี inputFiles ใช้ตามนั้น (กรองเฉพาะ .txt ที่ยังอยู่จริง), ไม่งั้น list ทั้งโฟลเดอร์
function resolveFiles(item) {
  if (Array.isArray(item.inputFiles) && item.inputFiles.length) {
    return item.inputFiles.filter((f) => {
      try { return fs.statSync(f).isFile() && f.toLowerCase().endsWith('.txt'); }
      catch { return false; }
    });
  }
  return listTxt(item.inputDir);
}

function hasInput(item) {
  return (Array.isArray(item.inputFiles) && item.inputFiles.length > 0) || !!item.inputDir;
}

function sleepCancellable(ms) {
  let cancel;
  const promise = new Promise((resolve) => {
    const t = setTimeout(() => { cancel = null; resolve('done'); }, ms);
    cancel = () => { clearTimeout(t); cancel = null; resolve('cancelled'); };
  });
  return { promise, cancel: () => cancel && cancel() };
}

// ───────────────────────── job event handling ─────────────────────────

function onJobEvent(item, evt) {
  if (!evt || evt.jobId !== item.jobId) return;
  switch (evt.type) {
    case 'start':
      item.progress.current = evt.fileBase;
      item._fileStart[evt.fileBase] = now(); // เริ่มจับเวลาตอนนี้
      emitItem(item);
      break;
    case 'prog': {
      const s = evt.status;
      if (s === 'WORK' || s === 'PENDING') {
        item.progress.current = evt.fileBase;
      } else if (s === 'DONE' || s === 'SKIP' || s === 'EMPTY') {
        item._doneSet.add(evt.fileBase);
        item._failSet.delete(evt.fileBase);
        recordFileTime(item, evt.fileBase);
      } else if (s === 'FAIL' || s === 'FFMPEG_FAIL') {
        item._failSet.add(evt.fileBase);
        item._doneSet.delete(evt.fileBase);
        recordFileTime(item, evt.fileBase);
      }
      item.progress.done = item._doneSet.size;
      item.progress.fail = item._failSet.size;
      emitItem(item);
      break;
    }
    case 'limit': {
      // AdaptiveLimiter หดเพดาน = โดน throttle/429 → แจ้งเตือน
      if (evt.kind === 'shrink' && !item.throttled) {
        item.throttled = true;
        logItem(item, 'warn', `โดนจำกัดเรท (throttle) — ลดความเร็วชั่วคราว ${evt.old}→${evt.new}`);
        emitNotice({ itemId: item.id, kind: 'throttle', message: `"${item.name}" โดนจำกัดเรท — ระบบลดความเร็วให้อัตโนมัติ` });
        emitItem(item);
      } else if (evt.kind === 'grow' && item.throttled && evt.new >= evt.initial) {
        item.throttled = false;
        logItem(item, 'info', `กลับมาความเร็วปกติแล้ว (${evt.new})`);
        emitItem(item);
      }
      break;
    }
    case 'log':
      logItem(item, evt.level || 'info', evt.message || '');
      break;
    case 'error':
      item.error = evt.message || 'job error';
      logItem(item, 'error', item.error);
      break;
    default:
      break;
  }
}

// ───────────────────────── launch / scheduler ─────────────────────────

async function launch(item) {
  const files = resolveFiles(item);
  if (!files.length) {
    setStatus(item, 'failed', { error: 'ไม่พบไฟล์ .txt ต้นทาง' });
    logItem(item, 'error', `ไม่พบไฟล์ .txt (${item.inputDir || (item.inputFiles || []).length + ' ไฟล์ที่เลือก'})`);
    emitNotice({ itemId: item.id, kind: 'failed', message: `"${item.name}" ไม่พบไฟล์ .txt ต้นทาง` });
    finishActive();
    return;
  }

  const jobId = `q-${item.id}-${++jobSeq}`;
  item.jobId = jobId;
  item.throttled = false;
  item._doneSet = item._doneSet || new Set();
  item._failSet = new Set();
  item._fileStart = item._fileStart || {};
  if (!item.startedAt) item.startedAt = now(); // ครั้งแรกที่เริ่มรัน (คงไว้ข้าม retry)
  item.endedAt = null;
  item.progress = { done: 0, fail: 0, total: files.length, current: null };
  setStatus(item, 'running');
  logItem(item, 'info', `เริ่มเรื่อง "${item.name}" — ${files.length} ไฟล์ (${item.service})${item.retryCount ? ` · ลองใหม่รอบ ${item.retryCount}` : ''}`);

  const job = new TTSJob({
    jobId,
    serviceKey: item.service,
    files,
    options: { ...item.runOptions, outputDir: item.outputDir, fmt: 'm4a' },
    onEvent: (evt) => onJobEvent(item, evt),
  });
  activeJob = job;
  activeItemId = item.id;
  itemByJobId.set(jobId, item.id);

  let stats = null;
  let cancelled = false;
  try {
    stats = await job.run();
    cancelled = job.cancelled;
  } catch (err) {
    log.error('job run failed', { itemId: item.id, error: err && err.message });
    item.error = err && err.message;
    logItem(item, 'error', `งานล้มเหลว: ${item.error}`);
  } finally {
    itemByJobId.delete(jobId);
    item.jobId = null;
  }

  // ── completion ──
  if (cancelled) {
    item.progress.current = null;
    setStatus(item, 'cancelled');
    finishActive();
    return;
  }

  const failCount = stats ? stats.filesFailed : files.length;
  if (failCount > 0 && item.retryCount < MAX_AUTO_RETRIES) {
    item.retryCount += 1;
    const backoff = (item.throttled ? THROTTLE_BACKOFF_MS : RETRY_BACKOFF_MS) * item.retryCount;
    logItem(item, 'warn', `ลองใหม่อัตโนมัติรอบ ${item.retryCount}/${MAX_AUTO_RETRIES} (ล้มเหลว ${failCount} ไฟล์) — รอ ${Math.round(backoff / 1000)} วิ`);
    emitNotice({ itemId: item.id, kind: 'retry', message: `"${item.name}" ล้มเหลว ${failCount} ไฟล์ — ลองใหม่อัตโนมัติ (รอบ ${item.retryCount})` });
    item.progress.current = null;
    setStatus(item, 'running');

    const sleeper = sleepCancellable(backoff);
    activeRetryCancel = sleeper.cancel;
    const r = await sleeper.promise;
    activeRetryCancel = null;
    // ถ้าโดนสั่งยกเลิกระหว่างรอ backoff
    if (r === 'cancelled' || item.status === 'cancelled') {
      if (item.status !== 'cancelled') setStatus(item, 'cancelled');
      finishActive();
      return;
    }
    return launch(item); // retry — runner resume เฉพาะไฟล์ที่ยัง fail
  }

  if (failCount > 0) {
    setStatus(item, 'done-with-errors', { error: `ล้มเหลว ${failCount} ไฟล์ (ลองใหม่แล้ว ${item.retryCount} รอบ)` });
    emitNotice({ itemId: item.id, kind: 'done-with-errors', message: `"${item.name}" เสร็จแบบมีบางไฟล์ล้มเหลว (${failCount})` });
  } else {
    setStatus(item, 'done', { error: null });
    emitNotice({ itemId: item.id, kind: 'done', message: `"${item.name}" แปลงเสร็จแล้ว (${item.progress.done} ไฟล์)` });
  }
  item.progress.current = null;
  emitItem(item);
  finishActive();
}

function finishActive() {
  activeJob = null;
  activeItemId = null;
  activeRetryCancel = null;
  scheduleSave();
  tick();
}

// scheduler: รันทีละเรื่อง — ถ้าไม่มีงาน active และมี item 'queued' → launch ตัวแรก
function tick() {
  if (activeJob || activeItemId) return; // มีงานรันอยู่ (sequential)
  const next = state.items.find((it) => it.status === 'queued');
  if (!next) return;
  launch(next);
}

// ───────────────────────── public API (เรียกจาก ipc) ─────────────────────────

function init({ onUpdate, onLog, onNotice }) {
  emitUpdate = onUpdate || (() => {});
  emitLog = onLog || (() => {});
  emitNotice = onNotice || (() => {});
  loadFromDisk();
}

function snapshot() {
  return { items: state.items.map(stripRuntime) };
}

// ส่งให้ renderer โดยตัด field _doneSet/_failSet (Set serialize ไม่ได้)
function stripRuntime(it) {
  const { _doneSet, _failSet, _fileStart, ...rest } = it;
  return rest;
}

function addItem(input) {
  const id = `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const item = {
    id,
    name: String(input?.name || 'เรื่องใหม่').trim() || 'เรื่องใหม่',
    service: input?.service || 'edge',
    presetIdx: Number(input?.presetIdx) || 0,
    fieldValues: input?.fieldValues || {},
    runOptions: input?.runOptions || {},
    inputDir: input?.inputDir || '',
    inputFiles: Array.isArray(input?.inputFiles) ? input.inputFiles : [],
    outputDir: input?.outputDir || '',
    status: 'idle',
    jobId: null,
    progress: { done: 0, fail: 0, total: 0, current: null },
    retryCount: 0,
    throttled: false,
    error: null,
    // เวลา: startedAt = ตอนเริ่มรันจริงครั้งแรก (รวม retry+backoff), endedAt = ตอนจบ
    // times = เวลาแต่ละตอน (ไฟล์) แยก [{ base, sec }] — โชว์ในมุมมองกาง
    startedAt: null,
    endedAt: null,
    times: [],
    createdAt: now(),
    updatedAt: now(),
  };
  state.items.push(item);
  scheduleSave();
  emitItem(stripRuntime(item));
  return stripRuntime(item);
}

// แก้ config ของ item — อนุญาตเฉพาะตอนยังไม่รัน (idle/terminal)
function updateItem(id, patch) {
  const item = findItem(id);
  if (!item) return { ok: false, error: 'item not found' };
  if (item.status === 'running' || item.status === 'queued') {
    return { ok: false, error: 'หยุดงานก่อนแก้ไข' };
  }
  const allowed = ['name', 'service', 'presetIdx', 'fieldValues', 'runOptions', 'inputDir', 'inputFiles', 'outputDir'];
  for (const k of allowed) {
    if (patch[k] !== undefined) item[k] = patch[k];
  }
  // แก้ config แล้ว reset สถานะ/retry ให้พร้อมรันใหม่
  item.status = 'idle';
  item.error = null;
  item.retryCount = 0;
  item.progress = { done: 0, fail: 0, total: 0, current: null };
  touch(item);
  scheduleSave();
  emitItem(stripRuntime(item));
  return { ok: true };
}

function removeItem(id) {
  const item = findItem(id);
  if (!item) return { ok: false, error: 'item not found' };
  if (item.status === 'running' || (activeItemId === id)) {
    return { ok: false, error: 'หยุดงานก่อนลบ' };
  }
  state.items = state.items.filter((it) => it.id !== id);
  scheduleSave();
  emitSnapshot();
  return { ok: true };
}

function clearDone() {
  state.items = state.items.filter((it) => !TERMINAL_STATUSES.has(it.status));
  scheduleSave();
  emitSnapshot();
  return { ok: true };
}

// reorder: ย้าย item ไปตำแหน่ง index ใหม่ (drag/ปุ่มขึ้นลง)
function moveItem(id, toIndex) {
  const from = state.items.findIndex((it) => it.id === id);
  if (from < 0) return { ok: false, error: 'item not found' };
  const [it] = state.items.splice(from, 1);
  const clamped = Math.max(0, Math.min(state.items.length, Number(toIndex) || 0));
  state.items.splice(clamped, 0, it);
  scheduleSave();
  emitSnapshot();
  return { ok: true };
}

function startItem(id) {
  const item = findItem(id);
  if (!item) return { ok: false, error: 'item not found' };
  if (item.status === 'running' || item.status === 'queued') return { ok: true };
  if (!hasInput(item) || !item.outputDir) return { ok: false, error: 'ต้องเลือกไฟล์/โฟลเดอร์ต้นทาง + โฟลเดอร์ปลายทางก่อน' };
  item.retryCount = 0;
  item.error = null;
  // reset เวลา/สถิติ สำหรับรอบใหม่
  item.startedAt = null;
  item.endedAt = null;
  item.times = [];
  item._fileStart = {};
  item._doneSet = new Set();
  item._failSet = new Set();
  setStatus(item, 'queued');
  scheduleSave();
  tick();
  return { ok: true };
}

function startAll() {
  for (const item of state.items) {
    if (TERMINAL_STATUSES.has(item.status) || item.status === 'idle') {
      if (hasInput(item) && item.outputDir) {
        item.retryCount = 0;
        item.error = null;
        item.startedAt = null;
        item.endedAt = null;
        item.times = [];
        item._fileStart = {};
        item._doneSet = new Set();
        item._failSet = new Set();
        item.status = 'queued';
        touch(item);
      }
    }
  }
  emitSnapshot();
  scheduleSave();
  tick();
  return { ok: true };
}

function cancelItem(id) {
  const item = findItem(id);
  if (!item) return { ok: false, error: 'item not found' };
  if (activeItemId === id) {
    // กำลังรัน หรือกำลังรอ backoff ระหว่าง retry
    item.status = 'cancelled';
    touch(item);
    if (activeJob) activeJob.cancel();
    if (activeRetryCancel) activeRetryCancel();
    emitItem(stripRuntime(item));
  } else if (item.status === 'queued') {
    setStatus(item, 'idle'); // ยังไม่เริ่ม → ดึงออกจากคิว
  }
  return { ok: true };
}

function cancelAll() {
  // ดึงทุก item ที่ยัง queued ออก + ยกเลิกตัวที่ active
  for (const item of state.items) {
    if (item.status === 'queued') { item.status = 'idle'; touch(item); }
  }
  if (activeItemId) {
    const item = findItem(activeItemId);
    if (item) { item.status = 'cancelled'; touch(item); }
    if (activeJob) activeJob.cancel();
    if (activeRetryCancel) activeRetryCancel();
  }
  emitSnapshot();
  scheduleSave();
  return { ok: true };
}

module.exports = {
  init,
  snapshot,
  addItem,
  updateItem,
  removeItem,
  clearDone,
  moveItem,
  startItem,
  startAll,
  cancelItem,
  cancelAll,
};
