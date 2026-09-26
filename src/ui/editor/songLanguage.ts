// CodeMirror StreamLanguage for the song text format (spec 5). Highlighting
// only: validation stays in songFormat.parse, whose errors are pushed into the
// editor as lint diagnostics by SongEditor.

import { StreamLanguage, type StringStream } from "@codemirror/language";

interface State {
  inMeta: boolean;
  inLength: boolean;
}

export const songLanguage = StreamLanguage.define<State>({
  name: "taalmel-song",
  startState: () => ({ inMeta: false, inLength: false }),
  token(stream: StringStream, state: State): string | null {
    if (stream.sol()) {
      state.inMeta = false;
      state.inLength = false;
      if (stream.match(/^\s*#.*/)) return "comment";
      if (stream.match(/^\s*\[[^\]]*\]\s*$/)) return "heading";
      if (stream.match(/^\s*Bar\s+\d+\s*:/)) return "keyword";
      if (stream.match(/^\s*[a-z_]+(?=\s*:)/)) return "propertyName";
    }
    if (stream.eatSpace()) return null;

    if (state.inMeta) {
      if (stream.eat(")")) {
        state.inMeta = false;
        return "bracket";
      }
      if (stream.match(/^[a-z_]+/)) return "attributeName";
      if (stream.match(/^[^,:)\s]+/)) return "attributeValue";
      stream.next();
      return "punctuation";
    }
    if (state.inLength) {
      if (stream.eat("]")) {
        state.inLength = false;
        return "bracket";
      }
      if (stream.eat("?")) return "invalid";
      if (stream.match(/^>[+-]?\d+/)) return "operator";
      if (stream.match(/^\d+(X\d+\/\d+)?/)) return "number";
      stream.next();
      return null;
    }

    if (stream.match(/^\{\d+\}/)) return "labelName";
    if (stream.match(/^\(\d+\)/) ) return "typeName";
    if (stream.match(/^[1-6]S\d{1,2}/)) return "string";
    if (stream.eat("[")) {
      state.inLength = true;
      return "bracket";
    }
    if (stream.eat("(")) {
      state.inMeta = true;
      return "bracket";
    }
    stream.next();
    return null;
  },
});
