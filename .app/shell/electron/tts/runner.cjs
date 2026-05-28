// TTS orchestrator — port ของ run_batch จาก _lib.py
// per-job state, semaphores, parallel chunk fetching, ffmpeg concat, progress events

const fs = require('node:fs');
const path = require('node:path');
const { splitLines, splitChars } = require('./splitter.cjs');
const { AdaptiveLimiter, Semaphore } = require('./adaptive.cjs');
const { ffmpegConcat } = require('./ffmpeg.cjs');
const edge = require('./edge.cjs');
const google = require('./google.cjs');
const rv = require('./responsivevoice.cjs');
const { getServiceCacheDir } = require('../helpers/paths.cjs');
const { createLogger } = require('../helpers/logger.cjs');

const runnerLog = createLogger('runner');

const ENGINES = { edge, google, rv };

const safeInt = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};

function buildSplitter(serviceKey, opts) {
  const eng = ENGINES[serviceKey];
  if (eng.splitMode === 'lines') {
    const linesPerChunk = Number(opts.linesPerChunk ?? opts['lines-per-chunk'] ?? 1);
    return (text) => splitLines(text, linesPerChunk);
  }
  const chunkChars = Number(opts.chunkChars ?? opts['chunk-chars'] ?? 120);
  return (text) => splitChars(text, chunkChars);
}

function buildFetchFn(serviceKey, opts) {
  const eng = ENGINES[serviceKey];
  return (text, outPath) => eng.fetchChunk({ text, outPath, ...opts });
}

class TTSJob {
  constructor({ jobId, serviceKey, files, options, onEvent }) {
    this.jobId = jobId;
    this.serviceKey = serviceKey;
    this.files = files; // absolute paths
    this.options = options;
    this.onEvent = onEvent || (() => {});
    this.cancelled = false;
    this.startTime = Date.now();
    this.stats = { totalFiles: files.length, filesDone: 0, filesFailed: 0, filesSkipped: 0, chunksDone: 0, chunksTotal: 0 };
    // เก็บ ref limiter/semaphore ทั้งหมดที่ active เพื่อ abort ตอน cancel
    this._activeLimiters = new Set();
    // wakers สำหรับ cancellable sleep — cancel() จะ reject ทุก sleep ที่ค้าง
    // → กด Stop ตอน backoff (สูงสุด 32 วิ) ก็หยุดทันที ไม่ต้องรอจบรอบ
    this._sleepWakers = new Set();
    // watchdog intervals — cross-check ว่า output file โผล่ขึ้นมาแล้วหรือยัง
    // (เคส: chunks ค้าง แต่ ffmpeg ของ run ก่อนเคย concat เสร็จ → file มี → ไม่ต้องค้าง)
    this._activeWatchdogs = new Set();
  }

  emit(type, data) {
    this.onEvent({ jobId: this.jobId, type, ...data });
  }

  prog(fileBase, status, done, total, error, details) {
    // error: เฉพาะ FAIL / FFMPEG_FAIL — string สั้นๆ บอก root cause
    // details: optional structured object (e.g., ffmpeg argv + stderr + path) สำหรับ Error Inbox
    // UI ใช้สำหรับโชว์ tooltip + ปุ่ม "คัดลอกรายงานปัญหา"
    this.emit('prog', {
      fileBase, status, done, total,
      ...(error ? { error } : {}),
      ...(details ? { details } : {}),
    });
  }

  start(fileBase) {
    this.emit('start', { fileBase });
  }

  log(level, message) {
    this.emit('log', { level, message });
  }

