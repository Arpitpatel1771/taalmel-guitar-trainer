// Parse error/warning list with click-to-jump (spec 11.1 step 6).

import type { ParseError } from "../../model";

export interface ErrorListProps {
  errors: ParseError[];
  onJump: (line: number) => void;
}

export function ErrorList({ errors, onJump }: ErrorListProps) {
  if (errors.length === 0) return null;
  return (
    <ul className="error-list">
      {errors.map((e, i) => (
        <li
          key={i}
          className={`error-item ${e.severity === "warning" ? "warning" : "error"}`}
          onClick={() => onJump(e.line)}
        >
          <span className="error-location">
            Line {e.line}
            {e.bar !== undefined ? `, bar ${e.bar}` : ""}
            {e.slot !== undefined ? `, slot ${e.slot}` : ""}:
          </span>{" "}
          {e.message}
          {e.token && <code className="error-token"> {e.token}</code>}
        </li>
      ))}
    </ul>
  );
}
