# Google Drive sync

Status: approved in conversation 2026-10-28.

## Goal

Use the user's Google Drive for three things at once:
1. **Backup:** the library, settings and recordings survive the browser clearing its storage.
2. **Sync across devices:** the same library on laptop and desktop.
3. **Real files:** songs and recordings are normal files in a visible Drive folder that can be opened, shared or edited outside the app.

The browser's local storage (IndexedDB) stays the primary copy. The app keeps working instantly and offline, and syncs with Drive in the background.

## Configuration

- **Browser-only OAuth** with Google Identity Services (token model). No server, no client secret.
- **Scopes:** `https://www.googleapis.com/auth/drive.file` (only files this app created or the user picked) plus `email`, to show the connected account.
- **Vite env vars:**
  - `VITE_GOOGLE_CLIENT_ID`
  - `VITE_GOOGLE_API_KEY` (Picker)
  - `VITE_GOOGLE_APP_ID` (project number, Picker)
- **Where they live:** locally in `.env.local` (git-ignored via `.env.*`). In production, in the Vercel project settings, deployed at `https://taalmel-khaki.vercel.app`.
- **Registered JavaScript origins:** `http://localhost:5173`, `https://taalmel-khaki.vercel.app`.
- **If the env vars are missing**, the Drive section in Settings shows "Not configured" and nothing else changes.
- **Script loading:** Google scripts load on demand from `https://accounts.google.com/gsi/client` and `https://apis.google.com/js/api.js` (Picker), never at app start.

## 1. Drive layout

```
Taalmel/
  Songs/        <Title>.txt            exact song text (the app's song format)
  Recordings/   <Clip name>.<mp4|webm|m4a|mp3|ogg>
  .taalmel/     settings.json
                clips/<clipId>.json     flags, waveform peaks, duration, createdAt, hasVideo, mimeType
```

- **The app creates the folders** on first connect. If a `Taalmel` folder made by this app already exists (another device), it is reused, found by its `appProperties`.
- **Every file the app creates** carries `appProperties`: `{ taalmelKind: "song" | "clip" | "clipMeta" | "settings" | "folder", taalmelId }`. Identity uses `taalmelId`, never the file name or location, so renaming or moving a file in Drive keeps the link.
- **Song file names:** the sanitised title plus `.txt`, with " (2)", " (3)" … added on clashes within `Songs/`. Changing a song's title in the app renames its file. Renaming a file in Drive does not change the song: the title lives in the text.
- **Synced settings** are every `Settings` field **except** these device-local ones: `calibration`, `micEnabled`, `persistBannerDismissed`. `settings.json` stores `{ updatedAt, settings }`.

## 2. Connection and auth

- **Connect:** Settings gets a **Google Drive** section. **Connect** requests a token through a popup triggered by the click. The section then shows the connected email, a **Disconnect** button, the **Upload recordings to Drive** setting (Off / Audio only / Everything, default **Audio only**) and an **Import from Drive** button.
- **Tokens:**
  - **Kept in memory only.**
  - **On load, or when a token is within 2 minutes of expiry,** request one silently with `prompt: ""`.
  - **If Google needs interaction,** sync pauses and the status chip shows **"Drive: sign in to resume"**. Clicking it opens the popup, so it's always a user gesture. The app never opens a popup on its own.
- **Disconnect:** stops sync and forgets the connection metadata. Local data and Drive files are untouched.
- **Connection state** is kept in the sync DB (below): account email, folder ids, the changes page token and the last sync time. It is restored on reload, so reconnecting only needs a token.

## 3. Sync engine

### Local sync state

A new IndexedDB database, `taalmel-sync`, with these stores:
- `items`, keyed `kind:id`: `{ kind, id, driveFileId, lastSyncedHash, lastRemoteVersion, deletedLocally? }`. `lastSyncedHash` is a content hash (SHA-256 of the song text, the settings JSON, or the clip-meta JSON) at the last successful sync. `lastRemoteVersion` is Drive's `version` at that time.
- `queue`: pending operations `{ op: "upsert" | "delete" | "uploadMedia", kind, id, enqueuedAt, attempts, resumableUrl? }`, de-duplicated per `kind:id`.
- `meta`: connection info, folder ids, `changesPageToken`.

