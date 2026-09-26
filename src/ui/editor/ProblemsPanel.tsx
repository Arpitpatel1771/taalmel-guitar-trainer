// VS Code-style problems panel for parse errors/warnings (spec 11.1 step 6;
// UI revamp 7). Clicking a row jumps the editor to that line/column.

import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { ParseError } from "../../model";
import styles from "./Editor.module.css";

export function ProblemsPanel({
  errors,
  onJump,
  actions,
}: {
  errors: ParseError[];
  onJump: (line: number, column?: number) => void;
  actions?: ReactNode;
}) {
  const errorCount = errors.filter((e) => e.severity !== "warning").length;
  const warningCount = errors.length - errorCount;
  return (
    <div className={styles.problems}>
      <div className={styles.problemsHeader}>
        {errors.length === 0 ? (
          <span className={`${styles.count} ${styles.countOk}`}>
            <CircleCheck size={14} /> No problems
          </span>
        ) : (
          <>
            <span className={`${styles.count} ${styles.countError}`}>
              <CircleAlert size={14} /> {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
            <span className={`${styles.count} ${styles.countWarning}`}>
              <TriangleAlert size={14} /> {warningCount} warning{warningCount === 1 ? "" : "s"}
            </span>
          </>
        )}
        <span className={styles.actionsEnd}>{actions}</span>
      </div>
      {errors.length > 0 && (
        <ul className={styles.problemsList}>
          {errors.map((e, i) => {
            const warn = e.severity === "warning";
            return (
              <li
                key={i}
                className={`${styles.problem} ${warn ? styles.problemWarning : styles.problemError}`}
                onClick={() => onJump(e.line, e.column)}
              >
                <span className={styles.problemIcon}>{warn ? <TriangleAlert size={13} /> : <CircleAlert size={13} />}</span>
                <span className={styles.problemMsg}>
                  {e.message} {e.token && <code className={styles.token}>{e.token}</code>}
                </span>
                <span className={styles.problemLoc}>
                  Ln {e.line}
                  {e.bar !== undefined ? ` · bar ${e.bar}` : ""}
                  {e.slot !== undefined ? ` · slot ${e.slot}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
