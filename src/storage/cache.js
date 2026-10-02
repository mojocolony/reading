const CACHE_KEY = 'reading:snapshot:v1';

function safeStorage(storage) {
  return storage ?? globalThis.localStorage;
}

export function readCachedSnapshot(storage) {
  const target = safeStorage(storage);
  try {
    const raw = target?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.books)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedSnapshot(snapshot, storage) {
  safeStorage(storage)?.setItem(CACHE_KEY, JSON.stringify(snapshot));
}

export function clearCachedSnapshot(storage) {
  safeStorage(storage)?.removeItem(CACHE_KEY);
}

export { CACHE_KEY };
