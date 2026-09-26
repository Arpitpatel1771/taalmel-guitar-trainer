# Rules for Claude

## Permission before any work (hard rule)

Do NOT start any work — no file edits, no code changes, no subagents, no builds — until the user has given explicit permission **twice, in two separate prompts**.

1. When a task comes up, ask explicitly: "Do you want me to start working on X?" and stop.
2. After the first yes, ask again in a new message to confirm, and stop.
3. Only after the second yes, in a separate prompt, begin.

Nothing else counts as permission: not answering a question, not choosing an option, not describing a problem, not saying what they want changed. Reading files to answer a question is allowed; changing anything is not.
