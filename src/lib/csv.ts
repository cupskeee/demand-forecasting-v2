export interface Table {
  columns: string[];
  rows: string[][];
  delimiter: string;
}

/** Picks the delimiter that splits the header line into the most fields. */
function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t', '|']) {
    const count = firstLine.split(d).length;
    if (count > bestCount) [best, bestCount] = [d, count];
  }
  return best;
}

/** Parses CSV text (quoted fields, embedded newlines, comma/semicolon/tab). */
export function parseCsv(input: string): Table {
  const text = input.replace(/^﻿/, '');
  const delimiter = sniffDelimiter(text);
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      field = '';
      record = [];
    } else field += c;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length < 2) throw new Error('The file needs a header row and at least one row of data.');

  const seen = new Map<string, number>();
  const columns = nonEmpty[0].map((raw, i) => {
    const base = raw.trim() || `column ${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base} (${count + 1})` : base;
  });
  if (columns.length < 2) {
    throw new Error('Only one column was found. The file needs a date column and a sales column.');
  }
  const rows = nonEmpty
    .slice(1)
    .map((r) => columns.map((_, i) => (r[i] ?? '').trim()));
  return { columns, rows, delimiter };
}

/** Reads a number written in common styles: 1234.5, 1,234.5, 1.234,5, 12%, Rp 1.200. */
export function parseNumber(raw: string): number | null {
  let s = raw.trim();
  if (s === '') return null;
  s = s.replace(/^(rp\.?|idr|usd|\$|€|£)\s*/i, '').replace(/\s|%$/g, '');
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) ? value : null;
}
