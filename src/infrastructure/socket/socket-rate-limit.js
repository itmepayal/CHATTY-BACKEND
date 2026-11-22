class SocketRateLimiter {
  constructor() {
    this.buckets = new Map();
    this.resetHooks = new Set();
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  onReset(fn) {
    if (typeof fn === "function") {
      this.resetHooks.add(fn);
    }
  }

  consume(userId, action, { capacity, refillPerSec }) {
    if (!userId) return false;
    const key = `${userId}:${action}`;
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity - 1, lastRefill: now };
      this.buckets.set(key, bucket);
      return true;
    }

    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + elapsedSec * refillPerSec,
    );
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  reset(userId, action) {
    if (!userId) return;
    if (action) {
      this.buckets.delete(`${userId}:${action}`);
    } else {
      for (const key of this.buckets.keys()) {
        if (key.startsWith(`${userId}:`)) {
          this.buckets.delete(key);
        }
      }
    }
  }

  resetAll() {
    this.buckets.clear();
    for (const hook of this.resetHooks) {
      try {
        hook();
      } catch {}
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > 10 * 60 * 1000) {
        this.buckets.delete(key);
      }
    }
  }
}

export const socketLimiter = new SocketRateLimiter();
