/**
 * Wraps socket event handlers to catch synchronous and asynchronous errors,
 * ensuring the server never crashes on unhandled socket exceptions.
 * Automatically acknowledges with { ok: false, error: "server_error" } if an ack callback function was provided.
 *
 * @param {string} eventName
 * @param {Function} handler
 * @returns {Function}
 */
export const safeHandler = (eventName, handler) => {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (err) {
      console.error(
        `[socket] Unhandled error in '${eventName}':`,
        err?.message || err,
      );
      const ack = args[args.length - 1];
      if (typeof ack === "function") {
        try {
          ack({ ok: false, error: "server_error" });
        } catch (_) {}
      }
    }
  };
};

