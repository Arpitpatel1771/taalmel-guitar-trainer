// The piano roll: one canvas for ruler, keyboard column, grid and notes, inside a scroll box. All
// mouse handling lives here; edits go out as operations through the callbacks.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createVideoSongMapper, type TickSecMap, type VideoHints } from "../../audio/hints";
import {
  SNAP_TICKS,
  barLengthTicks,
  capoAtTick,
  deleteNotes,
  noteById,
  noteMidi,
  noteName,
  positionText,
  snapTick,
  type EdDoc,
  type OpResult,
  type SnapId,
} from "../../songEditor";
import type { StringNumber } from "../../model";
import { soundingMidi } from "../../notation";
import { FLAG_HIT_W, FLAG_Y0, FLAG_Y1, STRING_LETTERS, drawRoll, readRollTheme, type RollTheme } from "./rollDraw";
import {
  DRAG_THRESHOLD,
  KEY_W,
  LANE_H,
  RULER_H,
  applyDrag,
  drawSpan,
  gridHeight,
  gridWidth,
  hitTest,
  makeGeom,
  midiAtY,
  rowTop,
  laneTop,
  notesInBox,
  stringAtY,
  tickToX,
  xToTick,
  type Rect,
  type RollView,
} from "./rollGeometry";
import styles from "./songEditor.module.css";

export type RollTool = "select" | "draw";

export interface RollApi {
  scrollToTick(tick: number): void;
  scrollToMidi(midi: number): void;
}

export interface RollCanvasProps {
  doc: EdDoc;
  view: RollView;
  zoom: number;
  rowH: number;
  snap: SnapId;
  tool: RollTool;
  selected: readonly number[];
  conflicts: readonly number[];
  playing: boolean;
  follow: boolean;
  getPlayhead: () => number;
  loop: { startTick: number; endTick: number } | null;
  hints: VideoHints | null;
  hintBrightness: number;
  /** Bumps whenever hint frames changed, to redraw while paused. */
  hintsVersion: number;
  tempo: TickSecMap;
  /** Video time of bar 1; absent = no video. */
  videoOffsetSec: number | undefined;
  initialScroll: { x: number; y: number };
  /** Length the Draw tool gives a new note on a plain click. */
  drawLength: number;
  onSelect: (ids: number[]) => void;
  onEdit: (res: OpResult, preview?: boolean) => void;
  onAddNote: (startTick: number, midi: number, durationTicks: number, string?: StringNumber) => void;
  onSeek: (tick: number) => void;
  onLoop: (range: { startTick: number; endTick: number } | null) => void;
  onFlag: (offsetSec: number) => void;
  onScroll: (x: number, y: number) => void;
  /** Ctrl + wheel changes the time zoom; Shift + Ctrl + wheel changes the row height. */
  onZoomWheel: (dir: 1 | -1, axis: "x" | "y") => void;
  onPreviewPitch: (midi: number) => void;
  apiRef: MutableRefObject<RollApi | null>;
}

interface PtrPos {
  clientX: number;
  clientY: number;
  altKey: boolean;
  shiftKey: boolean;
}

const EDGE_PX = 28;
const EDGE_SPEED = 18;

type Drag =
  | { kind: "move" | "resize"; startDoc: EdDoc; ids: number[]; anchorId: number; x0: number; y0: number; sx0: number; sy0: number; started: boolean; result: OpResult | null }
  | { kind: "box"; x0: number; y0: number; base: number[] }
  | { kind: "draw"; x0: number; y0: number; midi: number; string: StringNumber; started: boolean }
  | { kind: "ruler"; x0: number; tick0: number; started: boolean }
  | { kind: "flag"; x0: number; offset0: number; started: boolean };

interface Tip {
  x: number;
  y: number;
  text: string;
}

