// Small modal for the sharing flows: backdrop, title, Escape and backdrop click close.

import { useEffect, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { usePhone } from "../compact";
import st from "./sharing.module.css";

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  // Phones get a full-screen page with a back arrow; tablets a centred sheet (CSS); laptops are unchanged.
  const phone = usePhone();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={st.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${st.dialog}${wide ? ` ${st.wide}` : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className={st.dialogHead}>
          {phone && (
            <button type="button" className={`btn-ghost ${st.close}`} onClick={onClose} aria-label="Back">
              <ArrowLeft size={20} />
            </button>
          )}
          <h3>{title}</h3>
          {!phone && (
            <button type="button" className={`btn-ghost ${st.close}`} onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
