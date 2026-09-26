// Session summary panel, spec 9.6. Shown when playback stops after at least
// 4 expected events. Not persisted.

import type { SessionSummary } from "../../audio";

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
  return (
    <div className="summary-table">
      <h4>{title}</h4>
      <table>
        <tbody>
          <tr>
            <td>On time</td>
            <td>
              {summary.onTime} ({pct(summary.onTime, total)})
            </td>
          </tr>
          <tr>
            <td>Close</td>
            <td>
              {summary.close} ({pct(summary.close, total)})
            </td>
          </tr>
          <tr>
            <td>Off</td>
            <td>
              {summary.off} ({pct(summary.off, total)})
            </td>
          </tr>
          <tr>
            <td>Missed</td>
            <td>
              {summary.missed} ({pct(summary.missed, total)})
            </td>
          </tr>
          <tr>
            <td>Extra onsets</td>
            <td>{summary.extra}</td>
          </tr>
          <tr>
            <td>Tendency</td>
            <td>
              {summary.meanSignedErrorMs === null
                ? "n/a"
                : `${Math.abs(Math.round(summary.meanSignedErrorMs))} ms ${summary.meanSignedErrorMs < 0 ? "early" : "late"}`}
            </td>
          </tr>
          <tr>
            <td>Pitch</td>
            <td>
              {summary.pitch.right} right / {summary.pitch.wrong} wrong / {summary.pitch.unknown} unknown
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function SessionSummaryPanel({ lastPass, allPasses, onClose }: SessionSummaryPanelProps) {
  return (
    <div className="session-summary-panel">
      <div className="session-summary-header">
        <h3>Session summary</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <div className="session-summary-body">
        <SummaryTable title={allPasses ? "Last pass" : "This take"} summary={lastPass} />
        {allPasses && <SummaryTable title="All passes" summary={allPasses} />}
      </div>
    </div>
  );
}
