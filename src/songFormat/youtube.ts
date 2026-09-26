import type { Song } from "../model/index.js";

/**
 * Extracts an 11-character YouTube video ID from a watch/short/embed URL.
 * Returns null if the URL cannot be parsed or does not look like a YouTube link.
 */
export function parseYouTubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;

  if (host === "youtu.be") {
    id = parsed.pathname.slice(1).split("/")[0] ?? null;
  } else if (host === "youtube.com") {
    if (parsed.pathname === "/watch") {
      id = parsed.searchParams.get("v");
    } else if (parsed.pathname.startsWith("/embed/")) {
      id = parsed.pathname.slice("/embed/".length).split("/")[0] ?? null;
    }
  }

  if (!id) return null;
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/**
 * Returns a new Song with the video offset changed (used by the transport's offset
 * nudge control; the caller re-serializes and re-parses the result). Clamps to >= 0
 * per the header field's own validity rule.
 */
export function withYoutubeOffset(song: Song, offsetSec: number): Song {
  if (!song.header.youtube) {
    throw new Error("withYoutubeOffset: song has no youtube link");
  }
  const clamped = Math.max(0, offsetSec);
  return {
    ...song,
    header: {
      ...song.header,
      youtube: { ...song.header.youtube, offsetSec: clamped },
    },
  };
}
