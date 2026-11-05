# Rules for Claude

## Permission before any work (hard rule)

Do NOT start any work — no file edits, no code changes, no subagents, no builds — until the user has given explicit permission **twice, in two separate prompts**.

1. When a task comes up, ask explicitly: "Do you want me to start working on X?" and stop.
2. After the first yes, ask again in a new message to confirm, and stop.
3. Only after the second yes, in a separate prompt, begin.

Nothing else counts as permission: not answering a question, not choosing an option, not describing a problem, not saying what they want changed. Reading files to answer a question is allowed; changing anything is not.

**Subagents:** this rule is enforced by the main Claude session only. A subagent dispatched by the main session is already covered by the user's approval given there; it must not ask again and should start the work it was given right away.

## Pushing (hard rule)

Never run `git push` to `master` without the user's explicit approval for that specific push. Pushing deploys production (taalmel.patel1771.com). Approval of a plan that mentions pushing doesn't count: ask again once the work is done and verified.

## Tempo is always BPM (hard rule)

BPM means beats per minute: an absolute number, never a percentage or a × multiplier, in any input, label, slider or summary. A tempo the user enters is the song's tempo and must be saved as such. Never fall back to a default or store it as a speed change.

## Product vision

- Taalmel is one hub holding every tool a beginner guitarist needs to learn guitar. Tutorials are out of scope because YouTube covers them.
- Design our own UX. Other apps (Songsterr etc.) can inspire us, but don't copy their patterns: the app exists because none of them solved the owner's problems.
- Audience: the owner first, but the app is public. Plan for first-time users (a self-explaining home, samples, sensible defaults), moderation of shared songs, and Google consent-screen verification.
- Laptop is the main target for now. Phone and tablet support comes later.
- Ideas not yet scheduled live in `IDEAS.md`. Build them one step at a time, as the owner reaches that point in their own learning.
