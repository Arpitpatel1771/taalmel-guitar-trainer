// Layout constants (spec 8.1, 8.2). Exported per the module contract so
// render/ui can reuse them (e.g. drawing string labels in the reserved
// left padding, or sizing the envelope canvas).

import type { LaneId } from "../model";

export const MIN_ZOOM = 120;
export const MAX_ZOOM = 800;
export const DEFAULT_ZOOM = 240;

export const STRING_COUNT = 6;

/** Vertical gap between adjacent string lines in the tab lane. */
export const TAB_STRING_GAP = 14;
/** Padding below the bottom string line. */
export const TAB_LANE_PADDING = 10;
/** Band above the top string line holding bar numbers, section names, strum
 * arrows and technique labels. */
export const TAB_LANE_TOP = 30;
export const TAB_LANE_HEIGHT = TAB_LANE_TOP + TAB_STRING_GAP * (STRING_COUNT - 1) + TAB_LANE_PADDING;

/** Line height of one letter; a chord slot stacks up to six letters. */
export const LETTER_LINE_HEIGHT = 11;
export const LETTER_LANE_HEIGHT = 4 + LETTER_LINE_HEIGHT * STRING_COUNT;
export const TEACHER_LANE_HEIGHT = 40;

/** Left padding reserved for string/lane labels; included in every row's x0. */
export const ROW_LEFT_PADDING = 32;

/** Vertical gap between consecutive rows. */
export const ROW_GAP = 12;

export const LANE_ORDER: LaneId[] = ["tab", "letter", "teacher"];

export const LANE_HEIGHTS: Record<LaneId, number> = {
  tab: TAB_LANE_HEIGHT,
  letter: LETTER_LANE_HEIGHT,
  teacher: TEACHER_LANE_HEIGHT,
};
