// Web version of kvStore.ts: the browser's localStorage. Only the collector
// screens use it, and the website is admin-only (lib/webAccess.ts), so this
// is a safe fallback rather than something the website relies on.

const local = (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } })
  .localStorage;

export const kvStore: {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
} = {
  async getItemAsync(key) {
    try {
      return local?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async setItemAsync(key, value) {
    try {
      local?.setItem(key, value);
    } catch {
      // Storage full or blocked: nothing is cached.
    }
  },
};
