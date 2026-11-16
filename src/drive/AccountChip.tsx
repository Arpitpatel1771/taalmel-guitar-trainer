// Google-style account chip at the bottom of the icon rail (avatar only when collapsed): a thin wrapper over the
// package's DriveAccountChip, with Taalmel's look. The menu is a popover on laptops and a bottom sheet on phones/tablets.

import { useEffect, useRef } from "react";
import { Download, LogIn, LogOut, RefreshCw, Settings as SettingsIcon, TriangleAlert } from "lucide-react";
import { DriveAccountChip } from "@arpitpatel1771/drive-sync/react";
import { useCompact } from "../ui/compact";
import { BottomSheet } from "../ui/components/BottomSheet";
import dock from "../ui/components/TransportDock.module.css";
import st from "./AccountChip.module.css";

function AccountMenu({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const compact = useCompact();
  const ref = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const showPopover = open && !compact;
  useEffect(() => {
    if (!showPopover) return;
    const onDown = (e: MouseEvent) => {
      const root = ref.current?.parentElement;
      if (root && !root.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showPopover]);
  const content = <div className={st.menu}>{children}</div>;
  if (compact) {
    return (
      <BottomSheet open={open} onClose={onClose} title={title}>
        {content}
      </BottomSheet>
    );
  }
  if (!open) return null;
  return (
    <div ref={ref} className={dock.popover} role="dialog" aria-label={title} style={{ width: 300, left: 0, right: "auto" }}>
      {content}
    </div>
  );
}

const MENU_ICONS = {
  resume: <LogIn size={16} />,
  conflicts: <TriangleAlert size={16} />,
  sync: <RefreshCw size={16} />,
  import: <Download size={16} />,
  settings: <SettingsIcon size={16} />,
  disconnect: <LogOut size={16} />,
};

export function AccountChip({ collapsed, onOpenSettings }: { collapsed: boolean; onOpenSettings: () => void }) {
  return (
    <DriveAccountChip
      className={st.root}
      compact={collapsed}
      subtitle="Back up & sync your library"
      onOpenSettings={onOpenSettings}
      uploadLabel={() => "Upload recordings"}
      icons={MENU_ICONS}
      renderMenu={(p) => <AccountMenu {...p} />}
    />
  );
}
