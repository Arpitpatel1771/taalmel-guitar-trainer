// Pure mappings from sync state to UI text/tone (spec 28-10-drive-sync §4, §5).

import type { ClipRecord } from "../recording/clipStore";
import type { SyncStatus } from "./engine";

export type ChipTone = "neutral" | "ok" | "info" | "warning" | "error" | "accent";
export type ChipAction = "connect" | "conflicts" | "sync";

/** The sidebar chip for a status, or null when disconnected (no chip). */
export function chipFor(status: SyncStatus): { text: string; tone: ChipTone; action: ChipAction; pulse?: boolean } | null {
  switch (status.state) {
    case "disconnected":
      return null;
    case "syncing":
      return { text: "Syncing…", tone: "info", action: "sync", pulse: true };
    case "authRequired":
      return { text: "Drive: sign in to resume", tone: "warning", action: "connect" };
    case "offline":
      return { text: "Offline — saved locally", tone: "neutral", action: "sync" };
    case "retrying":
      return { text: "Retrying", tone: "warning", action: "sync" };
    case "driveFull":
      return { text: "Drive full — uploads paused", tone: "error", action: "sync" };
    case "idle":
      if (status.conflicts.length > 0) {
        const n = status.conflicts.length;
        return { text: `${n} ${n === 1 ? "conflict" : "conflicts"}`, tone: "warning", action: "conflicts" };
      }
      return { text: "Synced", tone: "ok", action: "sync" };
  }
}

export type ClipBadge = { text: string; kind: "inDrive" | "notDownloaded" | "otherDevice" | "uploading" | "local" };

export function clipBadge(clip: Pick<ClipRecord, "blob" | "driveFileId" | "id">, uploads: Record<string, number>): ClipBadge {
  if (!clip.blob && clip.driveFileId) return { text: "In Drive · not downloaded", kind: "notDownloaded" };
  if (!clip.blob) return { text: "Not uploaded (on another device)", kind: "otherDevice" };
  if (clip.id in uploads) return { text: `Uploading ${Math.round(uploads[clip.id] * 100)}%`, kind: "uploading" };
  if (clip.driveFileId) return { text: "In Drive", kind: "inDrive" };
  return { text: "This device only", kind: "local" };
}

export function relativeTime(then: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
