import { useState, type ReactNode } from "react";
import { Dumbbell, Library, PanelLeftClose, PanelLeftOpen, Plus, Settings, Timer } from "lucide-react";
import styles from "./Shell.module.css";

export type NavTarget = "library" | "new-song" | "exercises" | "calibration" | "settings";

const NAV: { target: NavTarget; label: string; icon: ReactNode }[] = [
  { target: "library", label: "Library", icon: <Library size={18} /> },
  { target: "new-song", label: "New song", icon: <Plus size={18} /> },
  { target: "exercises", label: "Exercises", icon: <Dumbbell size={18} /> },
  { target: "calibration", label: "Calibration", icon: <Timer size={18} /> },
  { target: "settings", label: "Settings", icon: <Settings size={18} /> },
];

const COLLAPSED_KEY = "taalmel.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function Sidebar({
  active,
  onNavigate,
  footer,
}: {
  active: NavTarget | null;
  onNavigate: (target: NavTarget) => void;
  footer?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Per-viewer convenience only; ignore storage failures.
    }
  }

  return (
    <nav className={`${styles.sidebar}${collapsed ? ` ${styles.sidebarCollapsed}` : ""}`} aria-label="Main">
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden>
          ♪
        </span>
        <span className={styles.brandName}>Taalmel</span>
      </div>
      {NAV.map((item) => (
        <button
          key={item.target}
          className={`${styles.navItem}${active === item.target ? ` ${styles.navItemActive}` : ""}`}
          onClick={() => onNavigate(item.target)}
          title={collapsed ? item.label : undefined}
          aria-current={active === item.target ? "page" : undefined}
        >
          <span className={styles.navIcon}>{item.icon}</span>
          <span className={styles.navLabel}>{item.label}</span>
        </button>
      ))}
      <div className={styles.sidebarFooter}>
        {!collapsed && footer}
        <button className={styles.navItem} onClick={toggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <span className={styles.navIcon}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</span>
          <span className={styles.navLabel}>Collapse</span>
        </button>
      </div>
    </nav>
  );
}
