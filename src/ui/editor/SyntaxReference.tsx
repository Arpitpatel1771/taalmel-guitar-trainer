// Collapsible cheat sheet of the song format (spec 5), shown next to the
// editor so the available terms are always one click away.

import { BookOpen } from "lucide-react";
import { META_FLAGS } from "./songCompletions";
import styles from "./Editor.module.css";

const TOKENS: [string, string][] = [
  ["2S5", "string 2, fret 5 (string 1 = high E)"],
  ["{3}", "notes after this start on slot 3"],
  ["(12)", "after Bar n: — this bar has 12 slots"],
  ["[2]", "length: 2 slots (default 1)"],
  ["[3X1/16]", "length: three sixteenths, any grid"],
  ["[>-15]", "nudge 15 ms early (>20 = late)"],
  ["[?]", "rhythm is a guess (highlighted)"],
  ["[2>-15?]", "all combined: length, nudge, guess"],
  ["# text", "comment line"],
];

const TAB: [string, string][] = [
  ["e: 3h5p4", "{1} 1S3 {2} 1S5(hammer) {3} 1S4(pull)"],
  ["e: 3/5\\2", "{1} 1S3 {2} 1S5(slide) {4} 1S2(slide)"],
  ["B: 7b9r7", "{1} 2S7 {3} 2S7(bend: 2) {5} 2S7(bend: 0)"],
];

export function SyntaxReference() {
  return (
    <details className={styles.syntax}>
      <summary className={styles.syntaxSummary}>
        <BookOpen size={14} /> Syntax reference <span className={styles.syntaxHint}>· type ( after a note for suggestions</span>
      </summary>
      <div className={styles.syntaxBody}>
        <div className={styles.syntaxCol}>
          <div className={styles.syntaxTitle}>Notes and timing</div>
          <table className={styles.syntaxTable}>
            <tbody>
              {TOKENS.map(([t, d]) => (
                <tr key={t}>
                  <td><code>{t}</code></td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.syntaxCol}>
          <div className={styles.syntaxTitle}>Flags, inside ( ) after a note, comma-separated</div>
          <table className={styles.syntaxTable}>
            <tbody>
              {META_FLAGS.map((f) => (
                <tr key={f.key}>
                  <td><code>{f.value ? `${f.key}: ${f.value}` : f.key}</code></td>
                  <td>{f.info}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.syntaxTitle}>From tab</div>
          <table className={styles.syntaxTable}>
            <tbody>
              {TAB.map(([t, d]) => (
                <tr key={t}>
                  <td><code>{t}</code></td>
                  <td><code>{d}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
