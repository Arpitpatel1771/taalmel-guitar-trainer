// The tool row (spec 2.3): Select/Draw, Snap, View, zoom, Duplicate bar, Live record.

import { CopyPlus, MousePointer2, Pencil, ChevronsDownUp, ChevronsUpDown, ZoomIn, ZoomOut } from "lucide-react";
import type { SnapId } from "../../songEditor";
import { SegmentedControl } from "../components/kit";
import type { RollTool } from "./RollCanvas";
import type { RollView } from "./rollGeometry";
import { IconButton, Toggle } from "./bits";
import s from "./songEditor.module.css";

const SNAPS: SnapId[] = ["1/4", "1/8", "1/16", "1/8T", "1/16T", "off"];

export function ToolRow({
  tool,
  onTool,
  snap,
  onSnap,
  view,
  onView,
  onZoom,
  onRowHeight,
  onDuplicate,
  liveRecord,
  onLiveRecord,
}: {
  tool: RollTool;
  onTool: (t: RollTool) => void;
  snap: SnapId;
  onSnap: (v: SnapId) => void;
  view: RollView;
  onView: (v: RollView) => void;
  onZoom: (dir: 1 | -1) => void;
  onRowHeight: (dir: 1 | -1) => void;
  onDuplicate: () => void;
  liveRecord: boolean;
  onLiveRecord: () => void;
}) {
  return (
    <section className={s.tools} aria-label="Editing tools">
      <SegmentedControl
        label="Tool"
        value={tool}
        onChange={onTool}
        options={[
          { value: "select", label: <><MousePointer2 size={14} aria-hidden /> Select</>, title: "Select (V)" },
          { value: "draw", label: <><Pencil size={14} aria-hidden /> Draw</>, title: "Draw (D)" },
        ]}
      />
      <span className={s.toolLabel}>Snap</span>
      <SegmentedControl label="Snap" value={snap} onChange={onSnap} options={SNAPS.map((v) => ({ value: v, label: v === "off" ? "Off" : v }))} />
      <span className={s.toolLabel}>View</span>
      <SegmentedControl
        label="View"
        value={view}
        onChange={onView}
        options={[
          { value: "pitch", label: "Pitch" },
          { value: "strings", label: "Strings" },
        ]}
      />
      <div className={s.row}>
        <IconButton label="Zoom out (time)" onClick={() => onZoom(-1)}>
          <ZoomOut size={16} aria-hidden />
        </IconButton>
        <IconButton label="Zoom in (time)" onClick={() => onZoom(1)}>
          <ZoomIn size={16} aria-hidden />
        </IconButton>
        {view === "pitch" && (
          <>
            <IconButton label="Shorter rows (Shift+Ctrl+wheel)" onClick={() => onRowHeight(-1)}>
              <ChevronsDownUp size={16} aria-hidden />
            </IconButton>
            <IconButton label="Taller rows (Shift+Ctrl+wheel)" onClick={() => onRowHeight(1)}>
              <ChevronsUpDown size={16} aria-hidden />
            </IconButton>
          </>
        )}
      </div>
      <button type="button" onClick={onDuplicate} title="Copy the selected bars (or the playhead's bar) into the next bars (Ctrl+D)">
        <CopyPlus size={15} aria-hidden /> Duplicate bar
      </button>
      <span className={s.spacer} />
      <Toggle on={liveRecord} danger onClick={onLiveRecord} title="While the song plays, press N each time you hear the next note">
        <span className={s.recDot} aria-hidden /> {liveRecord ? "Live record on" : "Live record"}
      </Toggle>
    </section>
  );
}
