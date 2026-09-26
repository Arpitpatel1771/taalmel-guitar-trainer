import type { ParseError } from "../model/index.js";
import type { ErrorCode } from "./errorCodes.js";

export interface ErrorExtra {
  column?: number;
  bar?: number;
  slot?: number;
  token?: string;
}

/** Builds a ParseError (severity "error", the default per the model type). */
export function mkError(
  line: number,
  code: ErrorCode,
  message: string,
  extra: ErrorExtra = {},
): ParseError {
  return { line, code, message, ...extra };
}

/** Builds a ParseError with severity "warning". */
export function mkWarning(
  line: number,
  code: ErrorCode,
  message: string,
  extra: ErrorExtra = {},
): ParseError {
  return { line, code, message, severity: "warning", ...extra };
}