export function RollCanvas(props: RollCanvasProps) {
  const { doc, view, zoom, rowH, snap } = props;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });
  const [tip, setTip] = useState<Tip | null>(null);
  const P = useRef(props);
  P.current = props;
  const theme = useRef<RollTheme | null>(null);
  const scrollPos = useRef({ x: props.initialScroll.x, y: props.initialScroll.y });
  const dragRef = useRef<Drag | null>(null);
  const previewDoc = useRef<EdDoc | null>(null);
  const previewLoop = useRef<{ startTick: number; endTick: number } | null>(null);
  const previewOffset = useRef<number | null>(null);
  const boxRef = useRef<Rect | null>(null);
  const ghostRef = useRef<Rect | null>(null);
  const hoverRef = useRef<number | null>(null);
  const lastClick = useRef<{ t: number; x: number; y: number } | null>(null);
  const raf = useRef(0);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const g = useMemo(() => makeGeom(zoom, rowH, view), [zoom, rowH, view]);
  const conflictSet = useMemo(() => new Set(props.conflicts), [props.conflicts]);
  const selectedSet = useMemo(() => new Set(props.selected), [props.selected]);
  const snapTicks = SNAP_TICKS[snap];

  const render = useCallback(() => {
    raf.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const p = P.current;
    if (!theme.current) theme.current = readRollTheme();
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const geom = makeGeom(p.zoom, p.rowH, p.view);
    const offset = previewOffset.current ?? p.videoOffsetSec;
    drawRoll(ctx, {
      doc: previewDoc.current ?? p.doc,
      g: geom,
      theme: theme.current,
      width: w,
      height: h,
      scrollX: scrollPos.current.x,
      scrollY: scrollPos.current.y,
      selected: new Set(p.selected),
      conflicts: new Set(p.conflicts),
      playheadTick: p.getPlayhead(),
      loop: previewLoop.current ?? p.loop,
      hintsLayer: p.hints && offset !== undefined ? { hints: p.hints, mapper: createVideoSongMapper(p.tempo, offset), brightness: p.hintBrightness } : null,
      flagSec: offset,
      snapTicks: SNAP_TICKS[p.snap],
      box: boxRef.current,
      ghost: ghostRef.current,
      hoverId: hoverRef.current,
    });
  }, []);

  const requestDraw = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(render);
  }, [render]);

  // Redraw whenever anything the picture depends on changes.
  useEffect(() => {
    requestDraw();
  }, [doc, g, selectedSet, conflictSet, props.loop, props.hints, props.hintBrightness, props.hintsVersion, props.videoOffsetSec, props.tempo, snap, size, requestDraw]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0; // StrictMode re-mounts: a stale id would stop every later draw
    },
    [],
  );

  // Theme changes (light/dark, accent) re-read the tokens.
  useEffect(() => {
    const refresh = (): void => {
      theme.current = readRollTheme();
      requestDraw();
    };
    const mo = new MutationObserver(refresh);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", refresh);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", refresh);
    };
  }, [requestDraw]);

  // Size of the visible box.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = (): void => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(150, el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initial scroll position.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = props.initialScroll.x;
    el.scrollTop = props.initialScroll.y;
    scrollPos.current = { x: el.scrollLeft, y: el.scrollTop };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the middle of the view in place when zooming or switching views.
  const prevGeom = useRef(g);
  const pitchScroll = useRef(props.initialScroll.y);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const prev = prevGeom.current;
    prevGeom.current = g;
    if (!el || prev === g) return;
    if (prev.pxPerTick !== g.pxPerTick) {
      const gridW = el.clientWidth - KEY_W;
      const centre = (el.scrollLeft + gridW / 2) / prev.pxPerTick;
      el.scrollLeft = Math.max(0, centre * g.pxPerTick - gridW / 2);
    }
    if (prev.view !== g.view) {
      el.scrollTop = g.view === "pitch" ? pitchScroll.current : 0;
    } else if (prev.rowH !== g.rowH) {
      el.scrollTop = (el.scrollTop / prev.rowH) * g.rowH;
    }
    scrollPos.current = { x: el.scrollLeft, y: el.scrollTop };
    requestDraw();
  }, [g, requestDraw]);

  // Playhead animation and follow.
  useEffect(() => {
    if (!props.playing) return;
    let id = 0;
    const loop = (): void => {
      const el = scrollerRef.current;
      const p = P.current;
      if (el && p.follow) {
        const gridW = el.clientWidth - KEY_W;
        const x = tickToX(makeGeom(p.zoom, p.rowH, p.view), p.getPlayhead());
        if (x < el.scrollLeft || x > el.scrollLeft + gridW * 0.88) el.scrollLeft = Math.max(0, x - gridW * 0.12);
      }
      render();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [props.playing, render]);

  // Redraw once when playback stops so the playhead lands where it paused.
  useEffect(() => {
    if (!props.playing) requestDraw();
  }, [props.playing, requestDraw]);

  // Ctrl/Cmd + wheel zooms time (with Shift: row height); the plain wheel scrolls natively.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dy = e.shiftKey && e.deltaY === 0 ? e.deltaX : e.deltaY;
      P.current.onZoomWheel(dy < 0 ? 1 : -1, e.shiftKey ? "y" : "x");
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    props.apiRef.current = {
      scrollToTick(tick) {
        const el = scrollerRef.current;
        if (!el) return;
        const x = tickToX(makeGeom(P.current.zoom, P.current.rowH, P.current.view), tick);
        if (x < el.scrollLeft + 10 || x > el.scrollLeft + el.clientWidth - KEY_W - 40) el.scrollLeft = Math.max(0, x - (el.clientWidth - KEY_W) / 3);
      },
      scrollToMidi(midi) {
        const el = scrollerRef.current;
        if (!el || P.current.view !== "pitch") return;
        const y = (88 - midi) * P.current.rowH;
        if (y < el.scrollTop + 10 || y > el.scrollTop + el.clientHeight - RULER_H - 30) el.scrollTop = Math.max(0, y - (el.clientHeight - RULER_H) / 2);
      },
    };
    return () => {
      props.apiRef.current = null;
    };
  }, [props.apiRef]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    scrollPos.current = { x: el.scrollLeft, y: el.scrollTop };
    if (P.current.view === "pitch") pitchScroll.current = el.scrollTop;
    P.current.onScroll(el.scrollLeft, el.scrollTop);
    requestDraw();
  }, [requestDraw]);

  // ---- pointer handling
  const local = (e: { clientX: number; clientY: number }): { cx: number; cy: number } => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top };
  };
  const gridPoint = (cx: number, cy: number): { x: number; y: number } => ({ x: cx - KEY_W + scrollPos.current.x, y: cy - RULER_H + scrollPos.current.y });
  const beatSnap = (tick: number): number => snapTick(tick, SNAP_TICKS["1/4"], barLengthTicks(P.current.doc));

  const describe = (d: EdDoc, id: number): string => {
    const n = noteById(d, id);
    if (!n) return "";
    const text = `${noteName(noteMidi(d, n), !!n.meta.flat)}, ${STRING_LETTERS[n.string - 1]} string, fret ${n.fret}. ${positionText(d, n.startTick)}`;
    return text + (conflictSet.has(id) ? ". No free string for this note." : "");
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    scrollerRef.current?.focus({ preventScroll: true });
    const p = P.current;
    const { cx, cy } = local(e);
    const d = p.doc;
    setTip(null);

    if (cx < KEY_W && cy >= RULER_H) {
      const { y } = gridPoint(cx, cy);
      if (p.view === "pitch") p.onPreviewPitch(midiAtY(g, y));
      else {
        const s = stringAtY(y);
        p.onPreviewPitch(soundingMidi(s, 0, capoAtTick(d, p.getPlayhead())));
      }
      return;
    }
    if (cx < KEY_W) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (cy < RULER_H) {
      const flagX = KEY_W - scrollPos.current.x;
      if (p.videoOffsetSec !== undefined && cx >= flagX - 5 && cx <= flagX + FLAG_HIT_W && cy >= FLAG_Y0 && cy <= FLAG_Y1) {
        dragRef.current = { kind: "flag", x0: e.clientX, offset0: p.videoOffsetSec, started: false };
        return;
      }
      const { x } = gridPoint(cx, cy);
      const tick = Math.max(0, xToTick(g, x));
      const prevClick = lastClick.current;
      lastClick.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (prevClick && e.timeStamp - prevClick.t < 400 && Math.hypot(prevClick.x - e.clientX, prevClick.y - e.clientY) < 5) {
        lastClick.current = null;
        const len = barLengthTicks(d);
        const bar = Math.floor(tick / len);
        p.onLoop({ startTick: bar * len, endTick: (bar + 1) * len });
        dragRef.current = null;
        return;
      }
      dragRef.current = { kind: "ruler", x0: e.clientX, tick0: Math.max(0, beatSnap(tick)), started: false };
      return;
    }

    const { x, y } = gridPoint(cx, cy);
    const hit = hitTest(g, d, x, y);
    const sel = new Set(p.selected);
    if (hit) {
      const n = noteById(d, hit.id)!;
      if (e.shiftKey && sel.has(hit.id) && hit.zone === "body") {
        sel.delete(hit.id);
        p.onSelect([...sel]);
        return;
      }
      if (e.shiftKey) sel.add(hit.id);
      else if (!sel.has(hit.id) || hit.zone === "resize") {
        sel.clear();
        sel.add(hit.id);
      }
      const ids = [...sel];
      if (ids.join() !== p.selected.join()) p.onSelect(ids);
      if (hit.zone === "body") p.onPreviewPitch(noteMidi(d, n));
      dragRef.current = { kind: hit.zone === "resize" ? "resize" : "move", startDoc: d, ids, anchorId: hit.id, x0: e.clientX, y0: e.clientY, sx0: scrollPos.current.x, sy0: scrollPos.current.y, started: false, result: null };
      return;
    }
    if (p.tool === "draw") {
      dragRef.current = { kind: "draw", x0: x, y0: y, midi: midiAtY(g, y), string: stringAtY(y), started: false };
      const span = drawSpan(g, d, x, x, snapTicks, p.drawLength, false);
      ghostRef.current = ghostRect(span.startTick, span.durationTicks, midiAtY(g, y), stringAtY(y));
      requestDraw();
      return;
    }
    dragRef.current = { kind: "box", x0: x, y0: y, base: e.shiftKey ? [...p.selected] : [] };
  };

  // FL-style shortcuts in either tool: double-click empty space adds a note, right-click a note deletes it.
  const notePointAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = local(e);
    if (cx < KEY_W || cy < RULER_H) return null;
    const { x, y } = gridPoint(cx, cy);
    return { x, y, hit: hitTest(g, P.current.doc, x, y) };
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const p = P.current;
    const at = notePointAt(e);
    if (!at || at.hit || p.tool !== "select") return;
    dragRef.current = null;
    const span = drawSpan(g, p.doc, at.x, at.x, snapTicks, p.drawLength, false);
    const string = stringAtY(at.y);
    p.onAddNote(span.startTick, g.view === "pitch" ? midiAtY(g, at.y) : soundingMidi(string, 0, capoAtTick(p.doc, span.startTick)), span.durationTicks, g.view === "strings" ? string : undefined);
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const p = P.current;
    const at = notePointAt(e);
    if (!at?.hit) return;
    e.preventDefault();
    const id = at.hit.id;
    p.onEdit(deleteNotes(p.doc, [id]));
    if (p.selected.includes(id)) p.onSelect(p.selected.filter((s) => s !== id));
  };

  const ghostRect = (startTick: number, durationTicks: number, midi: number, string: StringNumber): Rect => {
    const x = tickToX(g, startTick) + 1;
    const w = Math.max(6, durationTicks * g.pxPerTick - 2);
    return g.view === "pitch" ? { x, y: rowTop(g, midi) + 1, w, h: g.rowH - 2 } : { x, y: laneTop(string) + 7, w, h: LANE_H - 14 };
  };

  // While dragging a note or box near the edge of the roll, keep scrolling that way.
  const lastPtr = useRef<PtrPos | null>(null);
  const moveRef = useRef<(e: PtrPos) => void>(() => undefined);
  const edgeRaf = useRef(0);
  const edgeScroll = useCallback((): void => {
    edgeRaf.current = 0;
    const drag = dragRef.current;
    const el = scrollerRef.current;
    const ptr = lastPtr.current;
    if (!drag || !el || !ptr || drag.kind === "ruler" || drag.kind === "flag") return;
    const r = el.getBoundingClientRect();
    const speed = (inside: number): number => Math.ceil(Math.min(1, Math.max(0, inside) / EDGE_PX) * EDGE_SPEED);
    const left = r.left + KEY_W;
    const top = r.top + RULER_H;
    const vx = ptr.clientX < left + EDGE_PX ? -speed(left + EDGE_PX - ptr.clientX) : ptr.clientX > r.right - EDGE_PX ? speed(ptr.clientX - (r.right - EDGE_PX)) : 0;
    const vy = ptr.clientY < top + EDGE_PX ? -speed(top + EDGE_PX - ptr.clientY) : ptr.clientY > r.bottom - EDGE_PX ? speed(ptr.clientY - (r.bottom - EDGE_PX)) : 0;
    if (vx || vy) {
      const before = { x: el.scrollLeft, y: el.scrollTop };
      el.scrollLeft += vx;
      el.scrollTop += vy;
      if (el.scrollLeft !== before.x || el.scrollTop !== before.y) {
        scrollPos.current = { x: el.scrollLeft, y: el.scrollTop };
        moveRef.current(ptr);
      }
    }
    edgeRaf.current = requestAnimationFrame(edgeScroll);
  }, []);
  useEffect(
    () => () => {
      cancelAnimationFrame(edgeRaf.current);
      edgeRaf.current = 0;
    },
    [],
  );

  const onPointerMove = (e: PtrPos): void => {
    const p = P.current;
    const drag = dragRef.current;
    const { cx, cy } = local(e);
    if (drag) {
      lastPtr.current = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey, shiftKey: e.shiftKey };
      if (!edgeRaf.current) edgeRaf.current = requestAnimationFrame(edgeScroll);
    }
    if (!drag) {
      const canvas = canvasRef.current!;
      let cursor = "default";
      let hover: number | null = null;
      if (cx >= KEY_W && cy >= RULER_H) {
        const { x, y } = gridPoint(cx, cy);
        const hit = hitTest(g, p.doc, x, y);
        if (hit) {
          hover = hit.id;
          cursor = hit.zone === "resize" ? "ew-resize" : "grab";
        } else if (p.tool === "draw") cursor = "crosshair";
      } else if (cx >= KEY_W) {
        const flagX = KEY_W - scrollPos.current.x;
        cursor = p.videoOffsetSec !== undefined && cx >= flagX - 5 && cx <= flagX + FLAG_HIT_W && cy >= FLAG_Y0 && cy <= FLAG_Y1 ? "ew-resize" : "pointer";
      } else if (cy >= RULER_H) cursor = "pointer";
      canvas.style.cursor = cursor;
      if (hover !== hoverRef.current) {
        hoverRef.current = hover;
        requestDraw();
      }
      setTip(hover !== null ? { x: cx + 14, y: cy + 16, text: describe(p.doc, hover) } : null);
      return;
    }

    if (drag.kind === "move" || drag.kind === "resize") {
      const dx = e.clientX - drag.x0 + (scrollPos.current.x - drag.sx0);
      const dy = e.clientY - drag.y0 + (scrollPos.current.y - drag.sy0);
      if (!drag.started && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.started = true;
      canvasRef.current!.style.cursor = drag.kind === "resize" ? "ew-resize" : "grabbing";
      const res = applyDrag(drag.startDoc, g, { mode: drag.kind, ids: drag.ids, anchorId: drag.anchorId, dxPx: dx, dyPx: dy, snapTicks, free: e.altKey });
      drag.result = res;
      previewDoc.current = res.refused ? drag.startDoc : res.doc;
      requestDraw();
    } else if (drag.kind === "box") {
      const { x, y } = gridPoint(cx, cy);
      const box = { x: Math.min(drag.x0, x), y: Math.min(drag.y0, y), w: Math.abs(x - drag.x0), h: Math.abs(y - drag.y0) };
      boxRef.current = box;
      const ids = new Set([...drag.base, ...notesInBox(g, p.doc, box)]);
      p.onSelect([...ids]);
      requestDraw();
    } else if (drag.kind === "draw") {
      const { x } = gridPoint(cx, cy);
      if (!drag.started && Math.abs(x - drag.x0) < DRAG_THRESHOLD) return;
      drag.started = true;
      const span = drawSpan(g, p.doc, drag.x0, x, snapTicks, p.drawLength, true);
      ghostRef.current = ghostRect(span.startTick, span.durationTicks, drag.midi, drag.string);
      requestDraw();
    } else if (drag.kind === "ruler") {
      if (!drag.started && Math.abs(e.clientX - drag.x0) < DRAG_THRESHOLD) return;
      drag.started = true;
      const { x } = gridPoint(cx, cy);
      const t1 = Math.max(0, beatSnap(xToTick(g, x)));
      const a = Math.min(drag.tick0, t1);
      const b = Math.max(drag.tick0, t1);
      previewLoop.current = b > a ? { startTick: a, endTick: b } : null;
      requestDraw();
    } else if (drag.kind === "flag") {
      if (!drag.started && Math.abs(e.clientX - drag.x0) < DRAG_THRESHOLD) return;
      drag.started = true;
      const ticks = (e.clientX - drag.x0) / g.pxPerTick;
      // The flag marks a moment in the video: dragging it right onto a later downbeat makes bar 1 later in the video.
      previewOffset.current = Math.max(0, Math.round((drag.offset0 + p.tempo.ticksToSec(Math.abs(ticks)) * Math.sign(ticks)) * 1000) / 1000);
      requestDraw();
    }
  };

  moveRef.current = onPointerMove;

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const p = P.current;
    const drag = dragRef.current;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!drag) return;
    const { cx, cy } = local(e);
    const pdoc = previewDoc.current;
    previewDoc.current = null;
    const box = boxRef.current;
    boxRef.current = null;
    ghostRef.current = null;
    const pl = previewLoop.current;
    previewLoop.current = null;
    const po = previewOffset.current;
    previewOffset.current = null;
    if (drag.kind === "move" || drag.kind === "resize") {
      if (drag.started && drag.result) p.onEdit(drag.result, drag.kind === "move");
      else if (pdoc) requestDraw();
    } else if (drag.kind === "box") {
      if (!box || (box.w < DRAG_THRESHOLD && box.h < DRAG_THRESHOLD)) {
        if (!e.shiftKey) p.onSelect([]);
      }
    } else if (drag.kind === "draw") {
      const { x } = gridPoint(cx, cy);
      const span = drawSpan(g, p.doc, drag.x0, x, snapTicks, p.drawLength, drag.started);
      p.onAddNote(span.startTick, g.view === "pitch" ? drag.midi : soundingMidi(drag.string, 0, capoAtTick(p.doc, span.startTick)), span.durationTicks, g.view === "strings" ? drag.string : undefined);
    } else if (drag.kind === "ruler") {
      if (drag.started) {
        if (pl) p.onLoop(pl);
      } else p.onSeek(drag.tick0);
    } else if (drag.kind === "flag") {
      if (po !== null) p.onFlag(po);
    }
    requestDraw();
  };

  const onPointerLeave = (): void => {
    if (dragRef.current) return;
    hoverRef.current = null;
    setTip(null);
    requestDraw();
  };

  const totalW = KEY_W + gridWidth(doc, g);
  const totalH = RULER_H + gridHeight(g);

  return (
    <div
      ref={scrollerRef}
      className={styles.rollScroller}
      tabIndex={0}
      role="group"
      aria-label="Notes. Double-click empty space to add a note, right-click a note to delete it. Arrow keys move the selected notes, Delete removes them, Space plays and pauses."
      onScroll={onScroll}
    >
      <div className={styles.rollSizer} style={{ width: totalW, height: totalH }}>
        <div className={styles.rollStick} style={{ width: size.w, height: size.h }}>
          <canvas
            ref={canvasRef}
            className={styles.rollCanvas}
            style={{ width: size.w, height: size.h }}
            aria-hidden="true"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
          />
          {tip && (
            <div className={styles.rollTip} style={{ left: Math.min(tip.x, size.w - 260), top: tip.y }} role="presentation">
              {tip.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
