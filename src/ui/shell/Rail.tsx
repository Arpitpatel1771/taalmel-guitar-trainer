// Icon rail (specs/5-11-ui-redesign.md 3.1): 88px, logo to Home, destinations
// with the icon above a short label, settings + theme + account at the bottom.

import { useRef, type ReactNode } from "react";
import { AudioLines, Dumbbell, Guitar, House, Library, Moon, Music, Settings, Sun } from "lucide-react";
import type { ThemePref } from "../../model";
import { nextThemePref, systemPrefersDark } from "../theme";
import styles from "./Rail.module.css";

export type NavTarget = "home" | "library" | "shared" | "chords" | "exercises" | "recorder" | "settings";

const NAV: { target: NavTarget; label: string; icon: ReactNode }[] = [
  { target: "home", label: "Home", icon: <House size={22} /> },
  { target: "library", label: "Songs", icon: <Music size={22} /> },
  { target: "shared", label: "Library", icon: <Library size={22} /> },
  { target: "chords", label: "Chords", icon: <Guitar size={22} /> },
  { target: "exercises", label: "Exercises", icon: <Dumbbell size={22} /> },
  { target: "recorder", label: "Recordings", icon: <AudioLines size={22} /> },
];

const LONG_PRESS_MS = 600;

export function Rail({
  active,
  onNavigate,
  theme,
  resolvedDark,
  onThemeChange,
  account,
}: {
  active: NavTarget | null;
  onNavigate: (target: NavTarget) => void;
  theme: ThemePref;
  /** Whether the app is currently showing the dark mode (decides the toggle icon). */
  resolvedDark: boolean;
  onThemeChange: (next: ThemePref) => void;
  /** Account chip slot (rendered as an avatar). */
  account?: ReactNode;
}) {
  // Click cycles dark/light; holding the button switches back to "system".
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  function startHold() {
    held.current = false;
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      onThemeChange("system");
    }, LONG_PRESS_MS);
  }
  function endHold() {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  const item = (target: NavTarget, label: string, icon: ReactNode) => (
    <button
      key={target}
      type="button"
      className={`${styles.item}${active === target ? ` ${styles.itemActive}` : ""}`}
      onClick={() => onNavigate(target)}
      aria-current={active === target ? "page" : undefined}
    >
      {icon}
      <span className={styles.label}>{label}</span>
    </button>
  );

  return (
    <nav className={styles.rail} aria-label="Main">
      <button type="button" className={styles.logo} onClick={() => onNavigate("home")} aria-label="Taalmel home" title="Home">
        <img src="/favicon.svg" width={44} height={44} alt="" />
      </button>
      <div className={styles.group}>{NAV.map((n) => item(n.target, n.label, n.icon))}</div>
      <div className={`${styles.group} ${styles.bottom}`}>
        {item("settings", "Settings", <Settings size={22} />)}
        <button
          type="button"
          className={styles.item}
          title={theme === "system" ? "Theme: system (click for dark/light)" : `Theme: ${theme} (hold for system)`}
          aria-label={`Switch to ${resolvedDark ? "light" : "dark"} mode`}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onClick={() => {
            if (held.current) {
              held.current = false;
              return;
            }
            onThemeChange(nextThemePref(theme, systemPrefersDark()));
          }}
        >
          {resolvedDark ? <Sun size={22} /> : <Moon size={22} />}
          <span className={styles.label}>{theme === "system" ? "Auto" : resolvedDark ? "Dark" : "Light"}</span>
        </button>
        {account && <div className={styles.account}>{account}</div>}
      </div>
    </nav>
  );
}
