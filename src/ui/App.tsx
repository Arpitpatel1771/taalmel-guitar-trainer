// App shell: settings load + persist banner, screen routing (spec 11.4).
// No external state/router library (spec 3): plain useState-based routing.

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../model";
import type { StorageAdapter } from "./storageTypes";
import { Library } from "./screens/Library";
import { NewSong } from "./screens/NewSong";
import { SongView } from "./screens/SongView";
import { Exercises } from "./screens/Exercises";
import { SettingsScreen } from "./screens/Settings";
import { CalibrationScreen } from "./screens/Calibration";
import { TunerScreen } from "./screens/TunerScreen";
import { ShellProvider, useShell } from "./shell/AppShellContext";
import { Sidebar, type NavTarget } from "./shell/Sidebar";
import { StatusChip } from "./shell/StatusChip";
import shellStyles from "./shell/Shell.module.css";

export interface AppProps {
  storage: StorageAdapter;
}

type Screen =
  | { kind: "library" }
  | { kind: "song"; id: string }
  | { kind: "new-song" }
  | { kind: "exercises" }
  | { kind: "tuner" }
  | { kind: "settings" }
  | { kind: "calibration"; returnTo: "library" | "settings" };

export function App({ storage }: AppProps) {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [persisted, setPersisted] = useState(true);
  const [screen, setScreen] = useState<Screen>({ kind: "library" });
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

  const openCalibration = useCallback(() => setScreen({ kind: "calibration", returnTo: "library" }), []);

  if (!settingsLoaded) {
    return <div className="app-shell screen">Loading…</div>;
  }

  const focusMode = screen.kind === "song";
  const activeNav: NavTarget | null = screen.kind === "song" ? null : screen.kind;

  function navigate(target: NavTarget) {
    if (target === "calibration") setScreen({ kind: "calibration", returnTo: "library" });
    else setScreen({ kind: target });
  }

  const content = (
    <>

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
        />
      )}

      {screen.kind === "new-song" && (
        <NewSong
          settings={settings}
          onSaveSong={handleSaveNewSong}
          onSaved={(id) => setScreen({ kind: "song", id })}
          onCancel={() => setScreen({ kind: "library" })}
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
            initialText={songText}
            settings={settings}
            onSave={(text) => handleSaveSong(text, screen.kind === "song" ? screen.id : undefined)}
            onBack={() => setScreen({ kind: "library" })}
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

      {screen.kind === "tuner" && <TunerScreen settings={settings} onChange={persistSettings} />}

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
      <GlobalErrorToast error={globalError} onShown={() => setGlobalError(null)} />
      {focusMode ? (
        <div className={shellStyles.main}>{content}</div>
      ) : (
        <div className={shellStyles.layout}>
          <Sidebar
            active={activeNav}
            onNavigate={navigate}
            footer={
              !persisted && !settings.persistBannerDismissed ? (
                <StatusChip
                  tone="warning"
                  title="Your browser may clear the library to free space. Export it regularly from the Library."
                  onClick={() => persistSettings({ ...settings, persistBannerDismissed: true })}
                >
                  Storage not persistent
                </StatusChip>
              ) : null
            }
          />
          <main className={shellStyles.main}>{content}</main>
        </div>
      )}
    </ShellProvider>
  );
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
