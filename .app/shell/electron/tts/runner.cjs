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
const { getCacheDir } = require('../helpers/paths.cjs');

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
  }

  emit(type, data) {
    this.onEvent({ jobId: this.jobId, type, ...data });
  }

  prog(fileBase, status, done, total) {
    this.emit('prog', { fileBase, status, done, total });
  }

  start(fileBase) {
    this.emit('start', { fileBase });
  }

  log(level, message) {
    this.emit('log', { level, message });
  }

  cancel() { this.cancelled = true; }

  async _prepareFile(inputPath, splitFn) {
    const base = path.basename(inputPath, path.extname(inputPath));
    const fmt = this.options.fmt || 'm4a';
    const outputDir = this.options.outputDir;
    const workdir = path.join(getCacheDir(), this.serviceKey, base);
    const outputPath = path.join(outputDir, `${base}.${fmt}`);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
      this.stats.filesSkipped += 1;
      this.prog(base, 'SKIP', 1, 1);
      return null;
    }
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
    const chunkPaths = chunks.map((_, i) => path.join(workdir, `${String(i).padStart(6, '0')}.mp3`));
    // PENDING = รอคิว (มี total แล้ว แต่ยังไม่ได้ slot) — UI ใช้แยกจาก WORK
    this.prog(base, 'PENDING', 0, chunks.length);
    return {
      inputPath, base, outputPath, workdir,
      chunks, chunkPaths, remaining: chunks.length, failed: false,
    };
  }

  async _finalizeFile(state) {
    if (state.failed) return;
    const fmt = this.options.fmt || 'm4a';
    const tempo = Number(this.options.tempo ?? 1.0);
    const listPath = path.join(state.workdir, 'list.txt');
    const total = state.chunks.length;
    let ok = false;
    try {
      ok = await ffmpegConcat(state.chunkPaths, listPath, state.outputPath, fmt, tempo);
    } catch (err) {
      this.log('error', `ffmpeg ${state.base}: ${err.message}`);
    }
    if (!ok) {
      this.stats.filesFailed += 1;
      this.prog(state.base, 'FFMPEG_FAIL', total, total);
      return;
    }
    if (!this.options.keepChunks) {
      try { fs.rmSync(state.workdir, { recursive: true, force: true }); } catch { /* noop */ }
    }
    this.stats.filesDone += 1;
    this.prog(state.base, 'DONE', total, total);
  }

  async _fetchWithRetry(text, outPath, fetchFn, retries) {
    let lastErr;
    for (let i = 0; i < retries; i += 1) {
      if (this.cancelled) throw new Error('cancelled');
      try {
        await fetchFn(text, outPath);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) return;
        throw new Error('empty audio');
      } catch (err) {
        lastErr = err;
        if (process.env.INKTTS_DEBUG_FETCH) {
          this.log('warn', `fetch attempt ${i + 1} failed: ${err && err.message}`);
        }
      }
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 2 ** i * 1000));
      }
    }
    throw lastErr;
  }

  async _synthOneFile(state, fetchFn, filePerFileSemMax, totalLimiter) {
    // Mark this file as "actually starting now" — UI will reset timer here
    this.start(state.base);
    // flip PENDING → WORK now that slot is acquired
    const total = state.chunks.length;
    this.prog(state.base, 'WORK', 0, total);
    const fileSem = new Semaphore(filePerFileSemMax);
    const failedChunks = [];

    const maybeFinalize = async () => {
      if (state.remaining !== 0) return;
      const failTol = Number(this.options.failTolerance ?? 0.15);
      if (failedChunks.length && failedChunks.length > total * failTol) {
        state.failed = true;
        this.stats.filesFailed += 1;
        this.prog(state.base, 'FAIL', total - failedChunks.length, total);
        return;
      }
      if (failedChunks.length) {
        state.chunkPaths = state.chunkPaths.filter((_, i) => !failedChunks.includes(i));
        this.log('warn', `${state.base}: ${failedChunks.length} chunks missing — concatenating ${state.chunkPaths.length}/${total}`);
      }
      await this._finalizeFile(state);
    };

    const fetchOne = async (idx) => {
      const chunkPath = state.chunkPaths[idx];
      const exists = fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 1024;
      if (!exists) {
        let ok = false;
        try {
          await fileSem.run(() => totalLimiter.run(() => this._fetchWithRetry(state.chunks[idx], chunkPath, fetchFn, this.options.retries || 6)));
          ok = true;
        } catch {
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
      this.stats.chunksDone += 1;
      state.remaining -= 1;
      const done = total - state.remaining;
      if (state.remaining === 0) await maybeFinalize();
      else this.prog(state.base, 'WORK', done, total);
    };

    await Promise.all(state.chunks.map((_, i) => fetchOne(i)));
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

    await Promise.all(fileStates.map((state) => fileSlot.run(() => this._synthOneFile(state, fetchFn, connsPerFile, totalLimiter))));

    const elapsed = (Date.now() - this.startTime) / 1000;
    this.emit('done', { stats: this.stats, elapsedSec: elapsed, cancelled: this.cancelled });
    return this.stats;
  }
}

module.exports = { TTSJob, ENGINES };
