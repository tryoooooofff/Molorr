/**
 * CloudStorageService
 * --------------------
 * Unified client-side storage abstraction that persists all player data
 * (settings, talents, achievements, mob gallery, etc.) to PostgreSQL via
 * the /api/storage endpoint. Falls back to localStorage when the API is
 * unavailable or the user is offline.
 */

const STORAGE_API = "/api/storage";

/** How long (ms) a remote value is cached in memory before re-fetching. */
const CACHE_TTL = 30_000;

interface CacheEntry {
  value: unknown;
  expiry: number;
}

interface StorageCallbacks {
  /** Returns the auth token for the current user, or null if not logged in. */
  getToken: () => string | null;
}

/**
 * Singleton-style service. Initialize once with `CloudStorage.init(callbacks)`,
 * then use `CloudStorage.instance` to read/write.
 */
export class CloudStorage {
  private static _instance: CloudStorage | null = null;
  private callbacks: StorageCallbacks;
  private cache = new Map<string, CacheEntry>();
  /** Queue of pending writes (key → value) to batch. */
  private dirty = new Map<string, unknown>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInterval = 2000; // flush every 2s

  private constructor(callbacks: StorageCallbacks) {
    this.callbacks = callbacks;
  }

  /** Initialize (or re-initialize) the singleton. */
  static init(callbacks: StorageCallbacks): CloudStorage {
    CloudStorage._instance = new CloudStorage(callbacks);
    return CloudStorage._instance;
  }

  static get instance(): CloudStorage {
    if (!CloudStorage._instance) {
      throw new Error("CloudStorage not initialized. Call CloudStorage.init() first.");
    }
    return CloudStorage._instance;
  }

  static get isReady(): boolean {
    return CloudStorage._instance !== null;
  }

  // ──────────────────────────────────────────────────
  //  Public API
  // ──────────────────────────────────────────────────

  /**
   * Read a value by key. Returns cached value if available and fresh,
   * otherwise fetches from the server. Falls back to localStorage.
   */
  async get<T>(key: string): Promise<T | null> {
    // 1. Check memory cache
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiry) {
      return cached.value as T;
    }

    // 2. Try remote
    const token = this.callbacks.getToken();
    if (token) {
      try {
        const res = await fetch(`${STORAGE_API}?token=${encodeURIComponent(token)}&key=${encodeURIComponent(key)}`);
        if (res.ok) {
          const json = (await res.json()) as { data: T | null };
          this.cache.set(key, { value: json.data, expiry: Date.now() + CACHE_TTL });
          return json.data;
        }
      } catch {
        // Network error – fall through to localStorage
      }
    }

    // 3. Fallback to localStorage
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  /**
   * Write a value by key. Schedules a batched flush to the server.
   * Also writes to localStorage as a fallback.
   */
  set(key: string, value: unknown): void {
    // Update memory cache immediately
    this.cache.set(key, { value, expiry: Date.now() + CACHE_TTL });

    // Write to localStorage as fallback
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full */
    }

    // Schedule batched remote write
    this.dirty.set(key, value);
    this.scheduleFlush();
  }

  /**
   * Remove a key from storage.
   */
  remove(key: string): void {
    this.cache.delete(key);
    this.dirty.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    // Schedule a flush with null to signal deletion
    this.dirty.set(key, null);
    this.scheduleFlush();
  }

  /**
   * Load all data from the server at once (useful on login).
   * Returns the full data map.
   */
  async loadAll(): Promise<Record<string, unknown>> {
    const token = this.callbacks.getToken();
    if (!token) return {};

    try {
      const res = await fetch(`${STORAGE_API}?token=${encodeURIComponent(token)}`);
      if (res.ok) {
        const json = (await res.json()) as { data: Record<string, unknown> };
        if (json.data) {
          // Populate cache
          for (const [k, v] of Object.entries(json.data)) {
            this.cache.set(k, { value: v, expiry: Date.now() + CACHE_TTL });
          }
          return json.data;
        }
      }
    } catch {
      /* network error */
    }
    return {};
  }

  /**
   * Force an immediate flush of all pending writes.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.dirty.size === 0) return;

    const token = this.callbacks.getToken();
    if (!token) {
      this.dirty.clear();
      return;
    }

    const batch = new Map(this.dirty);
    this.dirty.clear();

    // Build the full data snapshot from our cache
    const data: Record<string, unknown> = {};
    for (const [k, v] of batch) {
      if (v !== null) {
        data[k] = v;
      }
    }

    try {
      await fetch(STORAGE_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, data }),
      });
    } catch {
      // Re-queue on failure
      for (const [k, v] of batch) {
        if (v !== null) this.dirty.set(k, v);
      }
      this.scheduleFlush();
    }
  }

  // ──────────────────────────────────────────────────
  //  Internal
  // ──────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushInterval);
  }
}