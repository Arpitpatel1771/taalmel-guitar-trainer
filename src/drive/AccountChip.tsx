// Google-style account chip at the top of the sidebar: sign-in button when disconnected,
// avatar + name (with a sync status dot) and an account menu when connected.

import { useState } from "react";
import { Download, LogOut, RefreshCw, Settings as SettingsIcon, TriangleAlert, LogIn } from "lucide-react";
import { Popover } from "../ui/components/Popover";
import { Segmented } from "../ui/components/Controls";
import { useShell } from "../ui/shell/AppShellContext";
import type { UploadSetting } from "./engine";
import { chipFor, dotTone, initialsFor, relativeTime } from "./syncUi";
import { useDriveSync } from "./useDriveSync";
import st from "./AccountChip.module.css";

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function Avatar({ picture, name, email, size, tone }: { picture: string | null; name: string | null; email: string | null; size: number; tone?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImg = picture && failed !== picture;
  return (
    <span className={st.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {showImg ? (
        <img src={picture} referrerPolicy="no-referrer" alt="" onError={() => setFailed(picture)} />
      ) : (
        <span className={st.initials} aria-hidden>
          {initialsFor(name, email)}
        </span>
      )}
      {tone && <span className={`${st.dot} ${st[tone]}`} data-tone={tone} />}
    </span>
  );
}

export function AccountChip({ collapsed, onOpenSettings }: { collapsed: boolean; onOpenSettings: () => void }) {
  const drive = useDriveSync();
  const { toast } = useShell();
  const [busy, setBusy] = useState(false);
  if (!drive.configured) return null;
  const { status } = drive;

  async function run(fn: () => Promise<unknown>, close?: () => void) {
    close?.();
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  if (status.state === "disconnected") {
    return (
      <button
        className={`${st.signIn}${collapsed ? ` ${st.signInCollapsed}` : ""}`}
        disabled={busy}
        title={collapsed ? "Sign in with Google" : undefined}
        aria-label={collapsed ? "Sign in with Google" : undefined}
        onClick={() => void run(drive.connect)}
      >
        <GoogleG />
        {!collapsed && (
          <span className={st.text}>
            <span className={st.name}>Sign in with Google</span>
            <span className={st.sub}>Back up &amp; sync your library</span>
          </span>
        )}
      </button>
    );
  }

  const chip = chipFor(status);
  const tone = dotTone(status);
  const { name, email, picture } = status;
  const label = name ?? email ?? "Google account";

  return (
    <div className={st.root}>
      <Popover
        label={`Account: ${label}`}
        placement="down"
        align="left"
        width={300}
        triggerClassName={`${st.chip}${collapsed ? ` ${st.chipCollapsed}` : ""}`}
        trigger={
          <>
            <Avatar picture={picture} name={name} email={email} size={28} tone={tone} />
            {!collapsed && (
              <span className={st.text}>
                <span className={st.name}>{label}</span>
                {name && email && <span className={st.sub}>{email}</span>}
              </span>
            )}
          </>
        }
      >
        {(close) => (
          <div className={st.menu}>
            <div className={st.header}>
              <Avatar picture={picture} name={name} email={email} size={44} />
              <span className={st.text}>
                <span className={st.name}>{label}</span>
                {name && email && <span className={st.sub}>{email}</span>}
              </span>
            </div>
            <div className={st.statusLine}>
              <span className={`${st.dotInline} ${st[tone]}`} />
              <span>
                {chip?.text}
                {status.lastSyncAt ? ` · Last synced ${relativeTime(status.lastSyncAt)}` : ""}
              </span>
            </div>
            {status.state === "authRequired" && (
              <button className={st.item} onClick={() => void run(drive.connect, close)}>
                <LogIn size={16} /> Sign in to resume
              </button>
            )}
            {status.conflicts.length > 0 && (
              <button
                className={st.item}
                onClick={() => {
                  drive.setConflictsOpen(true);
                  close();
                }}
              >
                <TriangleAlert size={16} /> Resolve {status.conflicts.length} {status.conflicts.length === 1 ? "conflict" : "conflicts"}
              </button>
            )}
            <button className={st.item} disabled={busy} onClick={() => void run(drive.syncNow, close)}>
              <RefreshCw size={16} /> Sync now
            </button>
            <div className={st.uploadRow}>
              <span className={st.sub}>Upload recordings</span>
              <Segmented<UploadSetting>
                label="Upload recordings to Drive"
                value={drive.uploadSetting}
                options={[
                  { value: "off", label: "Off" },
                  { value: "audio", label: "Audio only" },
                  { value: "all", label: "Everything" },
                ]}
                onChange={(v) => void run(() => drive.setUploadSetting(v))}
              />
            </div>
            <button
              className={st.item}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await drive.importFromDrive();
                  if (r) toast(`Imported ${r.songs} song(s) and ${r.clips} recording(s).`);
                }, close)
              }
            >
              <Download size={16} /> Import from Drive
            </button>
            <button
              className={st.item}
              onClick={() => {
                close();
                onOpenSettings();
              }}
            >
              <SettingsIcon size={16} /> Drive settings
            </button>
            <button className={`${st.item} ${st.danger}`} disabled={busy} onClick={() => void run(drive.disconnect, close)}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}
