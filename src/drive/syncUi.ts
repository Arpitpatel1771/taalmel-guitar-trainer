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

export type DotTone = "ok" | "accent" | "warning" | "error" | "neutral";

/** Status dot colour on the account avatar. */
export function dotTone(status: SyncStatus): DotTone {
  const chip = chipFor(status);
  if (!chip) return "neutral";
  switch (chip.tone) {
    case "ok":
      return "ok";
    case "info":
    case "accent":
      return "accent";
    case "warning":
      return "warning";
    case "error":
      return "error";
    default:
      return "neutral";
  }
}

/** Up to two initials from a name, else the first letter of the email. */
export function initialsFor(name: string | null, email: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const e = (email ?? "").trim();
  return e ? e[0].toUpperCase() : "?";
}
