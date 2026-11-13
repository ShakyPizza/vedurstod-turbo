const store = new Map();
const inflight = new Map();

/**
 * Cache `loader()` under `key` for `ttlMs`. Concurrent callers share one
 * in-flight load.
 *
 * Options:
 * - shouldCache(value): return false to treat a result as a failure.
 * - failTtlMs: also cache failures (thrown errors, or results rejected by
 *   shouldCache) for this long, so a broken upstream is not called again on
 *   every request. Off by default.
 */
export async function cached(key, ttlMs, loader, opts = {}) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    if (hit.error) throw hit.error;
    return hit.value;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const shouldCache = opts.shouldCache ?? (() => true);
  const failTtlMs = opts.failTtlMs ?? 0;

  const promise = (async () => {
    try {
      const value = await loader();
      if (shouldCache(value)) {
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
      } else if (failTtlMs > 0) {
        store.set(key, { value, expiresAt: Date.now() + failTtlMs });
      } else {
        store.delete(key);
      }
      return value;
    } catch (error) {
      if (failTtlMs > 0) store.set(key, { error, expiresAt: Date.now() + failTtlMs });
      else store.delete(key);
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
