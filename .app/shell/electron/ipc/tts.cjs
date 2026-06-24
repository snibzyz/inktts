const { ipcMain } = require('electron');
const path = require('node:path');
const { TTSJob } = require('../tts/runner.cjs');
const { mergeGroups, detectAudioFiles } = require('../tts/merge.cjs');
const { getOutputDir } = require('../helpers/paths.cjs');
const { createLogger } = require('../helpers/logger.cjs');

const log = createLogger('tts-ipc');

const activeJobs = new Map();
let nextJobId = 0;

function registerTtsIpc(getMainWindow) {
  ipcMain.handle('tts:start', async (_e, payload) => {
    const { service, files, options, jobId: clientJobId } = payload || {};
    if (!service || !Array.isArray(files) || !files.length) {
      return { ok: false, error: 'missing service / files' };
    }
    const outputDir = options?.outputDir || path.join(getOutputDir(), service === 'rv' ? 'responsivevoice' : service);
    // รับ jobId จาก renderer เพื่อกัน race: renderer set state.jobId ไว้ก่อน IPC reply
    // → ทุก event ที่ runner emit ระหว่าง sync prelude (log, prog SKIP/PENDING ของไฟล์แรก)
    //   จะ match jobId ที่ renderer ตั้งไว้แล้ว → ไม่หล่นในช่วง pre-reply
    const jobId = (typeof clientJobId === 'string' && clientJobId) ? clientJobId : String(++nextJobId);
    const job = new TTSJob({
      jobId,
      serviceKey: service,
      files,
      options: { ...(options || {}), outputDir },
      onEvent: (evt) => {
        const w = getMainWindow();
        if (w && !w.isDestroyed()) w.webContents.send('tts:event', evt);
      },
    });
    activeJobs.set(jobId, job);
    log.info('start', { jobId, service, fileCount: files.length, options });
    job.run().catch((err) => {
      log.error('job failed', { jobId, error: err && err.message });
      job.emit('error', { message: err && err.message });
    }).finally(() => {
      activeJobs.delete(jobId);
    });
    return { ok: true, jobId, outputDir };
  });

  ipcMain.handle('tts:cancel', (_e, payload) => {
    const job = activeJobs.get(String(payload?.jobId || ''));
    if (!job) return { ok: false, error: 'job not found' };
    job.cancel();
    return { ok: true };
  });

  ipcMain.handle('merge:start', async (_e, payload) => {
    const { srcDir, dstDir, prefix, outPrefix, start, end, group, ext, pad } = payload || {};
    if (!srcDir || start == null || end == null) {
      return { ok: false, error: 'missing src/start/end' };
    }
    const w = getMainWindow();
    const sendLog = (level, message) => {
      if (w && !w.isDestroyed()) w.webContents.send('merge:log', { level, message });
    };
    try {
      const result = await mergeGroups({
        srcDir,
        dstDir: dstDir || `${srcDir}_merged`,
        prefix,
        outPrefix,
        start: Number(start),
        end: Number(end),
        group: Number(group) || 10,
        ext: ext || 'm4a',
        pad: Number(pad) || 0,
        onLog: sendLog,
      });
      if (w && !w.isDestroyed()) w.webContents.send('merge:done', result);
      return { ok: true, ...result };
    } catch (err) {
      const msg = err && err.message;
      sendLog('error', msg || 'merge failed');
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('merge:detect', (_e, payload) => {
    const srcDir = payload?.srcDir;
    const ext = payload?.ext || 'm4a';
    if (!srcDir) return null;
    return detectAudioFiles(srcDir, ext);
  });
}

module.exports = { registerTtsIpc };
