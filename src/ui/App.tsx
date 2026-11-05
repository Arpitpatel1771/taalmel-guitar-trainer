// App shell: settings load + persist banner, screen routing (spec 11.4).
// No external state/router library (spec 3): plain useState-based routing.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../model";
import type { StorageAdapter } from "./storageTypes";
import { Library } from "./screens/Library";
import { SongEditorScreen } from "./songEditor/SongEditorScreen";
import type { EditorStart } from "./songEditor/editorInit";
import { AddSong } from "./screens/AddSong";
import { SongView, type PracticeInitialState } from "./screens/SongView";
import { Exercises } from "./screens/Exercises";
import { SettingsScreen } from "./screens/Settings";
import { CalibrationScreen } from "./screens/Calibration";
import { TunerScreen } from "./screens/TunerScreen";
import { ChordsScreen } from "./screens/ChordsScreen";
import { MetronomeScreen } from "./screens/MetronomeScreen";
import { RecorderScreen } from "./screens/RecorderScreen";
import type { ClipRecord } from "../recording";
import { SAMPLE_SONGS } from "../samples";
import { ShellProvider, useShell, useStatusSlot } from "./shell/AppShellContext";
import { Rail, type NavTarget } from "./shell/Rail";
import { Pocket, type PocketHide } from "./shell/Pocket";
import { Home, type HomeTarget } from "./screens/Home";
import { pickedFromName, type PickedChord } from "./chordPractice/picked";
import { useTheme, resolveTheme, systemPrefersDark } from "./theme";
import { ChipRow, StatusChip } from "./shell/StatusChip";
import { AccountChip } from "../drive/AccountChip";
import { DriveSyncProvider, useDriveSync } from "../drive/useDriveSync";
import { DriveDialogs } from "../drive/DriveUi";
import shellStyles from "./shell/Shell.module.css";
import { SharingProvider } from "./sharing/SharingContext";
import { SharedScreen, type SharedTab } from "./sharing/SharedScreen";
import { ShareLinkScreen } from "./sharing/ShareLinkScreen";
import { AskDialog } from "./sharing/AskCommunity";
import { HomeSharingCards } from "./sharing/HomeCards";

export interface AppProps {
  storage: StorageAdapter;
}

type Screen =
  | { kind: "home" }
  | { kind: "library" }
  | { kind: "shared"; tab?: SharedTab; focus?: string; ask?: string }
  | { kind: "share-link"; fragment: string }
  | { kind: "song"; id: string; initial?: PracticeInitialState }
  | { kind: "sample"; id: string; initial?: PracticeInitialState }
  | { kind: "new-song" }
  | { kind: "editor"; key: string; start: EditorStart }
  | { kind: "exercises" }
  | { kind: "chords"; start?: "practice"; pair?: [PickedChord, PickedChord] }
  | { kind: "tuner" }
  | { kind: "metronome" }
  | { kind: "recorder" }
  | { kind: "settings" }
  | { kind: "calibration"; returnTo: "library" | "settings" };

/** A shared-song link (`/s#...`) opens its preview first; everything else starts at Home. */
function initialScreen(): Screen {
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/s") {
    return { kind: "share-link", fragment: window.location.hash };
  }
  return { kind: "home" };
}

