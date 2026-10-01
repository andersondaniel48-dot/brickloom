// Reading the gzipped CSV exports in data/rebrickable.
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

/**
 * Streams a gzipped CSV, calling `onRow` with each record's fields (header row excluded).
 * Handles quoted fields with embedded commas, quotes and newlines. Memory use stays flat, which
 * matters for the 1.5 million-row inventory file.
 */
export async function streamCsv(file: string, onRow: (fields: string[], header: string[]) => void): Promise<void> {
  const decoder = new TextDecoder();
  let header: string[] | null = null;
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let quotePending = false; // saw a quote inside a quoted field; the next character decides what it meant

  const endRow = () => {
    row.push(field);
    field = '';
    if (!header) header = row;
    else if (row.length === header.length) onRow(row, header);
    row = [];
  };

  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quotePending) {
        quotePending = false;
        if (ch === '"') {
          field += '"';
          continue;
        }
        quoted = false; // it was the closing quote; fall through to handle `ch` normally
      }
      if (quoted) {
        if (ch === '"') quotePending = true;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') (row.push(field), (field = ''));
      else if (ch === '\n') endRow();
      else if (ch !== '\r') field += ch;
    }
  };

  for await (const chunk of createReadStream(file).pipe(createGunzip())) feed(decoder.decode(chunk as Buffer, { stream: true }));
  feed(decoder.decode());
  if (field || row.length) endRow();
}

/** Reads a whole gzipped CSV into objects keyed by column name. */
export async function readCsv(file: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  await streamCsv(file, (fields, header) => rows.push(Object.fromEntries(header.map((h, i) => [h, fields[i]]))));
  return rows;
}
