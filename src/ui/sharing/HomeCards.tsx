// Home slot (specs/5-11-shared-library.md 3.5, 3.6): "Your request for X got a
// reply" and the once-a-day "You have songs for N requests" nudge.

import { Gift, Inbox, X } from "lucide-react";
import { Button, Card } from "../components/kit";
import { useSharing } from "./SharingContext";
import st from "./sharing.module.css";

export function HomeSharingCards({ onOpenReplies, onOpenRequests }: { onOpenReplies: (requestId: string) => void; onOpenRequests: () => void }) {
  const { unseenReplies, myRequests, nudge, dismissNudge } = useSharing();
  const ids = [...new Set(unseenReplies.map((r) => r.requestId))];
  const cards = ids.map((id) => ({ id, req: myRequests.find((r) => r.requestId === id) })).filter((c) => c.req);
  if (cards.length === 0 && !nudge) return null;
  return (
    <div className={st.homeCards}>
      {cards.map(({ id, req }) => (
        <Card key={id} className={st.homeCard}>
          <Gift size={20} className={st.homeIcon} />
          <p className={st.grow}>
            Your request for <strong>{req!.title}</strong> got a reply
          </p>
          <Button variant="primary" onClick={() => onOpenReplies(id)}>
            See it
          </Button>
        </Card>
      ))}
      {nudge && (
        <Card className={st.homeCard}>
          <Inbox size={20} className={st.homeIcon} />
          <p className={st.grow}>
            You have songs for <strong>{nudge.count}</strong> {nudge.count === 1 ? "request" : "requests"}
          </p>
          <Button
            onClick={() => {
              dismissNudge();
              onOpenRequests();
            }}
          >
            Have a look
          </Button>
          <Button variant="ghost" onClick={dismissNudge} aria-label="Dismiss">
            <X size={16} />
          </Button>
        </Card>
      )}
    </div>
  );
}
