// Bottom tab bar (specs/8-11-mobile.md §3.1): the compact layout's replacement for the rail. Five slots:
// Home · Songs · Library · Chords · More; More opens a sheet with the remaining destinations, the theme
// switch and the account chip.

import { useEffect, useState, type ReactNode } from "react";
import { MoreHorizontal, Settings } from "lucide-react";
import type { ThemePref } from "../../model";
import { BottomSheet } from "../components/BottomSheet";
import { NAV, ThemeToggle, type NavTarget } from "./Rail";
import styles from "./TabBar.module.css";

export type TabSlot = "home" | "library" | "shared" | "chords" | "more";

const TAB_TARGETS: NavTarget[] = ["home", "library", "shared", "chords"];

/** Which slot lights up for the current destination (Exercises, Recordings and Settings live under More). */
export function tabForTarget(active: NavTarget | null): TabSlot | null {
  if (active === null) return null;
  return (TAB_TARGETS as string[]).includes(active) ? (active as TabSlot) : "more";
}

/** Full-height screens (practice, editor) hide the tab bar and use their own back arrow. */
export function hidesTabBar(screenKind: string): boolean {
  return screenKind === "song" || screenKind === "sample" || screenKind === "editor";
}

export function TabBar({
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
  resolvedDark: boolean;
  onThemeChange: (next: ThemePref) => void;
  account?: ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const slot = tabForTarget(active);
  // Any navigation (a More row, or the account menu's "Drive settings") closes the sheet.
  useEffect(() => setMoreOpen(false), [active]);
  const go = (t: NavTarget) => {
    setMoreOpen(false);
    onNavigate(t);
  };
  const tab = (key: TabSlot, label: string, icon: ReactNode, onClick: () => void) => (
    <button
      key={key}
      type="button"
      aria-haspopup={key === "more" ? "dialog" : undefined}
      aria-expanded={key === "more" ? moreOpen : undefined}
      className={`${styles.tab}${slot === key ? ` ${styles.active}` : ""}`}
      onClick={onClick}
      aria-current={slot === key ? "page" : undefined}
    >
      {icon}
      <span className={styles.label}>{label}</span>
    </button>
  );
  const moreItems = NAV.filter((n) => !TAB_TARGETS.includes(n.target));

  return (
    <>
      <nav className={styles.bar} aria-label="Tabs">
        {NAV.filter((n) => TAB_TARGETS.includes(n.target)).map((n) => tab(n.target as TabSlot, n.label, n.icon, () => go(n.target)))}
        {tab("more", "More", <MoreHorizontal size={22} />, () => setMoreOpen(true))}
      </nav>
      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className={styles.moreList}>
          {[...moreItems, { target: "settings" as NavTarget, label: "Settings", icon: <Settings size={22} /> }].map((n) => (
            <button
              key={n.target}
              type="button"
              className={`${styles.moreRow}${active === n.target ? ` ${styles.moreActive}` : ""}`}
              onClick={() => go(n.target)}
              aria-current={active === n.target ? "page" : undefined}
            >
              {n.icon}
              <span>{n.label}</span>
            </button>
          ))}
          <ThemeToggle theme={theme} resolvedDark={resolvedDark} onThemeChange={onThemeChange} className={styles.moreRow} />
          {account && <div className={styles.account}>{account}</div>}
        </div>
      </BottomSheet>
    </>
  );
}
