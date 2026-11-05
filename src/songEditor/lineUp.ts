// "Line up here": where bar 1 sits in the video when the video is paused on a moment that matches the roll's playhead.

/** Video seconds of bar 1, or null when the playhead is further into the song than the video is (bar 1 would come before the video starts). */
export function lineUpOffset(videoSec: number, playheadSec: number): number | null {
  const offset = videoSec - playheadSec;
  return offset < -0.0005 ? null : Math.max(0, Math.round(offset * 1000) / 1000);
}
