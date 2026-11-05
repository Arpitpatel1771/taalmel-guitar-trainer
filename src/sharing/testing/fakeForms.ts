// In-memory stand-in for Google Forms + published Sheets CSV. Submitting to a
// form URL appends a row (columns named by logical field, plus Timestamp);
// fetchCsv returns the CSV of the matching sheet. Mirrors the real behavior
// where the Board/CSV only reflects rows after submission.

import { toCsv } from "../csv.js";
import type { FormEntries, FormKind, SharingConfig } from "../config.js";
import type { SharingTransport } from "../transport.js";

export interface FakeFormsHandle {
  config: SharingConfig;
  transport: SharingTransport;
  /** Raw rows per form kind (logical field names). */
  rows: Record<FormKind, Record<string, string>[]>;
  /** Simulates the owner deleting a row. */
  deleteRow(kind: FormKind, index: number): void;
  /** When true, CSV fetches fail (offline). */
  setOffline(offline: boolean): void;
}

export const FAKE_FIELDS: Record<FormKind, string[]> = {
  requests: ["action", "requestId", "title", "artist", "part", "youtubeUrl", "note", "displayName", "publicKey", "closeHash", "closeSecret"],
  replies: ["requestId", "recipientKeyId", "senderPublicKey", "iv", "ciphertext"],
  report: ["requestId", "reason"],
};

export function createFakeForms(): FakeFormsHandle {
  const urls = {
    requestsForm: "https://fake.forms/requests/formResponse",
    boardCsv: "https://fake.sheets/board.csv",
    repliesForm: "https://fake.forms/replies/formResponse",
    repliesCsv: "https://fake.sheets/replies.csv",
    reportForm: "https://fake.forms/report/formResponse",
  };
  const entries = { requests: {}, replies: {}, report: {} } as FormEntries;
  (Object.keys(FAKE_FIELDS) as FormKind[]).forEach((kind, k) => {
    FAKE_FIELDS[kind].forEach((name, i) => {
      entries[kind][name] = `entry.${(k + 1) * 1000 + i}`;
    });
  });
  const config: SharingConfig = { ...urls, entries };
  const rows: FakeFormsHandle["rows"] = { requests: [], replies: [], report: [] };
  const formKinds: Record<string, FormKind> = {
    [urls.requestsForm]: "requests",
    [urls.repliesForm]: "replies",
    [urls.reportForm]: "report",
  };
  const csvKinds: Record<string, FormKind> = { [urls.boardCsv]: "requests", [urls.repliesCsv]: "replies" };
  let offline = false;

  const transport: SharingTransport = {
    async submitForm(formUrl, fields) {
      const kind = formKinds[formUrl];
      if (!kind) throw new Error(`Unknown form ${formUrl}`);
      const byId = Object.fromEntries(Object.entries(entries[kind]).map(([n, id]) => [id, n]));
      const row: Record<string, string> = { Timestamp: new Date().toISOString() };
      for (const name of FAKE_FIELDS[kind]) row[name] = "";
      for (const [id, v] of Object.entries(fields)) {
        const name = byId[id];
        if (name) row[name] = v;
      }
      rows[kind].push(row);
    },
    async fetchCsv(url) {
      if (offline) throw new Error("offline");
      const kind = csvKinds[url];
      if (!kind) throw new Error(`Unknown CSV ${url}`);
      const header = ["Timestamp", ...FAKE_FIELDS[kind]];
      return toCsv([header, ...rows[kind].map((r) => header.map((h) => r[h] ?? ""))]);
    },
  };

  return {
    config,
    transport,
    rows,
    deleteRow: (kind, index) => void rows[kind].splice(index, 1),
    setOffline: (v) => void (offline = v),
  };
}
