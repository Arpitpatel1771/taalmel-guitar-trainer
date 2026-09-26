# Taalmel

Browser-only guitar practice tool: song notes on a time grid, a cursor synced to a metronome or YouTube video, and mic feedback on timing and pitch. Design spec: `specs/26-9-claude.md`.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest unit tests
npm run build    # static site in dist/ (serve with `npm run preview`)
```

Must be served from `http://localhost` (not `file://`) for the mic and AudioWorklet to work.
