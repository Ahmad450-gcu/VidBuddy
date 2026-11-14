/**
 * Minimal promise wrapper over IndexedDB used for local, per-device data:
 * recent links, the last analysis (offline shell), audio queue and player state.
 * Server-side data (jobs, library) stays authoritative on the backend.
 */
const DB_NAME = 'haul'
const STORE = 'kv'
let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const kv = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const v = await tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
      return v === undefined ? fallback : v
    } catch {
      return fallback
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    try {
      await tx('readwrite', (s) => s.put(value, key))
    } catch {
      /* non-critical: local convenience data only */
    }
  },
  async del(key: string): Promise<void> {
    try {
      await tx('readwrite', (s) => s.delete(key))
    } catch {
      /* ignore */
    }
  },
}
