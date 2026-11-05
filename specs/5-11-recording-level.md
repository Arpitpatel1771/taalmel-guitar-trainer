# Taalmel: Recording Level (design spec)

Status: draft for review, 2026-11-05.
Problem: recordings often come out quiet, and nothing tells you while you record. Built after the shell from `5-11-ui-redesign.md` (the meter lives in the pocket).

Two parts: a **live input meter** that warns while you play, and a **volume boost** for quiet clips that is non-destructive by default.

---

## 1. Live input meter

### 1.1 Where it shows

Whenever the mic is open: practice view (listening), Recorder screen, quick record from the pocket, Tuner, chord mic check. It appears in the pocket as a 5-bar meter plus a state word. The Recorder screen also shows a larger version above the record button, so a quiet setup is caught *before* recording.

### 1.2 Measuring

- Tap the existing mic stream (`src/audio/micInput.ts` / `src/recording/recorder.ts`; constraints stay echo cancellation, noise suppression and auto gain **off**) with an `AnalyserNode` or the existing envelope worklet. Do not open a second `getUserMedia`.
- Every 50 ms compute the peak absolute sample value in dBFS. Keep a rolling **2-second window** of peaks.
- Meter bars follow the current peak (with a short fall-off so they don't flicker).

### 1.3 States

Decided from the loudest peak in the last 2 s (constants in one place, tuned during the build):

| State | Rule | Label | Colour |
| --- | --- | --- | --- |
| Waiting | max peak < −50 dBFS | "Play something" | `--text-muted` |
| Too quiet | −50 ≤ max < −24 dBFS | "Too quiet" | `--warn` |
| Good | −24 ≤ max < −1 dBFS | "Good level" | `--ok` |
| Too loud | any sample ≥ −1 dBFS (≈ 0.99) in the window | "Too loud" | `--verdict-off` |

- The state changes only after holding for 1 s, so it doesn't flap between notes.
- Clicking the meter opens a hint: too quiet → "Move the mic closer to the guitar, or turn up the input level in your computer's sound settings." Too loud → "Move back a little or turn the input down; loud peaks distort the recording."
- Browsers cannot change the mic's hardware gain, so the meter only advises; it never blocks recording or practice.

### 1.4 Detection check

Open question from planning: does a quiet mic also hurt note detection? During this build, test practice listening at "too quiet" levels. If onsets are missed, the practice view also shows the "too quiet" hint near the transport the first time it happens in a session.

---

## 2. Volume boost for clips

### 2.1 Measuring on save

When a clip is saved (and lazily for older clips the first time they are opened):

1. Decode its audio (`decodeAudioData` on the blob; for a video container where that fails, extract the audio with the already-lazy-loaded ffmpeg).
2. `peakDb` = loudest sample. `activeRmsDb` = RMS over the parts above −50 dBFS (ignores silence before and after playing).
3. `gainDb = clamp(min(−16 − activeRmsDb, −1 − peakDb), 0, 24)`. It only ever boosts, never cuts, and never pushes the peak past −1 dBFS.
4. If `gainDb < 1`, the clip is already fine: store 0.

### 2.2 Clip record

`ClipRecord` (`src/recording/clipStore.ts`) gains:

- `gainDb?: number`: the measured boost (absent = not measured yet).
- `boost?: boolean`: whether to apply it. **New clips default to `true`.** Older clips default to `false` until opened.

Both go into the synced clip metadata (`clipContent` in `src/drive/engine.ts`), so every device plays the clip at the same loudness. It's a few bytes and needs no media re-upload.

### 2.3 Playback

- Clip playback routes the media element through Web Audio: `MediaElementAudioSourceNode` → `GainNode` (`10^(gainDb/20)` when `boost` is on, else 1) → destination. (`HTMLMediaElement.volume` cannot go above 1.)
- The waveform (`peaks`) is drawn scaled by the same gain, so it matches what you hear.
- In the clip view: a "Boost volume" toggle with the amount ("+9 dB"), and a "Make it permanent" action.

### 2.4 Make it permanent (opt-in)

For when the file itself should be loud, e.g. to share it outside Taalmel or open it from Drive.

1. Confirm dialog: "This replaces the recording with the louder version. The original can't be restored."
2. ffmpeg: `-af volume=<gainDb>dB`, audio re-encoded in the same codec (Opus for WebM, AAC for MP4/M4A), video stream copied (`-c:v copy`). Progress shown, same engine loading UX as the trimmer.
3. Replace the local blob (`setClipBlob`), then set `gainDb = 0`, `boost = false`, update `size`, recompute `peaks`.
4. **Sync:** the engine currently skips media upload for a clip that already has a Drive media file (`wantsMediaUpload`). Add a "media changed" path: the clip gets a `mediaRev` counter, bumped on any blob replacement (also useful for trims); when `mediaRev` is newer than the uploaded revision, the engine enqueues `uploadMedia`, which **updates the existing Drive file** (same file id) rather than creating a new one.
5. Disabled when the clip's media isn't on this device (`blob === null`): "Download the clip first."

Video and audio-only clips both work. Audio-only is the light case; for video only the audio track is re-encoded, so it stays fast.

---

## 3. Tests

- Level states from synthetic buffers (silence, −30 dBFS tone, −10 dBFS tone, clipped tone), including the 1 s hold.
- `gainDb` maths: quiet clip, clip with one loud peak (peak-limited), already-loud clip (0), silence (0).
- Clip store migration: old records without `gainDb`/`boost`.
- Sync engine (fake Drive): replacing a blob bumps `mediaRev` and updates the same Drive file; metadata carries `gainDb`/`boost`.
- Browser check (muted headless Chrome): meter states with a test tone; boost toggle audibly changes gain (verified via an analyser on the output).

---

## 4. Out of scope

- Noise reduction, EQ, compression.
- Automatic boosting of the live mic signal for detection.
- Keeping the original alongside the permanent version.
