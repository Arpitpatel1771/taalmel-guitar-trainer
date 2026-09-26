// YouTube IFrame Player API loader + a minimal player facade (spec 7.4, 10.3).
// Kept deliberately small: only the subset of YT.Player actually used by
// VideoClock and the transport bar.

/** Minimal subset of YT.Player used by VideoClock (plan `src/clock` contract). */
export interface YTPlayerLike {
  getCurrentTime(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  getPlayerState(): number;
  addEventListener(event: string, listener: (event: { data: number }) => void): void;
  removeEventListener?(event: string, listener: (event: { data: number }) => void): void;
}

// YouTube IFrame API player states.
export const YT_PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

// Readable messages for the YouTube onError event's `data` codes.
const YT_ERROR_MESSAGES: Record<number, string> = {
  2: "Invalid YouTube video ID or URL.",
  5: "This video can't be played in an HTML5 player.",
  100: "Video not found. It may have been removed or made private.",
  101: "The video's owner does not allow it to be played in embedded players.",
  150: "The video's owner does not allow it to be played in embedded players.",
};

export function errorMessageForYouTubeErrorCode(code: number): string {
  return YT_ERROR_MESSAGES[code] ?? `YouTube player error (code ${code}).`;
}

interface YouTubeIframeWindow {
  YT?: {
    Player: new (
      el: HTMLElement | string,
      opts: {
        videoId: string;
        events: {
          onReady: (e: { target: YTPlayerLike }) => void;
          onError: (e: { data: number }) => void;
        };
      },
    ) => YTPlayerLike;
  };
  onYouTubeIframeAPIReady?: () => void;
}

function getBrowserGlobals(): { win: YouTubeIframeWindow; doc: Document } | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return { win: window as unknown as YouTubeIframeWindow, doc: document };
}

let apiLoadPromise: Promise<void> | null = null;

/** Loads the YouTube IFrame Player API script (once) and resolves when
 * `window.YT.Player` is available. Rejects with a readable message outside
 * a browser environment or if the script fails to load. */
export function loadYouTubeApi(): Promise<void> {
  const globals = getBrowserGlobals();
  if (!globals) {
    return Promise.reject(
      new Error("The YouTube IFrame API can only be loaded in a browser environment."),
    );
  }
  const { win, doc } = globals;

  if (win.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise<void>((resolve, reject) => {
    const previousCallback = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };
    const script = doc.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      apiLoadPromise = null;
      reject(
        new Error("Failed to load the YouTube IFrame API script. Check your network connection."),
      );
    };
    doc.head.appendChild(script);
  });
  return apiLoadPromise;
}

/** Creates a YouTube player embedded in `el` for `videoId`, resolving once
 * it fires `onReady`, or rejecting with a readable message if YouTube
 * reports an error (invalid id, embedding disabled, etc. -- spec 10.3). */
export function createYouTubePlayer(el: HTMLElement, videoId: string): Promise<YTPlayerLike> {
  return loadYouTubeApi().then(
    () =>
      new Promise<YTPlayerLike>((resolve, reject) => {
        const globals = getBrowserGlobals();
        if (!globals || !globals.win.YT) {
          reject(new Error("YouTube IFrame API failed to initialize."));
          return;
        }
        let settled = false;
        const player: YTPlayerLike = new globals.win.YT.Player(el, {
          videoId,
          events: {
            onReady: () => {
              if (settled) return;
              settled = true;
              resolve(player);
            },
            onError: (e) => {
              if (settled) return;
              settled = true;
              reject(new Error(errorMessageForYouTubeErrorCode(e.data)));
            },
          },
        });
      }),
  );
}
