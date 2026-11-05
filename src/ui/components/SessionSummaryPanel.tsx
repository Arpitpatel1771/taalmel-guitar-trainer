// Session summary panel, spec 9.6. Opened from the transport's summary button once a take with at
// least 4 expected events has been scored (never pops up by itself). Not persisted.

import { Fragment } from "react";
import { X } from "lucide-react";
import type { SessionSummary } from "../../audio";
import ss from "./SessionSummary.module.css";

export interface SessionSummaryPanelProps {
  lastPass: SessionSummary;
  allPasses: SessionSummary | null;
  onClose: () => void;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function SummaryTable({ title, summary }: { title: string; summary: SessionSummary }) {
  const total = summary.totalExpected;
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  const tendency = summary.meanSignedErrorMs;
  const rows: { label: string; n: number; cls: string }[] = [
    { label: "On time", n: summary.onTime, cls: ss.segOn },
    { label: "Close", n: summary.close, cls: ss.segClose },
    { label: "Off", n: summary.off, cls: ss.segOff },
    { label: "Missed", n: summary.missed, cls: ss.segMissed },
  ];
  return (
    <section className={ss.section}>
      <div className={ss.sectionTitle}>{title}</div>
      {tendency !== null && (
        <div>
          <div className={`${ss.headline} ${tendency < 0 ? ss.early : ss.late}`}>
            {Math.abs(Math.round(tendency))} ms {tendency < 0 ? "early" : "late"}
          </div>
          <div className={ss.headlineSub}>Your average timing ({tendency < 0 ? "rushing" : "dragging"})</div>
        </div>
      )}
      <div className={ss.bar} role="img" aria-label={rows.map((r) => `${r.label} ${pct(r.n, total)}`).join(", ")}>
        {rows.map((r) => (
          <span key={r.label} className={r.cls} style={{ width: w(r.n) }} />
        ))}
      </div>
      <dl className={ss.stats}>
        {rows.map((r) => (
          <Fragment key={r.label}>
            <dt>
              <span className={`${ss.swatch} ${r.cls}`} /> {r.label}
            </dt>
            <dd>
              {r.n} · {pct(r.n, total)}
            </dd>
          </Fragment>
        ))}
        <dt>Extra plucks</dt>
        <dd>{summary.extra}</dd>
        <dt>Wrong notes</dt>
        <dd className={ss.wrong}>{summary.pitch.wrong}</dd>
        <dt>Pitch right / unknown</dt>
        <dd>
          {summary.pitch.right} / {summary.pitch.unknown}
        </dd>
      </dl>
      <p className={ss.hint}>
        Blue is on time, pink is clearly early or late (underlined). A small tick marks which way. A wrong note shows the note you played above the fret.
      </p>
    </section>
  );
}

export function SessionSummaryPanel({ lastPass, allPasses, onClose }: SessionSummaryPanelProps) {
  return (
    <aside className={ss.panel} aria-label="Session summary">
      <div className={ss.header}>
        <h3>Session summary</h3>
        <button className="btn-ghost" onClick={onClose} aria-label="Close summary">
          <X size={16} />
        </button>
      </div>
      <div className={ss.body}>
        <SummaryTable title={allPasses ? "Last pass" : "This take"} summary={lastPass} />
        {allPasses && <SummaryTable title="All passes" summary={allPasses} />}
      </div>
    </aside>
  );
}
