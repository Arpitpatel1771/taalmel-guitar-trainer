// In-memory SyncStore for tests that need several independent "devices" in one
// process (the real syncDb is a module-level singleton database).

import { itemKey, queueKey, type QueueItem, type SyncItem } from "../syncDb";
import type { SyncStore } from "../engine";

export function memorySyncStore(): SyncStore {
  const items = new Map<string, SyncItem>();
  const queue = new Map<string, QueueItem>();
  const meta = new Map<string, unknown>();
  return {
    async getItem(kind, id) {
      const i = items.get(itemKey(kind, id));
      return i ? { ...i } : undefined;
    },
    async putItem(item) {
      const rec: SyncItem = { ...item, key: itemKey(item.kind, item.id) };
      items.set(rec.key, rec);
      return { ...rec };
    },
    async deleteItem(kind, id) {
      items.delete(itemKey(kind, id));
    },
    async listItems(kind) {
      return [...items.values()].filter((i) => !kind || i.kind === kind).map((i) => ({ ...i }));
    },
    async enqueue(op, kind, id, now = Date.now()) {
      const key = queueKey(op, kind, id);
      const prev = queue.get(key);
      const rec: QueueItem = { key, op, kind, id, enqueuedAt: prev?.enqueuedAt ?? now, attempts: 0 };
      if (prev && prev.op === op && prev.resumableUrl) rec.resumableUrl = prev.resumableUrl;
      queue.set(key, rec);
      return { ...rec };
    },
    async listQueue() {
      return [...queue.values()].sort((a, b) => a.enqueuedAt - b.enqueuedAt).map((q) => ({ ...q }));
    },
    async updateQueueItem(key, patch) {
      const q = queue.get(key);
      if (q) queue.set(key, { ...q, ...patch });
    },
    async dequeue(key) {
      queue.delete(key);
    },
    async getMeta<T>(key: string) {
      return meta.get(key) as T | undefined;
    },
    async setMeta(key, value) {
      meta.set(key, value);
    },
    async deleteMeta(key) {
      meta.delete(key);
    },
  };
}
