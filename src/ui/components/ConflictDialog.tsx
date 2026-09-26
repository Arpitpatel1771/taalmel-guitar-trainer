// Library import conflict dialog (spec 11.5): replace / keep both / skip per
// conflicting song, with an "apply to all" shortcut, plus opt-in settings
// import.

import { useMemo, useState } from "react";
import { parse } from "../../songFormat";
import type { ConflictDecision, ImportPlan } from "../storageTypes";

export type LibraryImportPlan = Extract<ImportPlan, { kind: "library" }>;

export interface ConflictDialogDecisions {
  perSong: Record<string, ConflictDecision>;
  importSettings: boolean;
}

export interface ConflictDialogProps {
  plan: LibraryImportPlan;
  onConfirm: (decisions: ConflictDialogDecisions) => void;
  onCancel: () => void;
}

const RESOLUTION_LABELS: Record<ConflictDecision, string> = {
  replace: "Replace",
  keepBoth: "Keep both",
  skip: "Skip",
};

function titleFor(text: string, id: string): string {
  const result = parse(text);
  if (result.ok) return result.song.header.title;
  const m = /^title:\s*(.*)$/m.exec(text);
  return m?.[1]?.trim() || id;
}

export function ConflictDialog({ plan, onConfirm, onCancel }: ConflictDialogProps) {
  const conflictIds = useMemo(() => new Set(plan.conflicts), [plan]);
  const conflictEntries = useMemo(
    () => plan.songs.filter((s) => conflictIds.has(s.id)).map((s) => ({ id: s.id, title: titleFor(s.text, s.id) })),
    [plan, conflictIds],
  );
  const [perSong, setPerSong] = useState<Record<string, ConflictDecision>>(
    Object.fromEntries(conflictEntries.map((s) => [s.id, "skip" as ConflictDecision])),
  );
  const [applyToAll, setApplyToAll] = useState<ConflictDecision | "">("");
  const [importSettings, setImportSettings] = useState(false);

  function setOne(id: string, resolution: ConflictDecision) {
    setPerSong((prev) => ({ ...prev, [id]: resolution }));
  }

  function applyAll(resolution: ConflictDecision) {
    setApplyToAll(resolution);
    setPerSong(Object.fromEntries(conflictEntries.map((s) => [s.id, resolution])));
  }

  return (
    <div className="modal-overlay">
      <div className="modal conflict-dialog">
        <h3>Import {plan.songs.length} song(s){conflictEntries.length > 0 ? `, ${conflictEntries.length} already exist` : ""}</h3>
        {conflictEntries.length > 0 && (
          <>
            <p>Choose what to do with each conflicting song, or apply one choice to all.</p>
            <div className="apply-to-all">
              <label>
                Apply to all:
                <select value={applyToAll} onChange={(e) => applyAll(e.target.value as ConflictDecision)}>
                  <option value="">Choose…</option>
                  <option value="replace">Replace</option>
                  <option value="keepBoth">Keep both</option>
                  <option value="skip">Skip</option>
                </select>
              </label>
            </div>

            <ul className="conflict-list">
              {conflictEntries.map((s) => (
                <li key={s.id}>
                  <span className="conflict-title">{s.title}</span>
                  {(Object.keys(RESOLUTION_LABELS) as ConflictDecision[]).map((r) => (
                    <label key={r} className="checkbox">
                      <input
                        type="radio"
                        name={`conflict-${s.id}`}
                        checked={perSong[s.id] === r}
                        onChange={() => setOne(s.id, r)}
                      />
                      {RESOLUTION_LABELS[r]}
                    </label>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}

        {plan.settings && (
          <label className="checkbox">
            <input type="checkbox" checked={importSettings} onChange={(e) => setImportSettings(e.target.checked)} />
            Also import settings from this file
          </label>
        )}

        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={() => onConfirm({ perSong, importSettings })}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
