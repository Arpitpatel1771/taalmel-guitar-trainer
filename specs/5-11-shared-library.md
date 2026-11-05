# Taalmel: Song Sharing (design spec)

Status: draft for review, 2026-11-05.
Covers: the open library, song requests with encrypted replies, and direct share links.
Constraints: **no server and no backend code.** Everything runs in the browser, plus Google Forms and published Google Sheets on the owner's own Google account. A separate account isn't needed: Taalmel never hosts a readable copyrighted song (the open library is public domain and the sheets hold only request details and encrypted replies).

---

## 1. Why this shape

Tabs of copyrighted songs are legally copies of the composition; publishers can and do send takedown notices. So:

- **Taalmel never hosts readable copies of copyrighted songs.** The only songs it hosts are public-domain ones (the open library).
- Copyrighted songs move **privately, one person to another**: a sharer's app encrypts the song for one requester, and only that requester's app can decrypt it. The sheet in the middle only ever holds data nobody else can read.
- Direct links carry the song inside the link itself; nothing is uploaded.

Beginners get songs mostly through this, not by transcribing (`5-11-song-import.md`).

---

## 2. Open library (public domain)

- Static files shipped with the site: `public/library/index.json` plus one `.txt` song file per entry. No Drive and no API key needed, and it works offline once cached.
- `index.json`: `{ version, songs: [{ id, title, artist?, difficulty?: "beginner"|"intermediate"|"advanced", youtubeUrl?, credit?, file, updatedAt }] }`.
- Seeded with the bundled samples (Ode to Joy, Greensleeves, Amazing Grace, Happy Birthday, Frère Jacques, Twinkle Twinkle, Bella Ciao, after checking each one's public-domain status) and grown by the owner through normal commits.
- UI: the **Library** rail item (`5-11-ui-redesign.md` §3.1) opens with two tabs, **Open library** and **Requests**. Open library: search, difficulty filter, preview (read-only sheet, Play notes), **Add to my songs** (a local copy with `libraryId` and `libraryVersion`; when the library version is newer, the song shows "Update available").

---

## 3. Requests and encrypted replies

### 3.1 Infrastructure (owner setup, once)

On the owner's Google account:

| Thing | Purpose | Public? |
| --- | --- | --- |
| **Requests form** | New request, join, close | Form open to anyone |
| Requests responses sheet + a **Board** tab (a `QUERY` over responses) | What the app reads | Board tab "Published to the web" as CSV |
| **Replies form** | Encrypted replies | Form open to anyone |
| Replies responses sheet | What the app reads | Published as CSV (ciphertext only) |
| **Report form** | Reports on requests | Responses private to the owner |

The form URLs, field entry ids and published CSV URLs go in Vite env vars (`VITE_REQUESTS_FORM`, `VITE_BOARD_CSV`, `VITE_REPLIES_FORM`, `VITE_REPLIES_CSV`, `VITE_REPORT_FORM`). Missing vars: the Requests tab says "Not set up" and nothing else changes (same pattern as Drive config).

Submitting: `fetch(formResponseUrl, { method: "POST", mode: "no-cors", body: FormData })`. The response is opaque, so the app cannot confirm delivery. It shows "Sent" optimistically and confirms once the row appears in the published CSV (Google refreshes published sheets every few minutes).

**Prototype first:** before building the UI, confirm (a) no-cors POST to a form from the app's origin lands a row, (b) the published CSV can be fetched cross-origin from the app, (c) the refresh delay. If (b) fails, fall back to the Sheets API v4 `values.get` with the existing API key on a sheet shared as "anyone with the link can view".

### 3.2 Identity keys

- On first use of Requests the app creates an **ECDH P-256 key pair** with Web Crypto. `keyId` = first 16 bytes (hex) of SHA-256 over the raw public key.
- The private key is stored in IndexedDB and, when Drive sync is connected, backed up in the synced settings (so another device or a cleared browser can still read replies). Without Drive: a nudge "Connect Google Drive so you don't lose replies".
- Losing the key only means old replies can't be opened; the user can post the request again.

### 3.3 Requests form fields

| Field | Content |
| --- | --- |
| `action` | `open`, `join` or `close` |
| `requestId` | UUID made by the requester's app (`open`); the request being joined or closed otherwise |
| `title`, `artist` | Required on `open` |
| `part` | `whole`, `solo`, `intro`, `riff`, `other` |
| `youtubeUrl` | Optional, validated with the existing YouTube parser |
| `note` | Optional, ≤ 300 chars |
| `displayName` | Only if the user ticked "Show my name"; otherwise empty |
| `publicKey` | Requester's public key (JWK, base64) on `open` and `join` |
| `closeHash` | On `open`: SHA-256 of a random secret kept by the requester |
| `closeSecret` | On `close`: the secret; the board ignores a close whose secret doesn't hash to `closeHash` |

The Board aggregates rows by `requestId`: request details, the list of member keys (`open` and `join`), the member count, and closed state. No email is collected anywhere.

### 3.4 Replies form fields

One row **per recipient** (a request with 3 members gets 3 rows from one share):

| Field | Content |
| --- | --- |
| `requestId` | The request answered |
| `recipientKeyId` | Whose key this is encrypted for |
| `senderPublicKey` | A fresh (ephemeral) ECDH public key for this row |
| `iv` | AES-GCM IV |
| `ciphertext` | base64 of AES-GCM-256 over gzip(JSON `{ songText, displayName?, note?, sentAt }`) |

Key: ECDH(ephemeral private, recipient public) → HKDF-SHA-256 (info `"taalmel-reply-v1"`) → AES-GCM key. The size limit is 40 000 characters of ciphertext per row (Sheets cells hold 50 000); larger songs fail with "This song is too long to send this way; use Copy as text".

### 3.5 Requester journey

1. In Songs or "Add a song", the search finds nothing → **Ask the community**.
2. Form: title, artist, part, YouTube link, note, "Show my name" (with a name field). Before submitting, the app checks the Board for the same song (normalized title + artist): "2 people already asked for this. Add yourself?" → `join` instead of a duplicate.
3. **Requests → My requests** lists their requests: waiting / N replies / closed.
4. On app open and every 10 minutes while open, the app fetches the Replies CSV, keeps the rows whose `recipientKeyId` is one of its own, and decrypts them. A reply that fails to decrypt or doesn't parse as a valid song is dropped silently.
5. New reply → a Home card "Your request for *Karz theme* got a reply". Opening it shows a preview: sheet, Play notes, Play with video (the request's YouTube link), the sharer's name if they showed it, and their note. Several replies are shown side by side; "Hide" removes one locally.
6. **Add to my songs** copies it into their collection. **Close request** posts `close`, which removes it from the board.

### 3.6 Sharer journey

1. **Requests** tab: open requests with title, artist, part, member count, YouTube link and age. At the top: "You have songs for N requests", matched by fuzzy title (+ artist) comparison with the user's own songs (normalized, token overlap ≥ 0.6). Home shows the same nudge at most once a day.
2. **Share my version** → the matching song is pre-selected (or another can be picked) → a preview of exactly what is sent → optional "Show my name" and note → **Send**.
3. The app encrypts once per member key and posts one Replies row each: "Sent to 3 people." Sharers never see who the requesters are.

### 3.7 Moderation and abuse

- The owner deletes rows in the Requests responses sheet to remove spam or bad requests (the Board `QUERY` updates).
- **Report** on each request → the Report form (request id, reason).
- Junk replies can't be read by anyone but the recipient, who can hide them. Replies that don't parse as songs never show.
- Rate limiting isn't possible without a server; accepted as a risk at this scale.

---

## 4. Direct sharing (copy link / copy as text)

On any song: **Share** →

- **Copy link**: `https://taalmel.patel1771.com/s#<base64url(deflate(songText))>`. The song travels in the URL fragment, which browsers never send to the server. Opening it shows the same preview with **Add to my songs**. Songs whose link would be longer than 8 000 characters (chat apps truncate) offer only Copy as text.
- **Copy as text**: the canonical song text. It goes into "Add a song → I have Taalmel song text".
- The dialog states plainly: "Anyone with this link can open the song. Send it privately."

---

## 5. Privacy and legal

- The privacy page gains: what the request and reply forms store (song details, optional display name, public keys, encrypted data; never email), that replies are end-to-end encrypted, and that published requests are public.
- Terms gain: share only songs you have the right to share privately; the owner removes requests on complaint; a contact address for takedown requests.
- Names appear only with consent ("Show my name"), for both requesters and sharers.

---

## 6. Tests

- Crypto round trip: encrypt for a key, decrypt with the matching private key; wrong key fails; tampered ciphertext fails.
- Board aggregation from CSV fixtures: open + joins + valid/invalid close.
- Title matching: normalization, near-duplicates, false positives.
- Share links: round trip, length cut-off, malformed fragment.
- Open library: index parsing, "update available" logic.
- A fake Forms/Sheets layer (like `src/drive/testing/fakeDrive.ts`) for the request → reply → decrypt flow.
- The §3.1 prototype checks against real Google services, by hand.

---

## 7. Build order

1. Direct sharing (copy link / text): small and useful on its own.
2. Open library (static).
3. Prototype the Forms/Sheets round trip (§3.1).
4. Requests board and request flow.
5. Encrypted replies and the sharer flow.
6. Privacy/terms updates, owner setup checklist.

---

## 8. Owner checklist (manual)

1. Create the three forms and the Board tab (`QUERY` over responses); publish Board and Replies as CSV.
2. Put the URLs and entry ids in Vercel env vars. The five URL vars are `VITE_REQUESTS_FORM`, `VITE_REPLIES_FORM` and `VITE_REPORT_FORM` (each the form's `.../formResponse` URL) and `VITE_BOARD_CSV`, `VITE_REPLIES_CSV` (published CSV URLs). Entry ids go in one JSON var, `VITE_FORM_ENTRIES`, mapping each form's logical field names (section 3.3 and 3.4 field names; report: `requestId`, `reason`) to its `entry.<number>` id (find them via the form's "Get pre-filled link"): `{"requests":{"action":"entry.1","requestId":"entry.2","title":"entry.3","artist":"entry.4","part":"entry.5","youtubeUrl":"entry.6","note":"entry.7","displayName":"entry.8","publicKey":"entry.9","closeHash":"entry.10","closeSecret":"entry.11"},"replies":{"requestId":"entry.12","recipientKeyId":"entry.13","senderPublicKey":"entry.14","iv":"entry.15","ciphertext":"entry.16"},"report":{"requestId":"entry.17","reason":"entry.18"}}`. In the published CSVs the header row must use those same field names (name each form question exactly so; the Board CSV is the Requests responses, optionally with a `Timestamp` column).
3. Add a takedown contact address to the terms page.
