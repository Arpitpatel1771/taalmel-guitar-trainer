// Landing page for /s#<song>: preview a directly shared song and add it.

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Settings } from "../../model";
import { decodeShareFragment, type ShareFragmentResult } from "./deps";
import { Button } from "../components/kit";
import { SongPreview } from "./SongPreview";
import st from "./sharing.module.css";

const REASONS = {
  empty: "This link has no song in it.",
  malformed: "This link is damaged or cut off, so the song could not be read. Ask for it again, or for the song as text.",
  "invalid-song": "The song in this link is not valid.",
} as const;

export function ShareLinkScreen({
  fragment,
  settings,
  onAdd,
  onLeave,
}: {
  fragment: string;
  settings: Settings;
  onAdd: (text: string) => Promise<void>;
  onLeave: () => void;
}) {
  const [result, setResult] = useState<ShareFragmentResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false;
    void decodeShareFragment(fragment).then((r) => !off && setResult(r));
    return () => {
      off = true;
    };
  }, [fragment]);
  const song = useMemo(() => (result?.ok ? result.song : null), [result]);

  return (
    <div className={`screen ${st.page}`}>
      <header className={st.head}>
        <h1 className={st.title}>{song ? song.header.title : "Shared song"}</h1>
        <p className={st.muted}>Someone sent you this song. It was never uploaded anywhere: it lives in the link.</p>
      </header>
      {!result && <p className={st.muted}>Opening…</p>}
      {result && !result.ok && (
        <div className="notice notice-error">
          {REASONS[result.reason]}
          <Button onClick={onLeave}>Go to Taalmel</Button>
        </div>
      )}
      {result?.ok && song && (
        <SongPreview
          song={song}
          settings={settings}
          actions={
            <>
              <Button
                variant="primary"
                icon={<Plus size={15} />}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void onAdd(result.text).finally(() => setBusy(false));
                }}
              >
                Add to my songs
              </Button>
              <Button variant="ghost" onClick={onLeave}>
                Not now
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
