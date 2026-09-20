// File: services/import/workbook.js
// Description: Thin, adapter-friendly view over an Excel workbook (exceljs).
//   Cells are flattened to plain values (formula results, rich text, hyperlinks),
//   and fill colours are exposed for colour-coded grids such as stacking sheets.

import ExcelJS from 'exceljs';

/** Flatten an exceljs cell value to a primitive / Date. */
export function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('error' in v) return null;
    if ('result' in v) return cellValue(v.result);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text;
    if ('formula' in v || 'sharedFormula' in v) return null;
    return null;
  }
  return v;
}

export class Sheet {
  constructor(ws, fileName) {
    this.ws = ws;
    this.name = ws.name;
    this.fileName = fileName;
    this.hidden = ws.state && ws.state !== 'visible';
    this.rowCount = ws.rowCount;
    this.colCount = ws.columnCount;
  }
  get(r, c) { return cellValue(this.ws.getRow(r).getCell(c).value); }
  fill(r, c) {
    const f = this.ws.getRow(r).getCell(c).fill;
    const argb = f && f.type === 'pattern' && f.fgColor && typeof f.fgColor.argb === 'string' ? f.fgColor.argb.toUpperCase() : null;
    return argb;
  }
  row(r, maxCol = this.colCount) {
    const out = [];
    for (let c = 1; c <= maxCol; c += 1) out.push(this.get(r, c));
    return out;
  }
  /** Row (within the first `scan`) that has the most non-empty cells — the header row of a flat table. */
  guessHeaderRow(scan = 15) {
    let best = 1; let bestN = -1;
    for (let r = 1; r <= Math.min(scan, this.rowCount); r += 1) {
      const n = this.row(r).filter((v) => v !== null && v !== '').length;
      if (n > bestN) { bestN = n; best = r; }
    }
    return best;
  }
  /** Flat table → { headers, rows:[{__row, [header]: value}] } using a header row (auto-detected by default). */
  table({ headerRow } = {}) {
    const hr = headerRow || this.guessHeaderRow();
    const headers = this.row(hr).map((h) => (h === null || h === undefined ? '' : String(h).replace(/\s+/g, ' ').trim()));
    const rows = [];
    for (let r = hr + 1; r <= this.rowCount; r += 1) {
      const vals = this.row(r, headers.length);
      if (!vals.some((v) => v !== null && v !== '')) continue;
      rows.push({ __row: r, __vals: vals });
    }
    return { headerRow: hr, headers, rows };
  }
  /** First cell whose text matches `re` within the top-left window. Returns {r,c} or null. */
  find(re, { maxRow = 20, maxCol = 30 } = {}) {
    for (let r = 1; r <= Math.min(maxRow, this.rowCount); r += 1) {
      for (let c = 1; c <= Math.min(maxCol, this.colCount); c += 1) {
        const v = this.get(r, c);
        if (v !== null && re.test(String(v).replace(/\s+/g, ' ').trim())) return { r, c };
      }
    }
    return null;
  }
  findAll(re, opts = {}) {
    const { maxRow = 20, maxCol = 30 } = opts; const out = [];
    for (let r = 1; r <= Math.min(maxRow, this.rowCount); r += 1) {
      for (let c = 1; c <= Math.min(maxCol, this.colCount); c += 1) {
        const v = this.get(r, c);
        if (v !== null && re.test(String(v).replace(/\s+/g, ' ').trim())) out.push({ r, c, v: String(v).trim() });
      }
    }
    return out;
  }
}

/** Column accessor for a flat table: fuzzy, case-insensitive header lookup with synonyms. */
export function columnIndex(headers, ...needles) {
  const norm = headers.map((h) => h.toLowerCase());
  for (const n of needles) {
    const want = n.toLowerCase();
    const exact = norm.indexOf(want);
    if (exact !== -1) return exact;
  }
  for (const n of needles) {
    const want = n.toLowerCase();
    const i = norm.findIndex((h) => h.includes(want));
    if (i !== -1) return i;
  }
  return -1;
}

export async function loadWorkbook(buffer, fileName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = wb.worksheets.map((ws) => new Sheet(ws, fileName));
  return { fileName, sheets, sheet: (name) => sheets.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase()) || null };
}
