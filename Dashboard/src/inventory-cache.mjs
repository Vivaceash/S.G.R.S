const PREFIX = 'sgrs:inventory-cache:v1:';
const instances = new Set();
const browserStorage = () => { try { return globalThis.sessionStorage; } catch { return null; } };

export function clearInventoryCache(storage = browserStorage()) {
  for (const cache of instances) cache.close();
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) storage.removeItem(key);
    }
  } catch {}
}

// One browser tab and authenticated permission scope; refresh is always explicit.
export function createInventoryCache(scope, storage = browserStorage()) {
  const values = new Map();
  const pending = new Map();
  let closed = false;
  const storageKey = key => `${PREFIX}${encodeURIComponent(scope)}:${key}`;
  const peek = key => {
    if (closed) return null;
    if (values.has(key)) return values.get(key);
    try {
      const saved = JSON.parse(storage.getItem(storageKey(key)));
      if (saved && saved.value != null && typeof saved.updatedAt === 'string') {
        values.set(key, saved); return saved;
      }
    } catch {}
    return null;
  };
  const set = (key, value) => {
    const snapshot = { value, updatedAt: new Date().toISOString() };
    if (closed) return snapshot;
    values.set(key, snapshot);
    try { storage.setItem(storageKey(key), JSON.stringify(snapshot)); } catch {}
    return snapshot;
  };
  const cache = {
    peek, set,
    update(key, updater) {
      const previous = peek(key);
      if (previous) return set(key, updater(previous.value));
    },
    load(key, fetcher, refresh = false, timeout = 45000) {
      if (closed) return Promise.reject(new Error('La sesión cambió.'));
      if (pending.has(key)) return pending.get(key).promise;
      const saved = peek(key);
      if (saved && !refresh) return Promise.resolve(saved);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const previous = values.get(key);
      const promise = Promise.resolve().then(() => fetcher(controller.signal)).then(value => {
        // A confirmed edit supersedes a read that started before it.
        if (values.get(key) !== previous) return peek(key);
        return set(key, value);
      }).finally(() => { clearTimeout(timer); pending.delete(key); });
      pending.set(key, { promise, controller });
      return promise;
    },
    close() {
      closed = true;
      for (const item of pending.values()) item.controller.abort();
      values.clear();
      instances.delete(cache);
    },
  };
  instances.add(cache);
  return cache;
}
