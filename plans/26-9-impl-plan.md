# Taalmel v1 implementation plan

Spec: `specs/26-9-claude.md`. Shared types: `src/model/index.ts` (do not change existing fields; additions OK if needed, note them).
Each module exposes its public API from `src/<module>/index.ts`. Tests live next to code as `*.test.ts` (Vitest, node env).
Imports are relative (no path aliases). TS strict, `noUnusedLocals`.

## Module API contracts

### notation (`src/notation`)
- `TUNING_MIDI: Record<StringNumber, number>` = {1:64,2:59,3:55,4:50,5:45,6:40}
- `pitchOf(string: StringNumber, fret: number): number`
- `letterOf(midi: number, accidentals: Accidentals): string` (no octave, e.g. "C#")
- `noteNameWithOctave(midi, accidentals): string` (e.g. "E4")
- `isPicked(note: Note): boolean`
- `teacherGlyph(note: Note, accidentals): { kind: "teacher"; letter: string; register: "above" | "none" | "below"; zone: number } | { kind: "fallback"; text: string }`
- `tabGlyph(note: Note, prev: Note | undefined): { text: string; techniqueLabel?: string }` (labels per spec 8.2)

### songFormat (`src/songFormat`)
- `parse(text: string): ParseResult`
- `serialize(song: Song): string`
- `extractSong(reply: string): { ok: true; text: string } | { ok: false; message: string }`
- `buildImportPrompt(form: ImportForm): string` where `ImportForm = { title; time: TimeSignature; bpm; unit; youtubeUrl?: string; offsetSec?: number }`
- `buildRepairPrompt(errors: ParseError[], currentText: string): string`
- `parseYouTubeId(url: string): string | null`
- helpers: `withYoutubeOffset(song: Song, offsetSec: number): Song` (returns new song; used by offset nudge, then re-serialized)

### tempo (`src/tempo`)
- `class TempoMap { constructor(song: Song); ticksToSec(tick): number; secToTicks(sec): number; bpmAtTick(tick): number; readonly segments }`
  Negative ticks/seconds (count-in) extrapolate using the first segment's BPM.

### clock (`src/clock`)
- `interface Clock` per spec 7.2 plus `dispose(): void`, `speed(): number`.
- `class GridClock implements Clock` — `constructor(opts: { ctx: AudioContext; tempo: TempoMap; song: Song; countIn: boolean })`.
  Extra: `audioTimeToSongSec(audioTime: number): number`, `onTick?` not needed; metronome reads the clock.
  Count-in: position starts at -barTicks of bar 1 when playing from tick 0 (or of the start bar when looping first pass).
  Loop: `setLoop(range: { startTick; endTick } | null)`; at endTick seeks to startTick (no count-in), emits `onLoop(cb)` (returns unsubscribe).
  Speed factor applied on top of tempo map.
- `class VideoClock implements Clock` — `constructor(opts: { player: YTPlayerLike; tempo: TempoMap; offsetSec: number })`, polls 50 ms, interpolates, snap >40 ms else ease ~100 ms. `setOffset(sec)`, `setLoop`, `onLoop`, `actualRate()`. `audioTimeToSongSec(audioTime, ctx)` via `ctx.getOutputTimestamp()` + performance.now().
- `interface YTPlayerLike` minimal subset of YT.Player used (getCurrentTime, playVideo, pauseVideo, seekTo, setPlaybackRate, getPlaybackRate, getAvailablePlaybackRates, getPlayerState, addEventListener or a callback hook). Also `loadYouTubeApi(): Promise<void>` and `createYouTubePlayer(el: HTMLElement, videoId: string): Promise<YTPlayerLike>` rejecting with a readable message on error codes (2, 5, 100, 101, 150).

