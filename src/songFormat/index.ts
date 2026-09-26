// Public API of the songFormat module (spec sections 5, 11.1-11.3).

export { parse } from "./parse.js";
export { serialize } from "./serialize.js";
export { extractSong } from "./extract.js";
export type { ExtractResult } from "./extract.js";
export { buildImportPrompt, buildRepairPrompt } from "./prompts.js";
export type { ImportForm } from "./prompts.js";
export { parseYouTubeId, withYoutubeOffset } from "./youtube.js";
export {
  ERROR_CODES,
  SYNTAX_ERROR_CODES,
  STRUCTURE_ERROR_CODES,
  SEMANTIC_ERROR_CODES,
  WARNING_CODES,
} from "./errorCodes.js";
export type { ErrorCode } from "./errorCodes.js";
