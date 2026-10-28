// A chord chosen for practice: a root + type (with spelling) or a named slash
// chord, plus helpers every practice mode shares (name, key, voicings, and
// rebuilding from a stored mark/stat key).

import {
  CHORD_TYPES,
  SLASH_CHORDS,
  chordDisplayName,
  chordKey,
  listVoicings,
  type ChordTypeId,
  type Spelling,
  type Voicing,
} from "../../chords";

export type PickedChord = { rootPc: number; typeId: ChordTypeId; spelling: Spelling } | { slash: string };

/** Real sharp/flat symbols for display. */
export function pretty(s: string): string {
  return s.replace(/#/g, "♯").replace(/([A-G])b/g, "$1♭");
}

export function pickedName(p: PickedChord): string {
  return "slash" in p ? p.slash : chordDisplayName(p.rootPc, p.typeId, p.spelling);
}

/** Spelling-independent key, as used for marks and stats. */
export function pickedKey(p: PickedChord): string {
  return "slash" in p ? `slash:${p.slash}` : chordKey(p.rootPc, p.typeId);
}

/** Voicings to offer, open shapes first. */
export function pickedVoicings(p: PickedChord): Voicing[] {
  if ("slash" in p) {
    const s = SLASH_CHORDS.find((c) => c.name === p.slash);
    return s ? [s.voicing] : [];
  }
  return listVoicings(p.rootPc, p.typeId);
}

/** Root pitch class and type used to draw diagrams (slash chords use their upper chord). */
export function pickedDiagramInfo(p: PickedChord): { rootPc: number; typeId: ChordTypeId; spelling: Spelling; bassPc?: number } {
  if ("slash" in p) {
    const s = SLASH_CHORDS.find((c) => c.name === p.slash)!;
    return { rootPc: s.rootPc, typeId: s.typeId, spelling: "sharp", bassPc: s.bassPc };
  }
  return p;
}

/** Rebuilds a chord from a mark/stat key ("6:m7", "slash:D/F#"); sharp spelling. null if unknown. */
export function pickedFromKey(key: string): PickedChord | null {
  if (key.startsWith("slash:")) {
    const name = key.slice("slash:".length);
    return SLASH_CHORDS.some((s) => s.name === name) ? { slash: name } : null;
  }
  const [pc, typeId] = key.split(":");
  const rootPc = Number(pc);
  if (!Number.isInteger(rootPc) || rootPc < 0 || rootPc > 11) return null;
  if (!CHORD_TYPES.some((t) => t.id === typeId)) return null;
  return { rootPc, typeId: typeId as ChordTypeId, spelling: "sharp" };
}

/** Chords marked in the library, Learning first. */
export function markedChords(marks: Record<string, "learning" | "known">): PickedChord[] {
  const order = (m: string) => (m === "learning" ? 0 : 1);
  return Object.entries(marks)
    .sort((a, b) => order(a[1]) - order(b[1]))
    .map(([k]) => pickedFromKey(k))
    .filter((p): p is PickedChord => p !== null);
}
