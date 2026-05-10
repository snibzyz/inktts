const { ipcMain } = require('electron');
const path = require('node:path');
const { TTSJob } = require('../tts/runner.cjs');
const { mergeGroups, detectPrefixRange } = require('../tts/merge.cjs');
const { getOutputDir } = require('../helpers/paths.cjs');
const { createLogger } = require('../helpers/logger.cjs');

const log = createLogger('tts-ipc');

const activeJobs = new Map();
let nextJobId = 0;

function registerTtsIpc(getMainWindow) {
  ipcMain.handle('tts:start', async (_e, payload) => {
    const { service, files, options } = payload || {};
    if (!service || !Array.isArray(files) || !files.length) {
      return { ok: false, error: 'missing service / files' };
    }
    const outputDir = options?.outputDir || path.join(getOutputDir(), service === 'rv' ? 'responsivevoice' : service);
    const jobId = String(++nextJobId);
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
    const { srcDir, dstDir, prefix, start, end, group, ext } = payload || {};
    if (!srcDir || !prefix || start == null || end == null) {
      return { ok: false, error: 'missing src/prefix/start/end' };
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
        start: Number(start),
        end: Number(end),
        group: Number(group) || 10,
        ext: ext || 'm4a',
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
    return detectPrefixRange(srcDir, ext);
  });
}

module.exports = { registerTtsIpc };
