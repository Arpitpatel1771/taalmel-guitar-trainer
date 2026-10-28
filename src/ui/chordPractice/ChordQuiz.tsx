// Name-that-chord quiz (chord practice spec section 2).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { playChord } from "../../audio";
import {
  OPTION_COUNT,
  generateRound,
  poolChords,
  quizKey,
  quizName,
  quizVoicing,
  recordResults,
  type QuizChord,
  type QuizKind,
  type QuizPool,
  type QuizQuestion,
} from "../../chords/practice/quiz";
import { ChordDiagram } from "../components/ChordDiagram";
import { Segmented } from "../components/Controls";
import { markedChords, pickedDiagramInfo, pretty } from "./picked";
import type { PracticeModeProps } from "./ChordPractice";
import shared from "./ChordPractice.module.css";
import st from "./ChordQuiz.module.css";

type Phase =
  | { kind: "setup" }
  | { kind: "round"; questions: QuizQuestion[]; index: number; picked: number | null; results: boolean[] }
  | { kind: "done"; questions: QuizQuestion[]; results: boolean[] };

export function ChordQuiz({ settings, onChange }: PracticeModeProps) {
  const [kind, setKind] = useState<QuizKind>("name");
  const [pool, setPool] = useState<QuizPool>("mine");
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });

  const mine = useMemo(() => markedChords(settings.chordMarks) as QuizChord[], [settings.chordMarks]);
  const poolList = useMemo(() => poolChords(pool, mine), [pool, mine]);
  const usingFallback = pool === "mine" && mine.length === 0;

  function start() {
    const questions = generateRound(kind, poolList, Math.random);
    setPhase({ kind: "round", questions, index: 0, picked: null, results: [] });
  }

  const play = useCallback(
    (c: QuizChord) => {
      const v = quizVoicing(c);
      if (v) void playChord(v.frets, "strum", { a4Hz: settings.a4Hz, volume: settings.playNotesVolume });
    },
    [settings.a4Hz, settings.playNotesVolume],
  );

  function diagram(c: QuizChord, size: number, title: string) {
    const v = quizVoicing(c)!;
    const info = pickedDiagramInfo(c);
    return (
      <ChordDiagram
        voicing={v}
        rootPc={info.rootPc}
        typeId={info.typeId}
        spelling={info.spelling}
        bassPc={info.bassPc}
        title={title}
        labels={settings.chordView.labels}
        orientation={settings.chordView.orientation}
        leftHanded={settings.leftHanded}
        showNoteNames={settings.chordView.noteNames}
        size={size}
      />
    );
  }

  const answered = phase.kind === "round" && phase.picked !== null;

  const next = useCallback(() => {
    setPhase((p) => {
      if (p.kind !== "round" || p.picked === null) return p;
      if (p.index + 1 < p.questions.length) return { ...p, index: p.index + 1, picked: null };
      return { kind: "done", questions: p.questions, results: p.results };
    });
  }, []);

  // Save stats once when a round finishes.
  const doneResults = phase.kind === "done" ? phase.results : null;
  const doneQuestions = phase.kind === "done" ? phase.questions : null;
  // In an effect, not during render: onChange updates the App's state.
  const savedForRef = useRef<boolean[] | null>(null);
  useEffect(() => {
    if (!doneResults || !doneQuestions || savedForRef.current === doneResults) return;
    savedForRef.current = doneResults;
    const quiz = recordResults(
      settings.chordStats.quiz,
      doneQuestions.map((q, i) => ({ key: quizKey(q.answer), correct: doneResults[i] })),
    );
    onChange({ ...settings, chordStats: { ...settings.chordStats, quiz } });
  }, [doneResults, doneQuestions, settings, onChange]);

  useEffect(() => {
    if (!answered) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest("button[data-own-enter]")) return; // that button handles Enter itself
      e.preventDefault();
      next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answered, next]);

  if (phase.kind === "setup") {
    return (
      <div className={shared.card}>
        <div className={st.setup}>
          <div className={st.row}>
            <span className={st.label}>Kind</span>
            <Segmented
              label="Quiz kind"
              value={kind}
              options={[
                { value: "name", label: "Name it" },
                { value: "find", label: "Find it" },
              ]}
              onChange={setKind}
            />
          </div>
          <div className={st.row}>
            <span className={st.label}>Chords</span>
            <Segmented
              label="Chord pool"
              value={pool}
              options={[
                { value: "mine", label: "My chords" },
                { value: "open", label: "Open chords" },
                { value: "all", label: "Everything" },
              ]}
              onChange={setPool}
            />
          </div>
          <p className={st.hint}>
            {kind === "name" ? "A diagram is shown; pick its name." : "A name is shown; pick its diagram."}
            {usingFallback ? " You have no marked chords yet, so open chords are used." : ""}
          </p>
          <div>
            <button type="button" className="primary" onClick={start}>
              Start (10 questions)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === "done") {
    const score = phase.results.filter(Boolean).length;
    const missed = new Map<string, QuizChord>();
    phase.questions.forEach((q, i) => {
      if (!phase.results[i]) missed.set(quizKey(q.answer), q.answer);
    });
    return (
      <div className={shared.card}>
        <p className={st.score}>
          {score} / {phase.questions.length}
        </p>
        {missed.size === 0 ? (
          <p className={st.hint}>No misses. Nice.</p>
        ) : (
          <>
            <p className={st.hint}>Missed chords</p>
            <ul className={st.missed}>
              {[...missed.entries()].map(([key, chord]) => {
                const learning = settings.chordMarks[key] === "learning";
                return (
                  <li key={key} className={st.missedItem}>
                    <span>{pretty(quizName(chord))}</span>
                    <button
                      type="button"
                      disabled={learning}
                      onClick={() =>
                        onChange({ ...settings, chordMarks: { ...settings.chordMarks, [key]: "learning" } })
                      }
                    >
                      {learning ? "Learning" : "Mark as learning"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className={st.actions}>
          <button type="button" className="primary" onClick={start}>
            Play again
          </button>
          <button type="button" onClick={() => setPhase({ kind: "setup" })}>
            Change setup
          </button>
        </div>
      </div>
    );
  }

  const round = phase;
  const q = round.questions[round.index];
  const picked = phase.picked;
  const isLast = phase.index + 1 === phase.questions.length;

  function choose(i: number) {
    if (picked !== null) return;
    const ok = i === q.correctIndex;
    if (ok || q.kind === "name") play(q.answer);
    setPhase({ ...round, picked: i, results: [...round.results, ok] });
  }

  return (
    <div className={shared.card}>
      <div className={st.progress}>
        <span>
          Question {phase.index + 1} of {phase.questions.length}
        </span>
        <span>{phase.results.filter(Boolean).length} correct</span>
      </div>
      <div className={st.prompt}>
        {q.kind === "name" ? diagram(q.answer, 26, "Chord to name") : <p className={st.bigName}>{pretty(quizName(q.answer))}</p>}
        <button type="button" data-own-enter onClick={() => play(q.answer)}>
          <Play size={14} aria-hidden /> Play
        </button>
      </div>
      <div className={st.options} role="group" aria-label="Answers">
        {q.options.slice(0, OPTION_COUNT).map((o, i) => {
          const cls = [st.option, q.kind === "find" ? st.optionDiagram : ""];
          if (picked !== null) {
            if (i === q.correctIndex) cls.push(st.correct);
            else if (i === picked) cls.push(st.wrong);
            else cls.push(st.dim);
          }
          return (
            <button
              key={quizKey(o)}
              type="button"
              className={cls.filter(Boolean).join(" ")}
              disabled={picked !== null && i !== q.correctIndex && i !== picked}
              onClick={() => choose(i)}
              aria-label={q.kind === "find" ? `Option ${i + 1}${picked !== null ? `: ${quizName(o)}` : ""}` : undefined}
            >
              {q.kind === "name" ? (
                pretty(quizName(o))
              ) : (
                <>
                  {diagram(o, 14, `Option ${i + 1}`)}
                  {picked !== null && <span>{pretty(quizName(o))}</span>}
                </>
              )}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <>
          <p className={`${st.feedback} ${picked === q.correctIndex ? st.feedbackOk : st.feedbackBad}`}>
            {picked === q.correctIndex ? "Correct" : `Not quite: it is ${pretty(quizName(q.answer))}`}
          </p>
          <div className={st.actions}>
            <button type="button" className="primary" data-own-enter autoFocus onClick={next}>
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
