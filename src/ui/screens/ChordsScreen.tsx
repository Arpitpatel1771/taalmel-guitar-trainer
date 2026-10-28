// Chord library screen (chord library spec section 3).

import { useState, type FormEvent } from "react";
import { Mic, Play, Waves } from "lucide-react";
import type { Settings } from "../../model";
import { playChord } from "../../audio";
import {
  CHORD_TYPES,
  ROOTS,
  SLASH_CHORDS,
  chordDisplayName,
  chordKey,
  chordNotes,
  chordType,
  listVoicings,
  parseChordName,
  slashChordsFor,
  type ChordGroup,
  type ChordTypeId,
  type SlashChord,
  type Spelling,
  type Voicing,
} from "../../chords";
import { pcName, rootName } from "../../chords/theory";
import { ChordDiagram } from "../components/ChordDiagram";
import { FullNeck } from "../components/FullNeck";
import { Field, Segmented } from "../components/Controls";
import { ChordPractice, type PracticeMode } from "../chordPractice/ChordPractice";
import type { PickedChord } from "../chordPractice/picked";
import st from "./ChordsScreen.module.css";

type Mark = "learning" | "known";
type TypeSel = ChordTypeId | "slash";

const GROUPS: ChordGroup[] = ["Triads", "Sevenths", "Added & extended"];