  cancel() {
    this.cancelled = true;
    // ปลุก waiter ในทุก semaphore/limiter ที่ยังค้าง → fetchOne รับ CancelledError
    // → flag chunk fail → Promise.all จบ → ไม่ค้างยาวเมื่อ cap shrink มาก
    for (const lim of this._activeLimiters) {
      try { lim.abort(); } catch { /* noop */ }
    }
    // ปลุก backoff sleep ทุกตัว → _fetchWithRetry รับ throw → catch ที่ fetchOne
    // → ไม่งั้น cancel ตอน sleep ระหว่าง retry รอบสุดท้าย = รอ 32 วินาที
    for (const wake of this._sleepWakers) {
      try { wake(); } catch { /* noop */ }
    }
    this._sleepWakers.clear();
    // หยุด watchdog ที่ poll output file
    for (const w of this._activeWatchdogs) {
      try { clearInterval(w); } catch { /* noop */ }
    }
    this._activeWatchdogs.clear();
  }

  // sleep ที่ cancel ปลุกได้ — register waker ไว้ใน job แล้ว cancel() เรียก wake() เพื่อ reject
  _sleep(ms) {
    if (this.cancelled) return Promise.reject(new Error('cancelled'));
    return new Promise((resolve, reject) => {
      let waker;
      const t = setTimeout(() => {
        this._sleepWakers.delete(waker);
        resolve();
      }, ms);
      waker = () => {
        clearTimeout(t);
        this._sleepWakers.delete(waker);
        reject(new Error('cancelled'));
      };
      this._sleepWakers.add(waker);
    });
  }

