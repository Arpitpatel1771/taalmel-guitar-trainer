// Direct share (spec 4): Copy link (song in the URL fragment) and Copy as text.

import { useEffect, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { encodeShareLink, isShareLinkTooLong } from "./deps";
import { Button } from "../components/kit";
import { useShell } from "../shell/AppShellContext";
import { copyToClipboard } from "../utils";
import { Dialog } from "./Dialog";
import st from "./sharing.module.css";

export function ShareDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const { toast } = useShell();
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    void encodeShareLink(text, window.location.origin).then((l) => !off && setLink(l), () => !off && setLink(""));
    return () => {
      off = true;
    };
  }, [text]);

  async function copy(label: string, value: string) {
    const ok = await copyToClipboard(value);
    toast(ok ? `${label} copied.` : `Could not copy the ${label.toLowerCase()}: copy it manually.`, ok ? "success" : "error");
    if (ok) onClose();
  }

  const tooLong = link !== null && (link === "" || isShareLinkTooLong(link));
  return (
    <Dialog title={`Share "${title}"`} onClose={onClose}>
      <p>Anyone with this link can open the song. Send it privately.</p>
      {tooLong && <p className={st.muted}>This song is too long for a link that chat apps keep intact. Copy it as text instead; the other person pastes it into Add a song.</p>}
      <div className={st.actions}>
        {!tooLong && (
          <Button variant="primary" icon={<Link2 size={15} />} disabled={link === null} onClick={() => link && void copy("Link", link)}>
            Copy link
          </Button>
        )}
        <Button variant={tooLong ? "primary" : "secondary"} icon={<Copy size={15} />} onClick={() => void copy("Text", text)}>
          Copy as text
        </Button>
      </div>
    </Dialog>
  );
}