/** Show real sharp and flat symbols in note and chord names. */
function pretty(s: string): string {
  return s.replace(/#/g, "♯").replace(/([A-G])b/g, "$1♭");
}

function positionLabel(v: Voicing): string {
  return v.source === "open" ? "open" : `${v.baseFret}fr`;
}

/** Rebuilds a chord from a stored mark key; null if the key is unknown. */
function fromKey(key: string): { rootPc: number; typeId: TypeSel; slash?: SlashChord } | null {
  if (key.startsWith("slash:")) {
    const slash = SLASH_CHORDS.find((s) => s.key === key);
    return slash ? { rootPc: slash.rootPc, typeId: "slash", slash } : null;
  }
  const [pc, typeId] = key.split(":");
  const rootPc = Number(pc);
  if (!Number.isInteger(rootPc) || rootPc < 0 || rootPc > 11) return null;
  if (!CHORD_TYPES.some((t) => t.id === typeId)) return null;
  return { rootPc, typeId: typeId as ChordTypeId };
}

export function ChordsScreen({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  const [tab, setTab] = useState<"browse" | "mine" | "practice">("browse");
  const [practiceStart, setPracticeStart] = useState<{ mode: PracticeMode; chord: PickedChord; voicingId?: string; nonce: number }>();
  const [rootPc, setRootPc] = useState(0);
  const [spelling, setSpelling] = useState<Spelling>("sharp");
  const [typeId, setTypeId] = useState<TypeSel>("maj");
  const [voicingId, setVoicingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const view = settings.chordView;
  const isSlash = typeId === "slash";
  const slashes = slashChordsFor(rootPc);
  const voicings = isSlash ? slashes.map((s) => s.voicing) : listVoicings(rootPc, typeId);
  const selected = voicings.find((v) => v.id === voicingId) ?? voicings[0] ?? null;
  const slash = isSlash ? (slashes.find((s) => s.voicing.id === selected?.id) ?? null) : null;

  // Chord currently shown (for slash chords, the selected slash chord).
  let current: { key: string; display: string; full: string; notes: string[]; formula: string; typeId: ChordTypeId; bassPc?: number } | null = null;
  if (slash) {
    const t = chordType(slash.typeId);
    current = {
      key: slash.key,
      display: pretty(slash.name),
      full: `${pretty(rootName(slash.rootPc))} ${t.name}, bass ${pretty(pcName(slash.bassPc, "sharp"))}`,
      notes: chordNotes(slash.rootPc, slash.typeId, "sharp"),
      formula: t.tones.map((x) => x.label).join(" "),
      typeId: slash.typeId,
      bassPc: slash.bassPc,
    };
  } else if (!isSlash) {
    const t = chordType(typeId);
    current = {
      key: chordKey(rootPc, typeId),
      display: pretty(chordDisplayName(rootPc, typeId, spelling)),
      full: `${pretty(rootName(rootPc, spelling))} ${t.name}`,
      notes: chordNotes(rootPc, typeId, spelling),
      formula: t.tones.map((x) => x.label).join(" "),
      typeId,
    };
  }
  const diagramRoot = slash ? slash.rootPc : rootPc;
  const mark = current ? settings.chordMarks[current.key] : undefined;

  function patchView(partial: Partial<Settings["chordView"]>) {
    onChange({ ...settings, chordView: { ...view, ...partial } });
  }

  function setMark(key: string, next: Mark | undefined) {
    const marks = { ...settings.chordMarks };
    if (next) marks[key] = next;
    else delete marks[key];
    onChange({ ...settings, chordMarks: marks });
  }

  function pickRoot(pc: number, sp: Spelling) {
    setRootPc(pc);
    setSpelling(sp);
    setVoicingId(null);
  }

  function pickType(t: TypeSel) {
    setTypeId(t);
    setVoicingId(null);
  }

  function open(target: { rootPc: number; typeId: TypeSel; spelling?: Spelling; voicingId?: string }) {
    setRootPc(target.rootPc);
    setSpelling(target.spelling ?? "sharp");
    setTypeId(target.typeId);
    setVoicingId(target.voicingId ?? null);
    setTab("browse");
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const text = query.trim();
    const parsed = text ? parseChordName(text) : null;
    if (!parsed) {
      setError(`Unknown chord "${text}". Try C, F#m7, Bbmaj7 or D/F#.`);
      return;
    }
    setError(null);
    if ("slash" in parsed) {
      const s = SLASH_CHORDS.find((c) => c.name === parsed.slash)!;
      open({ rootPc: s.rootPc, typeId: "slash", voicingId: s.voicing.id });
    } else {
      open(parsed);
    }
  }

  function play(v: Voicing, style: "strum" | "arpeggio") {
    void playChord(v.frets, style, { a4Hz: settings.a4Hz, volume: settings.playNotesVolume });
  }

  function diagram(v: Voicing, size: number) {
    const s = slashes.find((c) => c.voicing.id === v.id);
    return (
      <ChordDiagram
        voicing={v}
        rootPc={isSlash && s ? s.rootPc : rootPc}
        typeId={isSlash && s ? s.typeId : (typeId as ChordTypeId)}
        spelling={spelling}
        bassPc={isSlash ? s?.bassPc : undefined}
        title={isSlash && s ? s.name : undefined}
        labels={view.labels}
        orientation={view.orientation}
        leftHanded={settings.leftHanded}
        showNoteNames={view.noteNames}
        size={size}
      />
    );
  }

  const marked = Object.entries(settings.chordMarks)
    .map(([key, m]) => ({ key, m, chord: fromKey(key) }))
    .filter((x): x is { key: string; m: Mark; chord: NonNullable<ReturnType<typeof fromKey>> } => x.chord !== null)
    .map((x) => ({
      ...x,
      name: pretty(x.chord.slash ? x.chord.slash.name : chordDisplayName(x.chord.rootPc, x.chord.typeId as ChordTypeId, "sharp")),
    }))
    .sort((a, b) => a.chord.rootPc - b.chord.rootPc || a.name.localeCompare(b.name));
  const markedCount = marked.length;

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>Chords</h2>
        <Segmented
          label="Chords view"
          value={tab}
          options={[
            { value: "browse", label: "Library" },
            { value: "mine", label: `My chords${markedCount ? ` (${markedCount})` : ""}` },
            { value: "practice", label: "Practice" },
          ]}
          onChange={setTab}
        />
      </div>

      {tab === "practice" ? (
        <ChordPractice settings={settings} onChange={onChange} start={practiceStart} />
      ) : tab === "mine" ? (
        <div className={`${st.stack} ${st.mine}`}>
          {(["learning", "known"] as const).map((m) => {
            const items = marked.filter((x) => x.m === m);
            return (
              <div key={m} className={st.group}>
                <span className={st.groupLabel}>{m === "learning" ? "Learning" : "Known"}</span>
                {items.length === 0 ? (
                  <span className={st.empty}>Nothing here yet.</span>
                ) : (
                  <div className={st.chips}>
                    {items.map((x) => (
                      <button
                        key={x.key}
                        type="button"
                        className={st.chip}
                        onClick={() =>
                          open({
                            rootPc: x.chord.rootPc,
                            typeId: x.chord.typeId,
                            voicingId: x.chord.slash?.voicing.id,
                          })
                        }
                      >
                        {x.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={st.stack}>
          <form className={st.searchRow} onSubmit={onSearch}>
            <input
              className={st.search}
              type="text"
              placeholder="Search a chord: Cm7, F#, D/F#"
              aria-label="Search chord"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setError(null);
              }}
            />
            <button type="submit">Go</button>
            {error && (
              <span className={st.error} role="alert">
                {error}
              </span>
            )}
          </form>

          <div className={st.picker} role="group" aria-label="Root">
            {ROOTS.map((r) =>
              r.flat ? (
                <span key={r.pc} className={st.split}>
                  <button
                    type="button"
                    className={`${st.rootBtn}${rootPc === r.pc && spelling === "sharp" ? ` ${st.on}` : ""}`}
                    aria-pressed={rootPc === r.pc && spelling === "sharp"}
                    onClick={() => pickRoot(r.pc, "sharp")}
                  >
                    {pretty(r.sharp)}
                  </button>
                  <button
                    type="button"
                    className={`${st.rootBtn}${rootPc === r.pc && spelling === "flat" ? ` ${st.on}` : ""}`}
                    aria-pressed={rootPc === r.pc && spelling === "flat"}
                    onClick={() => pickRoot(r.pc, "flat")}
                  >
                    {pretty(r.flat)}
                  </button>
                </span>
              ) : (
                <button
                  key={r.pc}
                  type="button"
                  className={`${st.rootBtn}${rootPc === r.pc ? ` ${st.on}` : ""}`}
                  aria-pressed={rootPc === r.pc}
                  onClick={() => pickRoot(r.pc, "sharp")}
                >
                  {r.sharp}
                </button>
              ),
            )}
          </div>

          <div className={st.groups}>
            {GROUPS.map((g) => (
              <div key={g} className={st.group}>
                <span className={st.groupLabel}>{g}</span>
                <div className={st.chips}>
                  {CHORD_TYPES.filter((t) => t.group === g).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`${st.chip}${typeId === t.id ? ` ${st.on}` : ""}`}
                      aria-pressed={typeId === t.id}
                      onClick={() => pickType(t.id)}
                      title={t.name}
                    >
                      {t.suffix === "" ? "major" : t.suffix}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className={st.group}>
              <span className={st.groupLabel}>Inversions</span>
              <div className={st.chips}>
                <button
                  type="button"
                  className={`${st.chip}${isSlash ? ` ${st.on}` : ""}`}
                  aria-pressed={isSlash}
                  onClick={() => pickType("slash")}
                >
                  Slash
                </button>
              </div>
            </div>
          </div>

          {isSlash && slashes.length === 0 && <p className={st.empty}>None for this root yet.</p>}

          {current && selected && (
            <>
              <div className={st.header}>
                <div className={st.title}>
                  <span className={st.name}>{current.display}</span>
                  <span className={st.meta}>
                    {current.full} · notes {current.notes.map(pretty).join(" ")} · {current.formula}
                  </span>
                </div>
                <div className={st.actions}>
                  <button type="button" onClick={() => play(selected, "strum")}>
                    <Play size={14} /> Strum
                  </button>
                  <button type="button" onClick={() => play(selected, "arpeggio")}>
                    <Waves size={14} /> Arpeggio
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const chord: PickedChord =
                        typeId === "slash" && slash ? { slash: slash.name } : { rootPc, typeId: typeId === "slash" ? "maj" : typeId, spelling };
                      setPracticeStart({ mode: "mic", chord, voicingId: selected.id, nonce: Date.now() });
                      setTab("practice");
                    }}
                  >
                    <Mic size={14} /> Check with mic
                  </button>
                  <Segmented<Mark>
                    label="Mark"
                    value={(mark ?? "") as Mark}
                    options={[
                      { value: "learning", label: "Learning" },
                      { value: "known", label: "Known" },
                    ]}
                    onChange={(v) => setMark(current.key, v === mark ? undefined : v)}
                  />
                </div>
              </div>

              <div className={st.toolbar}>
                <Field label="Orientation">
                  <Segmented
                    label="Orientation"
                    value={view.orientation}
                    options={[
                      { value: "vertical", label: "Vertical" },
                      { value: "horizontal", label: "Horizontal" },
                    ]}
                    onChange={(v) => patchView({ orientation: v })}
                  />
                </Field>
                <Field label="Labels">
                  <Segmented
                    label="Labels"
                    value={view.labels}
                    options={[
                      { value: "fingers", label: "Fingers" },
                      { value: "intervals", label: "Intervals" },
                    ]}
                    onChange={(v) => patchView({ labels: v })}
                  />
                </Field>
                <Field label="Note names">
                  <Segmented
                    label="Note names"
                    value={view.noteNames ? "on" : "off"}
                    options={[
                      { value: "off", label: "Off" },
                      { value: "on", label: "On" },
                    ]}
                    onChange={(v) => patchView({ noteNames: v === "on" })}
                  />
                </Field>
              </div>

              <div className={st.cards}>
                {voicings.map((v) => {
                  const on = v.id === selected.id;
                  const s = slashes.find((c) => c.voicing.id === v.id);
                  return (
                    <div key={v.id} className={`${st.card}${on ? ` ${st.cardOn}` : ""}`}>
                      <button type="button" className={st.cardSelect} aria-pressed={on} onClick={() => setVoicingId(v.id)}>
                        {diagram(v, 20)}
                      </button>
                      <div className={st.cardFoot}>
                        <span className={st.pos}>
                          {isSlash && s ? `${pretty(s.name)} · ` : ""}
                          {positionLabel(v)}
                        </span>
                        <button type="button" className={st.playSmall} aria-label="Play this voicing" onClick={() => play(v, "strum")}>
                          <Play size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={st.neck}>
                <FullNeck
                  rootPc={diagramRoot}
                  typeId={current.typeId}
                  spelling={spelling}
                  bassPc={current.bassPc}
                  voicing={selected}
                  showNoteNames={view.noteNames}
                  leftHanded={settings.leftHanded}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
