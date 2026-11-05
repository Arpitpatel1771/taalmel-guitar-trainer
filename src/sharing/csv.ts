// Minimal RFC 4180 CSV parser: quoted cells, doubled quotes, commas and
// newlines inside quotes, CRLF/LF, optional BOM.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let touched = false;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      touched = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      touched = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (touched || row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      touched = false;
    } else {
      cell += ch;
      touched = true;
    }
  }
  if (touched || cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function csvEscape(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
}

/** First row is the header; returns one record per remaining row (missing cells become ""). */
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return [];
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((name, idx) => {
      rec[name.trim()] = r[idx] ?? "";
    });
    return rec;
  });
}