### layout (`src/layout`)
- `computeLayout(song: Song, opts: { viewportWidth: number; zoom: number; lanes: Record<LaneId, boolean> }): Layout`
- `Layout = { rows: Row[]; totalHeight: number; width: number; laneHeights: Record<LaneId, number>; envelopeHeight: number }`
- `Row = { index; y; height; startTick; endTick; x0; bars: BarBox[]; notes: NoteBox[]; laneOffsets: Partial<Record<LaneId, number>>; envelopeY: number }`
- `BarBox = { barNumber; x; width; startTick; lengthTicks; gridXs: number[] }` (gridXs = x of each slot boundary incl. start)
- `NoteBox = { note: Note; x; width; stringIndex (0 = string 1 top) }` — width uses the note's duration clipped by the next note on same string.
- `tickToX(row: Row, tick): number`, `xToTick(row, x)`, `rowIndexForTick(layout, tick): number` (binary search; negative tick → 0; past end → last).
- Constants for lane heights exported. Row left padding (for string labels) included in x0.

### audio (`src/audio`)
- `getAudioContext(): AudioContext` (shared, lazily created) and `resumeAudio(): Promise<void>`.
- `class Metronome { constructor(ctx, song, tempo); attach(clock: Clock): void; setVolume; setMuted; setSubdivision(on); setEnabled(on); start(); stop() }` — lookahead 25 ms/100 ms, reads clock position; for GridClock uses exact audio-time mapping, for VideoClock uses interpolated position.
  Also `scheduleClick(ctx, time, accent: boolean, volume)` exported (used by calibration).
- Worklet: `public/envelope-processor.js`? No — put it at `src/audio/envelope-processor.ts` loaded via `new URL("./envelope-processor.ts", import.meta.url)` with `audioWorklet.addModule`. Core logic in `src/audio/onsetDetector.ts` as a plain class `OnsetDetector` (process(block: Float32Array, frame) → events) used by both the worklet and tests.
- `class MicInput { static async start(ctx): Promise<MicInput>; onEnvelope(cb: (p: { frameStart; rms: number[] }) => void); onOnset(cb: (frame) => void); onSlice(cb: (onsetFrame, samples: Float32Array) => void); stop(); readonly sampleRate }`
  Errors: throws `MicError` with `kind: "denied" | "nodevice" | "other"`.
- `yin(samples: Float32Array, sampleRate: number, opts?): { freq: number; confidence: number } | null` in `src/audio/yin.ts`; worker `src/audio/pitch.worker.ts` wraps it; `PitchDetector` class with `detect(samples, sampleRate): Promise<{freq; confidence}|null>`.
- `buildExpectedEvents(song, tempo): ExpectedEvent[]` and `class Matcher { constructor(events, tiers); addOnset(songSec): Verdict | null; advance(songSec): Verdict[] /* misses */; attachPitch(verdict, freq|null, confidence) ; reset(); verdicts(): Verdict[] }` in `src/audio/matcher.ts`.
- `summarize(verdicts: Verdict[]): SessionSummary` = counts per tier, missed, extra, meanSignedErrorMs, pitch counts.
- Calibration: `runLoopbackCalibration(ctx, mic): Promise<{ ok: true; latencyMs; detected: number } | { ok: false; reason: string }>` and `runTapCalibration(...)` same shape. Pure `computeCalibration(scheduled: number[], detected: number[]): result` tested.

### storage (`src/storage`)
- `openDb()`, `listSongs(): Promise<SongRecord[]>` (updatedAt desc), `getSong(id)`, `saveSong(text, id?)` (parses to fill denormalized fields; throws if invalid), `deleteSong(id)`, `loadSettings(): Promise<Settings>` (merged with DEFAULT_SETTINGS), `saveSettings(s)`, `requestPersist(): Promise<boolean>`.
- `exportLibrary(): Promise<{ filename; json: string }>`, `parseImportFile(name, content): ImportPlan | error`, `applyImport(plan, decisions)`; `exportSongFile(record) → { filename; text }`; `slugify(title)`.

### exercises (`src/exercises`)
- `chromatic(params): string`, `spider(params): string`, `rhythm(params): string` returning song text; each accepts `{ bpm; time? }`.

### render (`src/render`) & ui (`src/ui`)
- `Sheet` component renders layout via absolutely positioned DOM; `PlaybackController` owns the rAF loop (cursor, auto-scroll, envelope drawing, verdict markers).
- `src/main.tsx` mounts `App` from `src/ui/App.tsx`.
