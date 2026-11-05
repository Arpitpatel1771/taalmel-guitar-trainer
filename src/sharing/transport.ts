// Network layer behind an interface so tests can swap in testing/fakeForms.ts.

import { csvToRecords } from "./csv.js";
import { formUrlFor, type FormKind, type SharingConfig } from "./config.js";

export interface SharingTransport {
  /** POSTs `fields` (keyed by form entry id) to a Google Form's formResponse URL. The response is opaque. */
  submitForm(formUrl: string, fields: Record<string, string>): Promise<void>;
  /** Fetches a published CSV as text. Throws on network or HTTP failure. */
  fetchCsv(url: string): Promise<string>;
}

export const httpTransport: SharingTransport = {
  async submitForm(formUrl, fields) {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    await fetch(formUrl, { method: "POST", mode: "no-cors", body });
  },
  async fetchCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch CSV (${res.status})`);
    return res.text();
  },
};

export class MissingEntryError extends Error {
  constructor(public readonly kind: FormKind, public readonly field: string) {
    super(`No form entry id configured for ${kind}.${field}`);
    this.name = "MissingEntryError";
  }
}

/** Maps logical field names to entry ids and submits. Empty-string fields are still sent. */
export async function submitToForm(
  transport: SharingTransport,
  config: SharingConfig,
  kind: FormKind,
  fields: Record<string, string>,
): Promise<void> {
  const map = config.entries[kind];
  const mapped: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    const id = map[name];
    if (!id) throw new MissingEntryError(kind, name);
    mapped[id] = value;
  }
  await transport.submitForm(formUrlFor(config, kind), mapped);
}

/** Fetches a published CSV and returns records keyed by header name. */
export async function fetchCsvRecords(transport: SharingTransport, url: string): Promise<Record<string, string>[]> {
  return csvToRecords(await transport.fetchCsv(url));
}
