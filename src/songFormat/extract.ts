// Extracts song text from an LLM reply (spec 11.1 step 5).

export type ExtractResult = { ok: true; text: string } | { ok: false; message: string };

export function extractSong(reply: string): ExtractResult {
  // 1. A fenced block explicitly tagged `song`.
  const taggedMatch = /```song[^\n]*\n([\s\S]*?)```/.exec(reply);
  if (taggedMatch) {
    return { ok: true, text: taggedMatch[1]!.trim() };
  }

  // 2. Any fenced block containing a line starting with `title:`.
  const fenceRe = /```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(reply))) {
    const body = m[1]!;
    if (body.split(/\r?\n/).some((l) => l.trim().startsWith("title:"))) {
      return { ok: true, text: body.trim() };
    }
  }

  // 3. From the first `title:` line to the last `Bar ` line, anywhere in the reply.
  const lines = reply.split(/\r?\n/);
  const titleIdx = lines.findIndex((l) => l.trim().startsWith("title:"));
  if (titleIdx !== -1) {
    let lastBarIdx = -1;
    for (let i = titleIdx; i < lines.length; i++) {
      if (lines[i]!.trim().startsWith("Bar ")) lastBarIdx = i;
    }
    if (lastBarIdx !== -1) {
      return { ok: true, text: lines.slice(titleIdx, lastBarIdx + 1).join("\n") };
    }
  }

  return { ok: false, message: "No song found in the reply." };
}