export function App({ storage }: AppProps) {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [persisted, setPersisted] = useState(true);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [askTitle, setAskTitle] = useState<string | null>(null);
  const [songText, setSongText] = useState<string | null>(null);
  const [songError, setSongError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await storage.loadSettings();
        setSettingsState(loaded);
      } catch (err) {
        setGlobalError(err instanceof Error ? err.message : String(err));
      }
      setSettingsLoaded(true);
      try {
        const ok = await storage.requestPersist();
        setPersisted(ok);
      } catch {
        setPersisted(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistSettings(next: Settings) {
    setSettingsState(next);
    void storage.saveSettings(next).catch((err) => {
      setGlobalError(err instanceof Error ? err.message : String(err));
    });
  }

  useEffect(() => {
    if (screen.kind !== "song") return;
    let cancelled = false;
    setSongText(null);
    setSongError(null);
    void (async () => {
      try {
        const record = await storage.getSong(screen.id);
        if (cancelled) return;
        if (!record) {
          setSongError(`Song ${screen.id} was not found.`);
          return;
        }
        setSongText(record.text);
      } catch (err) {
        if (!cancelled) setSongError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, storage]);

  async function handleSaveSong(text: string, id?: string): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      await storage.saveSong(text, id);
      setRefreshToken((t) => t + 1);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function handleSaveNewSong(text: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    try {
      const record = await storage.saveSong(text);
      setRefreshToken((t) => t + 1);
      return { ok: true, id: record.id };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function handleSaveFromEditor(text: string, songId?: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    try {
      const record = await storage.saveSong(text, songId);
      setRefreshToken((t) => t + 1);
      return { ok: true, id: record.id };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  function openEditor(start: EditorStart) {
    const key = start.kind === "draft" ? start.draft.id : start.kind === "song" ? `song-${start.songId}` : `new-${Date.now()}`;
    setScreen({ kind: "editor", key, start });
  }

  const openCalibration = useCallback(() => setScreen({ kind: "calibration", returnTo: "library" }), []);

  useTheme(settings.theme, settings.accent);
  // Re-render when the OS mode flips so the rail toggle icon follows "system".
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!settingsLoaded) {
    return <div className="app-shell screen">Loading…</div>;
  }

  const activeNav: NavTarget | null =
    screen.kind === "home" || screen.kind === "settings" || screen.kind === "chords" || screen.kind === "exercises" || screen.kind === "recorder"
      ? screen.kind
      : screen.kind === "shared"
      ? "shared"
      : screen.kind === "library" || screen.kind === "new-song" || screen.kind === "editor" || screen.kind === "song" || screen.kind === "sample"
        ? "library"
        : null;
  const inPractice = screen.kind === "song" || screen.kind === "sample";
  const pocketHide: PocketHide = screen.kind === "tuner" ? "tuner" : screen.kind === "metronome" ? "metronome" : screen.kind === "recorder" ? "recorder" : null;

  /** Saves an example as an editable library copy and opens it. */
  async function addCopy(text: string) {
    const r = await handleSaveNewSong(text);
    if (r.ok) setScreen({ kind: "song", id: r.id });
    else setGlobalError(r.message);
  }

  /** Leaves the /s share page for the app proper (and cleans the address bar). */
  function leaveShareLink(next: Screen) {
    window.history.replaceState(null, "", "/");
    setScreen(next);
  }

  function navigate(target: NavTarget | HomeTarget) {
    if (target === "calibration") setScreen({ kind: "calibration", returnTo: "library" });
    else if (target === "changes") {
      const a = pickedFromName("A");
      const d = pickedFromName("D");
      setScreen(a && d ? { kind: "chords", start: "practice", pair: [a, d] } : { kind: "chords", start: "practice" });
    }
    else setScreen({ kind: target });
  }

  const content = (
    <>
      {screen.kind === "home" && (
        <Home
          storage={storage}
          onOpen={navigate}
          onContinue={(r) => {
            const initial = { loop: r.loop };
            setScreen(r.sample ? { kind: "sample", id: r.songId, initial } : { kind: "song", id: r.songId, initial });
          }}
          onGoAgain={(names) => {
            const a = pickedFromName(names[0]);
            const b = pickedFromName(names[1]);
            setScreen(a && b ? { kind: "chords", start: "practice", pair: [a, b] } : { kind: "chords", start: "practice" });
          }}
          onOpenSample={(id) => setScreen({ kind: "sample", id })}
          slot={
            <HomeSharingCards
              onOpenReplies={(id) => setScreen({ kind: "shared", tab: "requests", focus: id })}
              onOpenRequests={() => setScreen({ kind: "shared", tab: "requests" })}
            />
          }
        />
      )}

      {screen.kind === "shared" && (
        <SharedScreen
          key={`${screen.tab}-${screen.focus}-${screen.ask}`}
          storage={storage}
          settings={settings}
          refreshToken={refreshToken}
          onChanged={() => setRefreshToken((t) => t + 1)}
          onOpenSong={(id) => setScreen({ kind: "song", id })}
          initialTab={screen.tab}
          focusRequestId={screen.focus}
          askPrefill={screen.ask}
        />
      )}

      {screen.kind === "share-link" && (
        <ShareLinkScreen
          fragment={screen.fragment}
          settings={settings}
          onAdd={async (text) => {
            const r = await handleSaveNewSong(text);
            if (r.ok) leaveShareLink({ kind: "song", id: r.id });
            else setGlobalError(r.message);
          }}
          onLeave={() => leaveShareLink({ kind: "home" })}
        />
      )}

      {askTitle !== null && (
        <AskDialog
          initialTitle={askTitle}
          onClose={() => setAskTitle(null)}
          onDone={() => {
            setAskTitle(null);
            setScreen({ kind: "shared", tab: "requests" });
          }}
        />
      )}

      {screen.kind === "library" && (
        <Library
          storage={storage}
          onOpenSong={(id) => setScreen({ kind: "song", id })}
          onNewSong={() => setScreen({ kind: "new-song" })}
          onOpenExercises={() => setScreen({ kind: "exercises" })}
          onOpenSettings={() => setScreen({ kind: "settings" })}
          showPersistBanner={false}
          onDismissPersistBanner={() => persistSettings({ ...settings, persistBannerDismissed: true })}
          refreshToken={refreshToken}
          onOpenSample={(id) => setScreen({ kind: "sample", id })}
          onAsk={(q) => setAskTitle(q)}
          onAddSample={(text) => void addCopy(text)}
        />
      )}

      {screen.kind === "sample" &&
        (() => {
          const sample = SAMPLE_SONGS.find((x) => x.id === screen.id);
          return sample ? (
            <SongView
              key={`sample-${sample.id}`}
              recentId={{ songId: sample.id, sample: true }}
              initialState={screen.initial}
              initialText={sample.text}
              settings={settings}
              // Examples are read-only: saving an edited example creates a
              // library copy and opens it.
              onSave={async (text) => {
                const r = await handleSaveNewSong(text);
                if (r.ok) setScreen({ kind: "song", id: r.id });
                return r.ok ? { ok: true as const } : r;
              }}
              onBack={() => setScreen({ kind: "library" })}
              onSettingsChange={persistSettings}
            />
          ) : (
            <div className="screen">
              <div className="notice notice-error">Example song not found.</div>
            </div>
          );
        })()}

      {screen.kind === "new-song" && (
        <AddSong
          settings={settings}
          onSaveSong={handleSaveNewSong}
          onSaved={(id) => setScreen({ kind: "song", id })}
          onCancel={() => setScreen({ kind: "library" })}
          onOpenEditor={openEditor}
          onOpenSharedLibrary={() => setScreen({ kind: "shared" })}
        />
      )}

      {screen.kind === "editor" && (
        <SongEditorScreen
          key={screen.key}
          settings={settings}
          onSettingsChange={persistSettings}
          start={screen.start}
          onSave={handleSaveFromEditor}
          onSaved={(id) => setScreen({ kind: "song", id })}
          onExit={() => {
            const st = screen.start;
            const songId = st.kind === "song" ? st.songId : st.kind === "draft" ? st.draft.songId : undefined;
            setScreen(songId ? { kind: "song", id: songId } : { kind: "new-song" });
          }}
        />
      )}

      {screen.kind === "song" &&
        (songError ? (
          <div className="screen">
            <div className="notice notice-error">{songError}</div>
            <button onClick={() => setScreen({ kind: "library" })}>Back to library</button>
          </div>
        ) : songText === null ? (
          <div className="screen">Loading…</div>
        ) : (
          <SongView
            key={screen.id}
            recentId={{ songId: screen.id }}
            initialState={screen.initial}
            initialText={songText}
            settings={settings}
            onSave={(text) => handleSaveSong(text, screen.kind === "song" ? screen.id : undefined)}
            onBack={() => setScreen({ kind: "library" })}
            onEdit={(text) => openEditor({ kind: "song", songId: screen.id, songText: text })}
            onSettingsChange={persistSettings}
          />
        ))}

      {screen.kind === "exercises" && (
        <Exercises
          settings={settings}
          onSaveAsSong={handleSaveNewSong}
          onSaved={(id) => setScreen({ kind: "song", id })}
          onBack={() => setScreen({ kind: "library" })}
          onSettingsChange={persistSettings}
        />
      )}

      {screen.kind === "chords" && <ChordsScreen settings={settings} onChange={persistSettings} startPractice={screen.start === "practice"} startChanges={screen.pair} />}

      {screen.kind === "tuner" && <TunerScreen settings={settings} onChange={persistSettings} />}

      {screen.kind === "metronome" && <MetronomeScreen settings={settings} onChange={persistSettings} />}

      {screen.kind === "recorder" && <RecorderWithDrive settings={settings} />}

      {screen.kind === "settings" && (
        <SettingsScreen
          settings={settings}
          onChange={persistSettings}
          onOpenCalibration={() => setScreen({ kind: "calibration", returnTo: "settings" })}
          onBack={() => setScreen({ kind: "library" })}
        />
      )}

      {screen.kind === "calibration" && (
        <CalibrationScreen
          calibration={settings.calibration}
          onSave={(c) => {
            persistSettings({ ...settings, calibration: c });
            setScreen({ kind: screen.returnTo });
          }}
          onBack={() => setScreen({ kind: screen.returnTo })}
        />
      )}
    </>
  );

  return (
    <ShellProvider openCalibration={openCalibration}>
      <DriveProviderWithToasts>
      <GlobalErrorToast error={globalError} onShown={() => setGlobalError(null)} />
      <DriveDialogs />
      <SharingProvider storage={storage} settings={settings} onSettingsChange={persistSettings}>
      <div className={shellStyles.layout}>
        <Rail
          active={activeNav}
          onNavigate={navigate}
          theme={settings.theme}
          resolvedDark={resolveTheme(settings.theme, systemDark) === "dark"}
          onThemeChange={(theme) => persistSettings({ ...settings, theme })}
          account={<AccountChip collapsed onOpenSettings={() => setScreen({ kind: "settings" })} />}
        />
        <main className={shellStyles.main}>
          <StatusSlot />
          {!persisted && !settings.persistBannerDismissed ? (
            <ChipRow>
              <StatusChip
                tone="warning"
                title="Your browser may clear the library to free space. Export it regularly from the Library."
                onClick={() => persistSettings({ ...settings, persistBannerDismissed: true })}
              >
                Storage not persistent
              </StatusChip>
            </ChipRow>
          ) : null}
          {content}
        </main>
      </div>
      <Pocket settings={settings} onSettingsChange={persistSettings} hide={pocketHide} inPractice={inPractice} />
      </SharingProvider>
      </DriveProviderWithToasts>
    </ShellProvider>
  );
}

/** Top-right home of the status chips (spec 3.3); ChipRow portals into it. */
function StatusSlot() {
  const { setSlot } = useStatusSlot();
  return <div className={shellStyles.statusSlot} ref={setSlot} />;
}

/** Surfaces app-level storage errors as an error toast (stays until dismissed). */
function GlobalErrorToast({ error, onShown }: { error: string | null; onShown: () => void }) {
  const { toast } = useShell();
  useEffect(() => {
    if (!error) return;
    toast(error, "error");
    onShown();
  }, [error, toast, onShown]);
  return null;
}

/** Drive sync context; unexpected sync errors surface as error toasts. */
function DriveProviderWithToasts({ children }: { children: ReactNode }) {
  const { toast } = useShell();
  const onError = useCallback((m: string) => toast(`Drive: ${m}`, "error"), [toast]);
  return <DriveSyncProvider onError={onError}>{children}</DriveSyncProvider>;
}

/** Recorder with Drive-backed media download (progress shown in the clip badge). */
function RecorderWithDrive({ settings }: { settings: Settings }) {
  const { toast } = useShell();
  const drive = useDriveSync();
  const connected = drive.status.state !== "disconnected";
  const onNeedMedia = useCallback(
    async (clip: ClipRecord, onProgress?: (fraction: number) => void) => {
      if (!clip.driveFileId) return null;
      const blob = await drive.downloadClipMedia(clip.id, onProgress);
      toast("Downloaded.");
      return blob;
    },
    [drive, toast],
  );
  return <RecorderScreen settings={settings} onNeedMedia={connected ? onNeedMedia : undefined} />;
}