### Push

- **Enqueueing:** every local mutation enqueues an operation. That covers song save and delete, settings save, clip create, rename, flags, peaks and delete, plus media upload when the clip is eligible under the upload setting or the user clicked Upload. The storage modules emit change events, and the sync layer subscribes and enqueues; the UI doesn't call sync directly.
- **Flushing:** the queue is flushed after a 2 s debounce, and also when coming back online or getting a fresh token.
- **Retries:** failures retry with exponential backoff (2 s → 5 min cap). Operations persist across reloads.

### Pull

`changes.list` (from the stored page token) runs on app start, on tab focus, every 60 s while visible, and after a push. Each changed file with `taalmelKind` is reconciled:

| Local changed since last sync? | Remote changed? | Action |
|---|---|---|
| no | yes | apply remote locally |
| yes | no | push local (already queued) |
| yes | yes, different content | **song:** conflict; **settings/clipMeta:** newest `updatedAt` wins |
| — | remote trashed/removed | **song:** ask the user (batched) "Deleted in Drive — delete here too?"; **clip:** remove local copy after the same confirmation; **settings:** ignore |

- **Pulled songs** are stored with their `taalmelId` as the local id. A pulled song whose text fails to parse is still stored; it shows its errors in the editor like any broken song.
- **Remote `.txt` files without `appProperties`** (e.g. picked via Import) are adopted: they're assigned a `taalmelId`, which is written back to the file's `appProperties`.

### Conflicts (songs)

- **Detection:** the local text hash and the remote version both differ from the last synced state.
- **Storage:** conflicts are kept, both texts included, until resolved. The status chip shows "N conflicts".
- **The dialog** shows the two texts side by side, both titles, and when each changed. The choices are:
  - **Keep this device's:** overwrites Drive.
  - **Keep Drive's:** overwrites local.
  - **Keep both:** the remote version becomes a new song "Title (Drive)" with a new id, and local overwrites Drive.
- **Reuse:** the dialog follows the existing import `ConflictDialog` pattern.

### Deletes

- **Deleting a song locally** moves its Drive file to the trash (`trashed: true`), so it's recoverable for 30 days.
- **Remote deletions** need the confirmation described above. Declining re-uploads the local copy.

### First connect / merge

- **Linking:** find or create the folders, then list all app-tagged files.
- **Matching by `taalmelId`:**
  - **Only local:** upload.
  - **Only remote:** download.
  - **Both, same hash:** link.
  - **Both, different:** conflict.
- **Settings:** newest wins, judged by `updatedAt`. Local settings without an `updatedAt` count as older.
- **Clips:** follow the section 4 rules.

### Import from Drive

- **The picker:** Google Picker restricted to `.txt`, video and audio types, with multi-select.
- **Picked `.txt` files** are imported as songs (adopted as above) and **moved into** `Taalmel/Songs/` if they live elsewhere.
- **Picked media** become clips: duration is probed and the waveform is computed, then a clip-meta file is created. The media file is moved into `Taalmel/Recordings/`.

## 4. Recordings

- **`ClipRecord` gains:**
  - `driveFileId?: string`
  - `driveStatus: "local" | "uploading" | "inDrive"` (computed from the sync state, not stored on the record)
  - `blob: Blob | null`, where `null` means "In Drive, not downloaded on this device".
- **Every clip** gets a clip-meta file in `.taalmel/clips/`, even when its media isn't uploaded. The other devices then know it exists; they show it greyed with "Not uploaded (on another device)".
- **Media upload:**
  - **Eligibility:** depends on the setting. Off: manual only. Audio only: `!hasVideo`. Everything: all clips.
  - **How it uploads:** Drive resumable uploads in 8 MB chunks. The session URL is saved in the queue item, so a reload resumes; if the session has expired, the upload restarts.
  - **Progress** shows in the clip row.
