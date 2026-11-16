# Rules for Claude (Taalmel)

The parent folder's `CLAUDE.md` (`~/Documents/code/personal/CLAUDE.md`) applies too: permission twice before any work, no push without approval, no commits unless asked, muted headless Chrome, every option remembered, phone and tablet support.

## Pushing (hard rule)

Pushing to `master` deploys production (taalmel.patel1771.com), so every push needs the owner's approval for that specific push, asked once the work is done and verified.

## Tempo is always BPM (hard rule)

BPM means beats per minute: an absolute number, never a percentage or a × multiplier, in any input, label, slider or summary. A tempo the user enters is the song's tempo and must be saved as such. Never fall back to a default or store it as a speed change.

## Remembered options

Every panel option and toggle is saved in Settings. The deliberate exceptions: the practice tempo (it starts at the song's tempo every time) and the loop range (per song).

## Note spelling

Letters default to sharps. A note spelled flat in the source keeps its `(flat)` flag through import and save. There is no sharps/flats setting.

## Product vision

- Taalmel is one hub holding every tool a beginner guitarist needs to learn guitar. Tutorials are out of scope because YouTube covers them.
- Design our own UX. Other apps (Songsterr etc.) can inspire us, but don't copy their patterns: the app exists because none of them solved the owner's problems.
- Audience: the owner first, but the app is public. Plan for first-time users (a self-explaining home, samples, sensible defaults), moderation of shared songs, and Google consent-screen verification.
- Laptop and phone/tablet are both supported (`specs/8-11-mobile.md`). The laptop layout must not change when the compact layout is worked on.
- Ideas not yet scheduled live in `IDEAS.md`. Build them one step at a time, as the owner reaches that point in their own learning.
