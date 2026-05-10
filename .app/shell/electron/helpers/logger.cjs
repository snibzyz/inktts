const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let logStream = null;

function getLogPath() {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'inktts.log');
  } catch {
    return null;
  }
}

function getStream() {
  if (logStream) return logStream;
  const p = getLogPath();
  if (!p) return null;
  try {
    logStream = fs.createWriteStream(p, { flags: 'a' });
    return logStream;
  } catch {
    return null;
  }
}

function fmt(level, scope, msg, data) {
  const ts = new Date().toISOString();
  const extra = data ? ' ' + JSON.stringify(data) : '';
  return `[${ts}] [${level}] [${scope}] ${msg}${extra}\n`;
}

function write(level, scope, msg, data) {
  const line = fmt(level, scope, msg, data);
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  try { out.write(line); } catch { /* noop */ }
  const s = getStream();
  if (s) s.write(line);
}

function createLogger(scope) {
  return {
    info: (msg, data) => write('info', scope, msg, data),
    warn: (msg, data) => write('warn', scope, msg, data),
    error: (msg, data) => write('error', scope, msg, data),
    debug: (msg, data) => write('debug', scope, msg, data),
  };
}

module.exports = { createLogger, getLogPath };