- **Clip list status:**
  - **This device only:** with an **Upload to Drive** button.
  - **Uploading N%**
  - **In Drive**
  - **In Drive · not downloaded:** for clips from other devices. Name, duration, flags and waveform still show, from the meta file. Play or Trim downloads the media first, with progress, and stores the blob locally.
- **"Remove from this device"** applies to clips that are in Drive. It sets the blob to null, freeing the space.
- **Delete** removes the clip locally and moves both its media and meta files to the Drive trash. The UI keeps the two actions separate.
- **Renames and flag edits** update the clip-meta file, newest-wins. Renaming also renames the media file.

## 5. Status, errors and testing

### Sync status chip (sidebar footer)

| State | Chip |
|---|---|
| Connected and idle | **Synced** |
| Working | **Syncing…** |
| No network | **Offline — saved locally** |
| Google needs interaction | **Drive: sign in to resume** |
| Errors are being retried | **Retrying** |
| Uploads blocked by quota | **Drive full — uploads paused** |
| Song conflicts pending | **N conflicts** (opens the dialog) |

When not connected, there is no chip.

### Errors

- **401:** refresh the token silently once; if that fails, show **sign in to resume**.
- **403 rate limit, 429, 5xx:** back off and retry.
- **403 `storageQuotaExceeded`:** show **Drive full**, pause media uploads, keep syncing metadata.
- **404:** treat as a remote delete.
- **Network failure:** show **Offline** and retry when back online.
- **Anything unexpected:** show an error toast. Local data is never deleted except by a user-confirmed delete.

### Code structure (`src/drive/`)

- `config.ts`: env vars, `isDriveConfigured()`.
- `auth.ts`: loads GIS and manages the token (silent and interactive requests, expiry). It is behind an interface so tests can fake it.
- `api.ts`: a thin `fetch` wrapper over Drive REST v3:
  - find, create and update folders
  - list files with `appProperties` queries
  - get, create and update metadata and media
  - trash
  - resumable upload
  - `changes.getStartPageToken` and `changes.list`
- `syncDb.ts`: the `taalmel-sync` IndexedDB.
- `engine.ts`: reconcile, push and pull logic, written against a `DriveApi` interface.
- `picker.ts`: Google Picker.
- `useDriveSync.ts`: React context and hook exposing status, conflicts and actions.
- **Storage modules** (`src/storage/songs.ts`, `settings.ts`, `src/recording/clipStore.ts`) gain a small change-event emitter. Their existing APIs stay compatible.

### Testing

- **A `FakeDrive`** implements `DriveApi` in memory, with `version`, `trashed`, `appProperties` and a changes feed.
- **Engine tests** cover:
  - first connect with an empty Drive and with existing data
  - a local-only edit, a remote-only edit, both edited (conflict), and each conflict resolution
  - local and remote deletes, including declining a remote delete
  - a rename in Drive (link kept), and adopting an untagged `.txt`
  - a remote song that fails to parse
  - the queue persisting across an engine restart, offline then online, and 401 handling to sign-in-required
  - device-local settings never leaving the device
  - settings and clip-meta newest-wins
  - clip media upload eligibility per setting, resumable chunking and resume
- **Headless Chrome against the fake:** chip states, the conflict dialog, clip Drive badges and the Settings section.
- **Not automatable** (needs the user's Google account), so it's left as a manual checklist for the first real run:
  - connect, and confirm the folder tree appears in Drive
  - edit a song in the app and see the Drive file change
  - edit the `.txt` in Drive and see the app update within a minute
  - make a conflicting edit and resolve it
  - sync an audio clip, and see a video clip upload when uploaded manually
  - a second browser or device shows the same library
