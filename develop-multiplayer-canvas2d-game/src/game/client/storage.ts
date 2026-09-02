/**
 * LocalStorageService (CloudStorage interface compatibility)
 * --------------------
 * Pure client-side storage abstraction using localStorage.
 * Retains the same API (get, set, remove, loadAll, flush) for all game subsystems
 * (settings, talents, achievements, mob gallery, loadouts) with 0 HTTP network requests.
 */

interface CacheEntry {
  value: unknown;
}

interface StorageCallbacks {
  /** Returns the auth token for the current user, or null if not logged in. */
  getToken?: () => string | null;
}

/**
 * Singleton-style service. Initialize once with `CloudStorage.init(callbacks)`,
 * then use `CloudStorage.instance` to read/write.
 */
export class CloudStorage {
  private static _instance: CloudStorage | null = null;
  private cache = new Map<string, CacheEntry>();

  private constructor(_callbacks?: StorageCallbacks) {}

  /** Initialize (or re-initialize) the singleton. */
  static init(callbacks?: StorageCallbacks): CloudStorage {
    if (!CloudStorage._instance) {
      CloudStorage._instance = new CloudStorage(callbacks);
    }
    return CloudStorage._instance;
  }

  static get instance(): CloudStorage {
    if (!CloudStorage._instance) {
      CloudStorage._instance = new CloudStorage();
    }
    return CloudStorage._instance;
  }

  static get isReady(): boolean {
    return true;
  }

  // ──────────────────────────────────────────────────
  //  Public API (Pure localStorage - Zero HTTP traffic)
  // ──────────────────────────────────────────────────

  /**
   * Read a value by key directly from localStorage.
   */
  async get<T>(key: string): Promise<T | null> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached.value as T;
    }

    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }

    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as T;
      this.cache.set(key, { value: parsed });
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Write a value by key directly to localStorage.
   */
  set(key: string, value: unknown): void {
    this.cache.set(key, { value });
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full / private mode */
    }
  }

  /**
   * Remove a key from storage.
   */
  remove(key: string): void {
    this.cache.delete(key);
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /**
   * Load all data from localStorage.
   */
  async loadAll(): Promise<Record<string, unknown>> {
    const res: Record<string, unknown> = {};
    if (typeof window === "undefined" || !window.localStorage) return res;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          try {
            const raw = localStorage.getItem(key);
            if (raw !== null) {
              res[key] = JSON.parse(raw);
            }
          } catch {
            res[key] = localStorage.getItem(key);
          }
        }
      }
    } catch {
      /* ignore */
    }
    return res;
  }

  /**
   * Flush is a no-op since writes to localStorage are synchronous.
   */
  async flush(): Promise<void> {
    return Promise.resolve();
  }
}
