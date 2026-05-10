// Port ของ AdaptiveLimiter จาก _lib.py
// Promise-based semaphore ที่หด cap เมื่อ fail ติดกัน, คืนกลับเมื่อ ok ติดกัน

class AdaptiveLimiter {
  constructor({ initial, minimum = 1, failThreshold = 3, recoverThreshold = 10, label = 'total', onLimit }) {
    this._initial = Math.max(1, Number(initial) || 1);
    this._max = this._initial;
    this._min = Math.max(1, Number(minimum) || 1);
    this._failThr = failThreshold;
    this._recoverThr = recoverThreshold;
    this._label = label;
    this._onLimit = onLimit || (() => {});
    this._inUse = 0;
    this._fails = 0;
    this._oks = 0;
    this._waiters = [];
  }

  get currentMax() { return this._max; }

  async acquire() {
    while (this._inUse >= this._max) {
      await new Promise((r) => this._waiters.push(r));
    }
    this._inUse += 1;
  }

  release() {
    this._inUse -= 1;
    const next = this._waiters.shift();
    if (next) next();
  }

  async run(fn) {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }

  reportOutcome(ok) {
    if (ok) {
      this._fails = 0;
      this._oks += 1;
      if (this._oks >= this._recoverThr && this._max < this._initial) {
        const old = this._max;
        this._max = Math.min(this._initial, this._max + 1);
        this._oks = 0;
        this._onLimit({ label: this._label, kind: 'grow', old, new: this._max, initial: this._initial });
        const next = this._waiters.shift();
        if (next) next();
      }
    } else {
      this._oks = 0;
      this._fails += 1;
      if (this._fails >= this._failThr && this._max > this._min) {
        const old = this._max;
        this._max = Math.max(this._min, Math.floor(this._max / 2));
        this._fails = 0;
        this._onLimit({ label: this._label, kind: 'shrink', old, new: this._max, initial: this._initial });
      }
    }
  }
}

class Semaphore {
  constructor(max) {
    this._max = Math.max(1, Number.isFinite(max) ? max : 1);
    this._inUse = 0;
    this._waiters = [];
  }
  async acquire() {
    while (this._inUse >= this._max) {
      await new Promise((r) => this._waiters.push(r));
    }
    this._inUse += 1;
  }
  release() {
    this._inUse -= 1;
    const next = this._waiters.shift();
    if (next) next();
  }
  async run(fn) {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
}

module.exports = { AdaptiveLimiter, Semaphore };
