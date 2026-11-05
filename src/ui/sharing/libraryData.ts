// Open-library data access shared by the Library tab and the Songs list.

import { useEffect, useState } from "react";
import { fetchLibraryIndex, fetchLibrarySong, parse, libraryUpdateAvailable, type LibraryEntry, type LibraryIndex } from "./deps";
import type { SongRecord } from "../../model";
import type { StorageAdapter } from "../storageTypes";

let cached: Promise<LibraryIndex> | null = null;

/** The static index, fetched once per page load (a failed fetch is retried next time). */
export function loadLibraryIndex(): Promise<LibraryIndex> {
  if (!cached) {
    cached = fetchLibraryIndex().catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

export function useLibraryIndex(): { index: LibraryIndex | null; error: string | null } {
  const [state, setState] = useState<{ index: LibraryIndex | null; error: string | null }>({ index: null, error: null });
  useEffect(() => {
    let off = false;
    loadLibraryIndex().then(
      (index) => !off && setState({ index, error: null }),
      (e) => !off && setState({ index: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      off = true;
    };
  }, []);
  return state;
}

/** Entries whose local copy is older than the library version, by song id. */
export function updatesFor(songs: SongRecord[], index: LibraryIndex | null): Map<string, LibraryEntry> {
  const out = new Map<string, LibraryEntry>();
  if (!index) return out;
  for (const s of songs) {
    const entry = index.songs.find((e) => e.id === s.libraryId);
    if (entry && libraryUpdateAvailable(s, entry)) out.set(s.id, entry);
  }
  return out;
}

/** Adds an entry as a local copy linked to the library; returns the new song id. */
export async function addLibraryEntry(storage: StorageAdapter, entry: LibraryEntry): Promise<string> {
  const text = await fetchLibrarySong(entry);
  if (!parse(text).ok) throw new Error(`${entry.title} could not be read.`);
  const record = await storage.saveSong(text);
  await storage.linkSongToLibrary(record.id, entry.id, entry.updatedAt);
  return record.id;
}

/** Replaces a linked song's text with the library's newer version. */
export async function updateFromLibrary(storage: StorageAdapter, songId: string, entry: LibraryEntry): Promise<void> {
  const text = await fetchLibrarySong(entry);
  if (!parse(text).ok) throw new Error(`${entry.title} could not be read.`);
  await storage.saveSong(text, songId);
  await storage.linkSongToLibrary(songId, entry.id, entry.updatedAt);
}
