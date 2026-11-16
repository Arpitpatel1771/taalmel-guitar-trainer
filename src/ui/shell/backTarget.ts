// Where a screen's back arrow goes (specs/8-11-mobile.md §3.1 "returns to where you came from"): the last
// top-level screen (Home, Songs, Library, Chords, Exercises, Recordings, Settings…) the person left.
// Full-height and in-between screens (practice, editor, add a song) never become a back target, so
// Library → song → editor → song → back still lands on Library.

const BACK_KINDS = new Set(["home", "library", "shared", "chords", "exercises", "tuner", "metronome", "recorder", "settings"]);

export function nextBackTarget<S extends { kind: string }>(backTo: S, prev: S, next: S): S {
  return prev !== next && prev.kind !== next.kind && BACK_KINDS.has(prev.kind) ? prev : backTo;
}
