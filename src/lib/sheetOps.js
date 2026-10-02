import ExcelJS from 'exceljs';

/** Spreadsheet tools on top of exceljs (MIT). Every input (CSV, XLSX, JSON) is read into a
 *  plain table model — {name, rows: [[...]]} per sheet — so cleaning/merging logic is
 *  format-independent, then written out in the requested format. */

function extOf(name = '') {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);          // formula → cached result
    if ('text' in v) return v.text;                          // hyperlink
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('error' in v) return '';
  }
  return v;
}

/** Minimal RFC 4180 CSV parser (quoted fields, embedded commas/newlines, "" escapes). */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const sample = text.slice(0, 2000);
  const delim = (sample.match(/;/g) || []).length > (sample.match(/,/g) || []).length ? ';'
    : (sample.match(/\t/g) || []).length > (sample.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n'); // BOM so Excel reads UTF-8 (Tamil) correctly
}

export async function readTables(file) {
  const ext = extOf(file.originalname);
  const base = (file.originalname || 'sheet').replace(/\.[^.]+$/, '');
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    return [{ name: base, rows: parseCsv(file.buffer.toString('utf-8')) }];
  }
  if (ext === 'json') {
    let data = JSON.parse(file.buffer.toString('utf-8'));
    if (!Array.isArray(data)) data = Object.values(data).find(Array.isArray) || [data];
    const headers = [...new Set(data.flatMap((o) => Object.keys(o ?? {})))];
    return [{ name: base, rows: [headers, ...data.map((o) => headers.map((h) => o?.[h] ?? ''))] }];
  }
  if (ext === 'xlsx' || ext === 'xlsm') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    return wb.worksheets.map((ws) => {
      const rows = [];
      ws.eachRow({ includeEmpty: true }, (r, n) => {
        const vals = [];
        for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(r.getCell(c).value));
        rows[n - 1] = vals;
      });
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      return { name: ws.name, rows };
    });
  }
  throw new Error(`Unsupported file type ".${ext}". Use CSV, XLSX or JSON (old .xls: convert with Office to PDF/XLSX first).`);
}

