// Example songs shipped with the app (public domain melodies). Plain song
// text files bundled at build time; shown read-only in the Library, where
// "Add to my library" saves an editable copy.

const files = import.meta.glob("./*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface SampleSong {
  id: string; // file name without extension, e.g. "happy-birthday"
  title: string;
  text: string;
}

export const SAMPLE_SONGS: SampleSong[] = Object.entries(files)
  .map(([path, text]) => {
    const id = path.replace(/^\.\//, "").replace(/\.txt$/, "");
    const title = /^title:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? id;
    return { id, title, text };
  })
  .sort((a, b) => a.title.localeCompare(b.title));
