// "Library" rail destination (spec 2): Open library and Requests tabs.

import { useState } from "react";
import type { Settings } from "../../model";
import type { StorageAdapter } from "../storageTypes";
import { SegmentedControl } from "../components/kit";
import { OpenLibrary } from "./OpenLibrary";
import { RequestsTab } from "./RequestsTab";
import st from "./sharing.module.css";

export type SharedTab = "open" | "requests";

export function SharedScreen({
  storage,
  settings,
  refreshToken,
  onChanged,
  onOpenSong,
  initialTab = "open",
  focusRequestId,
  askPrefill,
}: {
  storage: StorageAdapter;
  settings: Settings;
  refreshToken: number;
  onChanged: () => void;
  onOpenSong: (id: string) => void;
  initialTab?: SharedTab;
  focusRequestId?: string;
  askPrefill?: string;
}) {
  const [tab, setTab] = useState<SharedTab>(initialTab);
  const [ask, setAsk] = useState<string | undefined>(askPrefill);
  return (
    <div className={`screen ${st.page}`}>
      <header className={st.head}>
        <h1 className={st.title}>Library</h1>
        <SegmentedControl
          label="Library section"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setAsk(undefined);
          }}
          options={[
            { value: "open", label: "Open library" },
            { value: "requests", label: "Requests" },
          ]}
        />
      </header>
      {tab === "open" ? (
        <OpenLibrary
          storage={storage}
          settings={settings}
          refreshToken={refreshToken}
          onChanged={onChanged}
          onOpenSong={onOpenSong}
          onAsk={(prefill) => {
            setAsk(prefill);
            setTab("requests");
          }}
        />
      ) : (
        <RequestsTab
          key={ask ?? "none"}
          storage={storage}
          settings={settings}
          refreshToken={refreshToken}
          onChanged={onChanged}
          onOpenSong={onOpenSong}
          focusRequestId={focusRequestId}
          askPrefill={ask}
          onAskDone={() => setAsk(undefined)}
        />
      )}
    </div>
  );
}