async function writeOutput(tables, format, baseName) {
  if (format === 'csv') {
    if (tables.length === 1) return [{ name: `${baseName}.csv`, bytes: Buffer.from(toCsv(tables[0].rows), 'utf-8') }];
    return tables.map((t) => ({ name: `${safe(t.name)}.csv`, bytes: Buffer.from(toCsv(t.rows), 'utf-8') }));
  }
  if (format === 'json') {
    const asObjects = (rows) => {
      const [h = [], ...body] = rows;
      return body.map((r) => Object.fromEntries(h.map((k, i) => [String(k || `column_${i + 1}`), r[i] ?? ''])));
    };
    const data = tables.length === 1 ? asObjects(tables[0].rows)
      : Object.fromEntries(tables.map((t) => [t.name, asObjects(t.rows)]));
    return [{ name: `${baseName}.json`, bytes: Buffer.from(JSON.stringify(data, null, 2), 'utf-8') }];
  }
  const wb = new ExcelJS.Workbook();
  const used = new Set();
  for (const t of tables) {
    let name = safe(t.name).slice(0, 31) || 'Sheet';
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${safe(t.name).slice(0, 28)}_${i}`;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name);
    t.rows.forEach((r) => ws.addRow(r.map(numeric)));
    if (t.rows.length) {
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.columns.forEach((col) => {
        let w = 8;
        col.eachCell({ includeEmpty: false }, (c) => { w = Math.max(w, Math.min(60, String(c.value ?? '').length + 2)); });
        col.width = w;
      });
    }
  }
  return [{ name: `${baseName}.xlsx`, bytes: Buffer.from(await wb.xlsx.writeBuffer()) }];
}

function safe(s) { return String(s).replace(/[\\/?*[\]:]/g, '_'); }
/** Keeps CSV numbers numeric in Excel, but leaves codes with leading zeros (PIN, phone) as text. */
function numeric(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s)) return Number(s);
  // Thousand separators, Western (1,234,567) or Indian (12,34,567) grouping.
  if (/^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s) || /^-?[1-9]\d?(,\d{2})*,\d{3}(\.\d+)?$/.test(s)) return Number(s.replaceAll(',', ''));
  return v;
}

export async function convertSheet(files, { format = 'xlsx' } = {}) {
  if (!['xlsx', 'csv', 'json'].includes(format)) throw new Error('format must be xlsx, csv or json');
  const f = files[0];
  return writeOutput(await readTables(f), format, (f.originalname || 'converted').replace(/\.[^.]+$/, ''));
}

/** Cleans every sheet: trims whitespace, drops fully empty rows/columns, removes duplicate
 *  rows (whole row, or by the given key columns), optionally normalises header case. */
export async function cleanSheet(files, opts = {}) {
  const flag = (v, d) => (v === undefined || v === '' ? d : v === true || v === 'true' || v === 'on');
  const trim = flag(opts.trim, true);
  const dropEmpty = flag(opts.removeEmpty, true);
  const dedupe = flag(opts.dedupe, true);
  const keyCols = String(opts.dedupeColumns || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const f = files[0];
  const tables = await readTables(f);
  const report = [];
  for (const t of tables) {
    let rows = t.rows.map((r) => r.map((v) => (trim && typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v)));
    const before = rows.length;
    if (dropEmpty) {
      rows = rows.filter((r) => r.some((v) => v !== '' && v !== null && v !== undefined));
      const width = Math.max(0, ...rows.map((r) => r.length));
      const keep = [...Array(width).keys()].filter((c) => rows.some((r) => r[c] !== '' && r[c] !== undefined && r[c] !== null));
      rows = rows.map((r) => keep.map((c) => r[c] ?? ''));
    }
    let dupes = 0;
    if (dedupe && rows.length > 1) {
      const [header, ...body] = rows;
      const idx = keyCols.length
        ? keyCols.map((k) => header.findIndex((h) => String(h).trim().toLowerCase() === k)).filter((i) => i >= 0)
        : null;
      if (keyCols.length && !idx.length) throw new Error(`None of the columns "${keyCols.join(', ')}" exist in sheet "${t.name}".`);
      const seen = new Set();
      const kept = body.filter((r) => {
        const key = JSON.stringify((idx || r.map((_, i) => i)).map((i) => String(r[i] ?? '').toLowerCase()));
        if (seen.has(key)) { dupes++; return false; }
        seen.add(key); return true;
      });
      rows = [header, ...kept];
    }
    t.rows = rows;
    report.push(`${t.name}: ${before} → ${rows.length} rows (${dupes} duplicates removed)`);
  }
  const base = (f.originalname || 'cleaned').replace(/\.[^.]+$/, '');
  const fmt = ['csv', 'json'].includes(opts.format) ? opts.format : (extOf(f.originalname) === 'csv' ? 'csv' : 'xlsx');
  const out = await writeOutput(tables, fmt, `${base}_cleaned`);
  return { files: out, report };
}

/** Merges several files. mode "rows": stack every sheet into one table, aligning columns by
 *  header name and adding a "Source" column. mode "sheets": one workbook, one sheet per input. */
export async function mergeSheets(files, { mode = 'rows', format = 'xlsx' } = {}) {
  if (files.length < 2) throw new Error('Upload at least 2 files to merge.');
  const all = [];
  for (const f of files) {
    for (const t of await readTables(f)) all.push({ ...t, source: files.length > 1 ? `${f.originalname}${t.name !== f.originalname.replace(/\.[^.]+$/, '') ? ` / ${t.name}` : ''}` : t.name });
  }
  if (mode === 'sheets') return writeOutput(all, 'xlsx', 'merged');
  const headers = [];
  for (const t of all) for (const h of t.rows[0] || []) if (!headers.includes(h)) headers.push(h);
  const rows = [[...headers, 'Source']];
  for (const t of all) {
    const [h = [], ...body] = t.rows;
    for (const r of body) if (r.some((v) => v !== '' && v != null)) rows.push([...headers.map((name) => { const i = h.indexOf(name); return i >= 0 ? r[i] ?? '' : ''; }), t.source]);
  }
  return writeOutput([{ name: 'Merged', rows }], format === 'csv' ? 'csv' : 'xlsx', 'merged');
}
