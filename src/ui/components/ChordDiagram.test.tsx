import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { listVoicings, SLASH_CHORDS } from "../../chords";
import { ChordDiagram, type ChordDiagramProps } from "./ChordDiagram";
import { FullNeck } from "./FullNeck";

const count = (html: string, s: string) => html.split(s).length - 1;
const base = { labels: "fingers", orientation: "vertical", leftHanded: false, showNoteNames: false } as const;

function diagram(rootPc: number, typeId: ChordDiagramProps["typeId"], pick: (v: ReturnType<typeof listVoicings>) => ReturnType<typeof listVoicings>[number], extra: Partial<ChordDiagramProps> = {}) {
  const voicing = pick(listVoicings(rootPc, typeId));
  return renderToStaticMarkup(<ChordDiagram {...base} voicing={voicing} rootPc={rootPc} typeId={typeId} {...extra} />);
}

describe("ChordDiagram", () => {
  it("labels C major open", () => {
    const html = diagram(0, "maj", (vs) => vs.find((v) => v.frets.join() === ",3,2,0,1,0")!);
    expect(html).toContain('aria-label="C major, x32010"');
    expect(count(html, 'data-kind="muted"')).toBe(1);
    expect(count(html, 'data-kind="open"') + count(html, 'data-kind="open-root"')).toBe(2);
    expect(count(html, 'data-kind="nut"')).toBe(1);
    expect(html).not.toContain("fr<");
    // Roots: C on string 5 fret 3 and string 2 fret 1; open root ring on high e? (E is not root)
    expect(count(html, 'data-kind="root"')).toBe(2);
    expect(html).not.toContain('data-kind="barre"');
  });

  it("draws a barre and a position label", () => {
    const f = diagram(5, "maj", (vs) => vs.find((v) => v.barre && v.baseFret === 1)!);
    expect(f).toContain('data-kind="barre"');
    expect(f).toContain('rx="');
    const high = diagram(0, "maj", (vs) => vs.find((v) => v.baseFret > 1)!);
    expect(high).toMatch(/>\d+fr</);
    expect(high).not.toContain('data-kind="nut"');
  });

  it("shows the 5fr label for G# / Bb style shapes at fret 5", () => {
    const html = diagram(5, "maj", (vs) => vs.find((v) => v.baseFret === 5)!);
    expect(html).toContain(">5fr<");
  });

  it("mirrors string order for left-handed players", () => {
    const x = (html: string, i: number) => Number(new RegExp(`data-kind="muted"[^>]*data-string="${i}"`).test(html) ? 0 : 0) + Number(html.match(new RegExp(`data-kind="open[^"]*" data-string="${i}"[^>]*cx="([\\d.]+)"`))![1]);
    const pick = (vs: ReturnType<typeof listVoicings>) => vs.find((v) => v.frets.join() === "0,2,2,1,0,0")!;
    const right = diagram(4, "maj", pick);
    const left = diagram(4, "maj", pick, { leftHanded: true });
    expect(x(right, 0)).toBeLessThan(x(right, 5));
    expect(x(left, 0)).toBeGreaterThan(x(left, 5));
  });

  it("horizontal puts high e on top and the nut on the right when left-handed", () => {
    const pick = (vs: ReturnType<typeof listVoicings>) => vs.find((v) => v.frets.join() === "0,2,2,1,0,0")!;
    const cy = (html: string, i: number) => Number(html.match(new RegExp(`data-kind="open[^"]*" data-string="${i}"[^>]*cy="([\\d.]+)"`))![1]);
    const cx = (html: string, i: number) => Number(html.match(new RegExp(`data-kind="open[^"]*" data-string="${i}"[^>]*cx="([\\d.]+)"`))![1]);
    const h = diagram(4, "maj", pick, { orientation: "horizontal" });
    expect(cy(h, 5)).toBeLessThan(cy(h, 0));
    const hl = diagram(4, "maj", pick, { orientation: "horizontal", leftHanded: true });
    expect(cx(h, 5)).toBeLessThan(cx(hl, 5));
  });

  it("shows interval labels and note names on request", () => {
    const pick = (vs: ReturnType<typeof listVoicings>) => vs.find((v) => v.frets.join() === ",3,2,0,1,0")!;
    const html = diagram(0, "maj", pick, { labels: "intervals", showNoteNames: true });
    expect(html).toContain(">R<");
    expect(html).toContain(">3<");
    expect(count(html, 'data-kind="note"')).toBe(5);
  });

  it("draws slash chords", () => {
    const s = SLASH_CHORDS.find((c) => c.name === "D/F#")!;
    const html = renderToStaticMarkup(
      <ChordDiagram {...base} voicing={s.voicing} rootPc={s.rootPc} typeId={s.typeId} bassPc={s.bassPc} title={s.name} />,
    );
    expect(html).toContain('aria-label="D/F#, 200232"');
  });
});

describe("FullNeck", () => {
  it("marks every C major tone on 15 frets, roots accented, selected outlined", () => {
    const v = listVoicings(0, "maj").find((c) => c.frets.join() === ",3,2,0,1,0")!;
    const html = renderToStaticMarkup(<FullNeck rootPc={0} typeId="maj" voicing={v} showNoteNames={false} leftHanded={false} />);
    // C E G over 16 columns x 6 strings: count positions.
    expect(count(html, 'data-kind="outline"')).toBe(5);
    expect(count(html, 'data-kind="root"')).toBeGreaterThan(5);
    expect(html).toContain(">R<");
    const names = renderToStaticMarkup(<FullNeck rootPc={0} typeId="maj" showNoteNames leftHanded />);
    expect(names).toContain(">C<");
    expect(names).toContain(">E<");
    expect(count(names, 'data-kind="outline"')).toBe(0);
  });
});
