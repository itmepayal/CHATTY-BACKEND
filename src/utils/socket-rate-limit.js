/**
 * Reusable In-Memory Token Bucket Rate Limiter for Socket Events
 * Tracks tokens per userId and event type with automated idle bucket eviction.
 */
class SocketRateLimiter {
  constructor() {
    this.buckets = new Map();
    // Cleanup idle buckets every 5 minutes to prevent memory leaks
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Consumes a token for a given user and action.
   *
   * @param {string} userId - User identifier
   * @param {string} action - Action name (e.g., 'call:invite', 'privacy:update', 'typing')
   * @param {Object} config
   * @param {number} config.capacity - Maximum tokens allowed in bucket
   * @param {number} config.refillPerSec - Tokens refilled per second
   * @returns {boolean} - true if allowed, false if rate limited
   */
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

    // Refill tokens based on elapsed time
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