  async _prepareFile(inputPath, splitFn) {
    const base = path.basename(inputPath, path.extname(inputPath));
    const fmt = this.options.fmt || 'm4a';
    const outputDir = this.options.outputDir;
    // Shared workdir — ทุก instance อ่านเขียนที่เดียวกัน
    // chunks เขียนด้วย temp+rename (ใน engine แต่ละตัว) → ไม่มี mid-write collision
    // chunks ที่ทำไว้แล้วถูก existsSync เช็คใน fetchOne → skip (= auto-resume)
    const workdir = path.join(getServiceCacheDir(this.serviceKey), base);
    const outputPath = path.join(outputDir, `${base}.${fmt}`);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
      this.stats.filesSkipped += 1;
      // output มีแล้ว = SKIP → chunks ที่ค้างเป็น stale leftover ไม่มีประโยชน์ลบทิ้ง
      // กัน cache aliasing ตอน user รันใหม่ด้วยชื่อไฟล์เดิมแต่เนื้อหาใหม่
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* noop */ }
      this.prog(base, 'SKIP', 1, 1);
      return null;
    }
    // เคลียร์ partial leftover ใน output dir (ffmpeg เขียน <base>.partial-<token>.m4a)
    // ที่อาจค้างจากครั้งก่อน power loss/kill กลาง concat
    try {
      const prefix = `${base}.partial-`;
      for (const ent of fs.readdirSync(outputDir)) {
        if (ent.startsWith(prefix) && ent.endsWith(`.${fmt}`)) {
          try { fs.unlinkSync(path.join(outputDir, ent)); } catch { /* noop */ }
        }
      }
    } catch { /* noop */ }
    let text;
    try {
      text = fs.readFileSync(inputPath, 'utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
    } catch (err) {
      this.stats.filesFailed += 1;
      this.log('error', `read ${base}: ${err.message}`);
      this.prog(base, 'FAIL', 0, 0);
      return null;
    }
    if (!text) {
      this.stats.filesSkipped += 1;
      this.prog(base, 'EMPTY', 0, 0);
      return null;
    }
    const chunks = splitFn(text);
    if (!chunks.length) {
      this.stats.filesSkipped += 1;
      this.prog(base, 'EMPTY', 0, 0);
      return null;
    }
    this.stats.chunksTotal += chunks.length;
    fs.mkdirSync(workdir, { recursive: true });
    // เคลียร์ tmp leftover จาก crash/power loss ครั้งก่อน (`.tmp` / `.partial`)
    // ไฟล์ .mp3 ที่เสร็จไว้ปล่อยไว้ — fetchOne จะ existsSync เจอแล้ว skip = resume
    try {
      for (const ent of fs.readdirSync(workdir)) {
        if (ent.endsWith('.tmp') || ent.endsWith('.partial')) {
          try { fs.unlinkSync(path.join(workdir, ent)); } catch { /* noop */ }
        }
      }
    } catch { /* noop */ }
    const chunkPaths = chunks.map((_, i) => path.join(workdir, `${String(i).padStart(6, '0')}.mp3`));
    // นับ cache hit/miss ตั้งแต่ prepare เพื่อ log scenario "chunks อยู่แล้ว แค่รวม"
    // (= existsSync + size > 1KB → fetchOne จะข้าม ไม่เรียก fetchFn)
    let cachedCount = 0;
    for (const cp of chunkPaths) {
      try {
        if (fs.statSync(cp).size > 1024) cachedCount += 1;
      } catch { /* noop */ }
    }
    // PENDING = รอคิว (มี total แล้ว แต่ยังไม่ได้ slot) — UI ใช้แยกจาก WORK
    this.prog(base, 'PENDING', 0, chunks.length);
    runnerLog.info('prepare', {
      base, totalChunks: chunks.length, cachedChunks: cachedCount,
      willFetch: chunks.length - cachedCount,
      cacheHitRatio: chunks.length ? +(cachedCount / chunks.length).toFixed(3) : 0,
      workdir,
    });
    return {
      inputPath, base, outputPath, workdir,
      chunks, chunkPaths, remaining: chunks.length, failed: false,
      // finalized = true หลัง _finalizeFile (หรือ FAIL terminate) ถูกเรียก —
      // กัน chunk ที่ resolve มาทีหลัง (เช่น WS reply ช้า) ส่ง prog WORK ทับ DONE/FAIL
      // (เคย user เห็น: ไฟล์ output มีแล้ว 5-7MB แต่ UI ยังหมุน 35/41)
      finalized: false,
      cachedAtStart: cachedCount, fetchedThisRun: 0,
    };
  }

  async _finalizeFile(state) {
    if (state.failed) return;
    const fmt = this.options.fmt || 'm4a';
    const tempo = Number(this.options.tempo ?? 1.0);
    const listPath = path.join(state.workdir, 'list.txt');
    const total = state.chunks.length;
    // log per-file summary ก่อนเรียก ffmpeg — ให้เห็นชัดในไฟล์ log ว่า
    // มาถึง concat ด้วย cache ratio เท่าไหร่ (scenario "ไม่ fetch ใหม่เลย" จะชัด)
    runnerLog.info('finalize: pre-concat', {
      base: state.base, fmt, tempo,
      totalChunks: total,
      cachedAtStart: state.cachedAtStart || 0,
      fetchedThisRun: state.fetchedThisRun || 0,
      remainingChunks: state.chunkPaths.length,
      outputPath: state.outputPath,
    });
    let result = { ok: false, error: 'unknown' };
    try {
      result = await ffmpegConcat(state.chunkPaths, listPath, state.outputPath, fmt, tempo);
    } catch (err) {
      result = { ok: false, error: err && err.message };
    }
    // ลบ list.txt ที่ ffmpeg ใช้ ไม่ต้องค้างเป็นไฟล์ tmp ใน cache
    try { fs.unlinkSync(listPath); } catch { /* noop */ }
    if (!result.ok) {
      this.stats.filesFailed += 1;
      this.log('error', `ffmpeg ${state.base}: ${result.error}`);
      // ส่ง details เพิ่มไป UI (Error Inbox) เพื่อให้ user copy report ได้พร้อม
      // path/argv/listPreview/stderr — UI โชว์เป็น collapsible block
      this.prog(state.base, 'FFMPEG_FAIL', total, total, result.error, result.details);
      // ไม่ลบ chunk — เก็บไว้เผื่อ user รัน retry หรือเปิดใหม่ → resume ได้
      return;
    }
    // ลบ chunks หลัง concat สำเร็จ → กัน cache aliasing เวลา user รันใหม่
    // ด้วยชื่อไฟล์เดิมแต่เนื้อหาใหม่ (เคย user เจอ "เสียงเรื่องเก่ายังอยู่")
    // ไม่กระทบ resume เพราะไฟล์ที่ DONE แล้วไม่ต้อง resume — output มีเต็มแล้ว
    this._cleanupWorkdir(state);
    this.stats.filesDone += 1;
    this.prog(state.base, 'DONE', total, total);
  }

  // ลบ chunk workdir ของไฟล์ที่จบแล้ว — เรียกเฉพาะ path ที่ output สำเร็จ
  // (DONE จาก _finalizeFile / DONE จาก maybeFinalize precheck / DONE จาก watchdog)
  // path ที่ FAIL / cancel ไม่เรียก → keep chunks ไว้ resume ตอนรันใหม่
  _cleanupWorkdir(state) {
    if (!state || !state.workdir) return;
    try { fs.rmSync(state.workdir, { recursive: true, force: true }); }
    catch (err) { runnerLog.warn('cleanup workdir failed', { base: state.base, error: err && err.message }); }
  }

  async _fetchWithRetry(text, outPath, fetchFn, retries) {
    let lastErr;
    // per-attempt wall-clock timeout — กัน fetchFn hang ตลอด (WebSocket connect-hang,
    // HTTP socket ค้าง, server ไม่ส่ง response) → ทำให้ chunk ไม่ resolve/reject เลย
    // → state.remaining ไม่ลด → maybeFinalize ไม่ trigger → UI ค้างที่ WORK ถึง 7+ นาที
    // (user เคยเจอ: 35/41 ค้าง 457s ทั้งที่ไฟล์ output มีแล้ว)
    // timeout = race กับ fetchFn — ถ้าเกิน → throw → catch → retry/fail ตามปกติ
    const attemptTimeoutMs = Number(this.options.fetchAttemptTimeoutMs) || 60000;
    for (let i = 0; i < retries; i += 1) {
      if (this.cancelled) throw new Error('cancelled');
      try {
        await this._withTimeout(
          fetchFn(text, outPath),
          attemptTimeoutMs,
          `fetch timeout ${attemptTimeoutMs}ms`,
        );
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) return;
        throw new Error('empty audio');
      } catch (err) {
        lastErr = err;
        if (process.env.INKTTS_DEBUG_FETCH) {
          this.log('warn', `fetch attempt ${i + 1} failed: ${err && err.message}`);
        }
      }
      if (i < retries - 1) {
        // cancellable: cancel() ปลุก sleep → throw 'cancelled' → catch ออกจาก loop
        await this._sleep(2 ** i * 1000);
      }
    }
    throw lastErr;
  }

  // race promise vs timeout — ถ้า timeout ก่อน, reject พร้อม message
  // ไม่ abort fetchFn ใต้ระดับ (WS อาจค้างต่อใน background) — แต่ controlflow ของ
  // runner หลุดออกมาได้ → state.remaining เดินต่อ → finalize → DONE/FAIL
  _withTimeout(p, ms, label) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(label));
      }, ms);
      Promise.resolve(p).then(
        (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
        (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); },
      );
    });
  }

  async _synthOneFile(state, fetchFn, filePerFileSemMax, totalLimiter) {
    // Mark this file as "actually starting now" — UI will reset timer here
    this.start(state.base);
    // flip PENDING → WORK now that slot is acquired
    const total = state.chunks.length;
    this.prog(state.base, 'WORK', 0, total);
    const fileSem = new Semaphore(filePerFileSemMax);
    this._activeLimiters.add(fileSem);
    const failedChunks = [];
    // เก็บ error message อันล่าสุดที่ chunk fetch fail — ใช้แสดงตอน status=FAIL
    // (มีหลาย chunks fail → ใช้อันล่าสุดเป็นตัวอย่าง — มักจะเป็นปัญหาเดียวกัน เช่น network)
    let lastFetchError = null;

    // Watchdog: poll output file ทุก 5 วินาที — ถ้า file โผล่และ valid → force DONE
    // ครอบ scenario:
    //   1. ffmpeg concat ของ run ก่อนเคยเสร็จ → file มี → chunks ค้าง = ไม่ต้องค้าง
    //   2. emit DONE หลุดทาง IPC race → file มี แต่ UI ไม่รู้ → safety net catch ได้
    //   3. instance อื่นทำเสร็จก่อน (user รัน 2 windows) → instance ปัจจุบัน fast-forward DONE
    const watchdogIntervalMs = Number(this.options.outputWatchdogMs) || 5000;
    const watchdog = setInterval(() => {
      if (state.finalized || this.cancelled) {
        clearInterval(watchdog);
        this._activeWatchdogs.delete(watchdog);
        return;
      }
      try {
        const st = fs.statSync(state.outputPath);
        if (st.size > 1024) {
          state.finalized = true;
          clearInterval(watchdog);
          this._activeWatchdogs.delete(watchdog);
          this.stats.filesDone += 1;
          this._cleanupWorkdir(state);
          runnerLog.info('watchdog: output file detected — force DONE', {
            base: state.base, size: st.size, path: state.outputPath,
          });
          this.prog(state.base, 'DONE', total, total);
        }
      } catch { /* not yet — keep polling */ }
    }, watchdogIntervalMs);
    this._activeWatchdogs.add(watchdog);

    const maybeFinalize = async () => {
      if (state.remaining !== 0) return;
      // กัน double-finalize: 2 chunk fail พร้อมกัน → 2 path มาถึง remaining=0 ทั้งคู่
      // (ไม่น่าเกิดเพราะ JS single-threaded แต่กันไว้)
      if (state.finalized) return;
      // Pre-check: ถ้า output มีอยู่แล้ว (ffmpeg ของ run ก่อนทำสำเร็จไว้)
      // → ข้าม concat ทันที — ประหยัด CPU + กัน race ที่ rename ทับไฟล์เดียวกัน
      try {
        const st = fs.statSync(state.outputPath);
        if (st.size > 1024) {
          state.finalized = true;
          this.stats.filesDone += 1;
          this._cleanupWorkdir(state);
          runnerLog.info('maybeFinalize: output already exists — skip concat', {
            base: state.base, size: st.size, path: state.outputPath,
          });
          this.prog(state.base, 'DONE', total, total);
          return;
        }
      } catch { /* output ยังไม่มี — ดำเนินการ concat ตามปกติ */ }
      state.finalized = true;
      const failTol = Number(this.options.failTolerance ?? 0.15);
      if (failedChunks.length && failedChunks.length > total * failTol) {
        state.failed = true;
        this.stats.filesFailed += 1;
        const msg = `fetch fail ${failedChunks.length}/${total} chunks` + (lastFetchError ? ` — ${lastFetchError}` : '');
        this.prog(state.base, 'FAIL', total - failedChunks.length, total, msg);
        // ไม่ลบ chunk ที่สำเร็จไปแล้ว — เผื่อ user รัน retry หรือเปิดใหม่ → resume ได้
        return;
      }
      if (failedChunks.length) {
        state.chunkPaths = state.chunkPaths.filter((_, i) => !failedChunks.includes(i));
        this.log('warn', `${state.base}: ${failedChunks.length} chunks missing — concatenating ${state.chunkPaths.length}/${total}`);
      }
      await this._finalizeFile(state);
    };

    const fetchOne = async (idx) => {
      // bail out ถ้า finalize ไปแล้ว — ไม่ emit prog (จะทับ DONE/FAIL)
      // เคส: 5/6 fetch fail → maybeFinalize → concat → DONE → chunk ตัวที่ 6 resolve มาทีหลัง
      // → ถ้าไม่ check ตรงนี้ จะ emit WORK ทับ DONE → UI ติดที่ WORK ตลอด
      if (state.finalized || this.cancelled) return;
      const chunkPath = state.chunkPaths[idx];
      const exists = fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 1024;
      if (!exists) {
        let ok = false;
        try {
          await fileSem.run(() => totalLimiter.run(() => this._fetchWithRetry(state.chunks[idx], chunkPath, fetchFn, this.options.retries || 6)));
          ok = true;
          state.fetchedThisRun = (state.fetchedThisRun || 0) + 1;
        } catch (err) {
          lastFetchError = err && err.message;
          if (state.finalized) return; // กัน emit หลัง finalize
          failedChunks.push(idx);
          state.remaining -= 1;
          const done = total - state.remaining;
          this.prog(state.base, 'WORK', done, total);
          totalLimiter.reportOutcome(false);
          await maybeFinalize();
          return;
        }
        totalLimiter.reportOutcome(ok);
      }
      if (state.finalized) return; // กัน emit หลัง finalize (เคส cache hit ตามมาทีหลัง)
      this.stats.chunksDone += 1;
      state.remaining -= 1;
      const done = total - state.remaining;
      if (state.remaining === 0) await maybeFinalize();
      else this.prog(state.base, 'WORK', done, total);
    };

    try {
      await Promise.all(state.chunks.map((_, i) => fetchOne(i)));
    } finally {
      this._activeLimiters.delete(fileSem);
      clearInterval(watchdog);
      this._activeWatchdogs.delete(watchdog);
    }
  }

  async run() {
    const eng = ENGINES[this.serviceKey];
    if (!eng) throw new Error(`unknown service: ${this.serviceKey}`);
    const splitFn = buildSplitter(this.serviceKey, this.options);
    const fetchFn = buildFetchFn(this.serviceKey, this.options);

    const batchSize = safeInt(this.options.batchSize, eng.DEFAULT_BATCH_SIZE);
    const connsPerFile = safeInt(this.options.connectionsPerFile, eng.DEFAULT_CONNECTIONS_PER_FILE);
    const totalConn = batchSize * connsPerFile;

    fs.mkdirSync(this.options.outputDir, { recursive: true });

    this.log('info', `[plan] service=${this.serviceKey} batch=${batchSize} conn/file=${connsPerFile} total=${totalConn}`);

    const fileStates = [];
    for (const f of this.files) {
      if (this.cancelled) break;
      const s = await this._prepareFile(f, splitFn);
      if (s) fileStates.push(s);
    }

    // failThreshold=2 → shrink เร็วขึ้นเมื่อโดน throttle
    // recoverThreshold=15 → ค่อย ๆ คืนเพดานช้า ๆ ป้องกัน oscillate
    const totalLimiter = new AdaptiveLimiter({
      initial: totalConn,
      failThreshold: 2,
      recoverThreshold: 15,
      label: 'total',
      onLimit: (info) => this.emit('limit', info),
    });
    const fileSlot = new Semaphore(batchSize);
    this._activeLimiters.add(totalLimiter);
    this._activeLimiters.add(fileSlot);

    try {
      await Promise.all(fileStates.map((state) => fileSlot.run(() => this._synthOneFile(state, fetchFn, connsPerFile, totalLimiter))));
    } finally {
      this._activeLimiters.delete(totalLimiter);
      this._activeLimiters.delete(fileSlot);
      // ไม่ sweep chunks ทิ้ง — เก็บไว้เป็น cache เพื่อ resume เมื่อรันซ้ำ
      // ลบเมื่อ user สั่งเองผ่านปุ่ม Clear Cache ใน Settings
    }

    const elapsed = (Date.now() - this.startTime) / 1000;
    this.emit('done', { stats: this.stats, elapsedSec: elapsed, cancelled: this.cancelled });
    return this.stats;
  }
}

module.exports = { TTSJob, ENGINES };
