// Shared AudioContext lifecycle (spec 3, 13: "AudioContext suspended (autoplay
// policy)"). One context for the whole app: metronome, mic capture, and
// calibration clicks all share it so their clocks agree.

let sharedContext: AudioContext | null = null;

/** Lazily creates and returns the single shared AudioContext. */
export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }
  return sharedContext;
}

/**
 * Resumes the shared context if the browser suspended it under the autoplay
 * policy. Call this from the first user gesture (play press, mic enable) per
 * spec 13.
 */
export async function resumeAudio(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}
