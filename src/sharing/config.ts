// Sharing configuration, read from Vite env vars (specs/5-11-shared-library.md 3.1).
// Missing vars: isSharingConfigured() is false and the Requests tab says "Not set up".

export type FormKind = "requests" | "replies" | "report";

/** Logical field name -> Google Forms entry id ("entry.123456789"), per form. */
export type FormEntries = Record<FormKind, Record<string, string>>;

export interface SharingConfig {
  requestsForm: string;
  boardCsv: string;
  repliesForm: string;
  repliesCsv: string;
  reportForm: string;
  entries: FormEntries;
}

export interface SharingEnv {
  VITE_REQUESTS_FORM?: string;
  VITE_BOARD_CSV?: string;
  VITE_REPLIES_FORM?: string;
  VITE_REPLIES_CSV?: string;
  VITE_REPORT_FORM?: string;
  VITE_FORM_ENTRIES?: string;
}

/** Parses VITE_FORM_ENTRIES: JSON `{"requests":{"action":"entry.1",...},"replies":{...},"report":{...}}`.
 * Anything malformed yields empty maps. */
export function parseFormEntries(raw: string | undefined): FormEntries {
  const empty: FormEntries = { requests: {}, replies: {}, report: {} };
  if (!raw) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof data !== "object" || data === null) return empty;
  for (const kind of Object.keys(empty) as FormKind[]) {
    const map = (data as Record<string, unknown>)[kind];
    if (typeof map !== "object" || map === null) continue;
    for (const [name, id] of Object.entries(map as Record<string, unknown>)) {
      if (typeof id === "string" && id) empty[kind][name] = id;
    }
  }
  return empty;
}

export function getSharingConfig(env: SharingEnv = import.meta.env as SharingEnv): SharingConfig {
  return {
    requestsForm: env.VITE_REQUESTS_FORM ?? "",
    boardCsv: env.VITE_BOARD_CSV ?? "",
    repliesForm: env.VITE_REPLIES_FORM ?? "",
    repliesCsv: env.VITE_REPLIES_CSV ?? "",
    reportForm: env.VITE_REPORT_FORM ?? "",
    entries: parseFormEntries(env.VITE_FORM_ENTRIES),
  };
}

export function isSharingConfigured(env: SharingEnv = import.meta.env as SharingEnv): boolean {
  const c = getSharingConfig(env);
  return Boolean(c.requestsForm && c.boardCsv && c.repliesForm && c.repliesCsv && c.reportForm);
}

export function formUrlFor(config: SharingConfig, kind: FormKind): string {
  return kind === "requests" ? config.requestsForm : kind === "replies" ? config.repliesForm : config.reportForm;
}
