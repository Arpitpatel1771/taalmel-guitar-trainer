import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { songCompletions } from "./songCompletions";

function complete(doc: string, explicit = false) {
  const state = EditorState.create({ doc });
  return songCompletions(new CompletionContext(state, doc.length, explicit));
}

const labels = (r: ReturnType<typeof complete>) => (r ? r.options.map((o) => o.displayLabel ?? o.label) : []);

describe("songCompletions", () => {
  it("offers metadata flags after '(' on a note", () => {
    const r = complete("Bar 1: {1} 2S5(");
    expect(labels(r)).toContain("hammer");
    expect(labels(r)).toContain("flat");
  });

  it("offers flags after a comma and after a length block", () => {
    expect(labels(complete("Bar 1: {1} 2S5[2](muted, vi"))).toContain("vibrato");
  });

  it("offers strum and bend values", () => {
    expect(labels(complete("Bar 1: {1} 6S0(strum: "))).toEqual(["down", "up"]);
    expect(labels(complete("Bar 1: {1} 2S7(bend: "))).toContain("2");
  });

  it("offers header keys at line start", () => {
    expect(labels(complete("ti"))).toContain("title: ");
  });

  it("does not offer flags for the bar slot count '(12)'", () => {
    expect(complete("Bar 1: (")).toBeNull();
  });
});
