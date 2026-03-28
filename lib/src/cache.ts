/**
 * IndexedDB event cache with TTL for NIP-95 P2P sharing.
 * Stores Nostr events locally so they can be served to other peers via WebRTC.
 */

export interface CacheOptions {
  dbName?: string;
  storeName?: string;
  ttlMs?: number;
}

const DEFAULT_DB = 'nostr-p2p-cache';
const DEFAULT_STORE = 'events';
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class EventCache {
  private dbName: string;
  private storeName: string;
  private ttlMs: number;
  private db: IDBDatabase | null = null;

  constructor(options: CacheOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB;
    this.storeName = options.storeName ?? DEFAULT_STORE;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL;
  }

  private async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async put(event: { id: string; [key: string]: unknown }): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).put({ ...event, _cachedAt: Date.now() });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async get(eventId: string): Promise<Record<string, unknown> | null> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, 'readonly');
    const req = tx.objectStore(this.storeName).get(eventId);
    return new Promise((resolve) => {
      req.onsuccess = () => {
        const event = req.result;
        if (event && (Date.now() - event._cachedAt) < this.ttlMs) {
          const { _cachedAt, ...clean } = event;
          resolve(clean);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  }

  async has(eventId: string): Promise<boolean> {
    return (await this.get(eventId)) !== null;
  }

  async getAllIds(): Promise<string[]> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, 'readonly');
    const req = tx.objectStore(this.storeName).getAllKeys();
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => resolve([]);
    });
  }

  async count(): Promise<number> {
    const ids = await this.getAllIds();
    return ids.length;
  }

  async cleanup(): Promise<number> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
    const req = store.openCursor();
    let cleaned = 0;

    return new Promise((resolve) => {
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (Date.now() - cursor.value._cachedAt > this.ttlMs) {
            cursor.delete();
            cleaned++;
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(cleaned);
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).clear();
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
