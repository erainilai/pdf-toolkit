import {
  mergePdfs, splitPdf, splitEveryNPages, removePages, extractPages,
  rotatePages, organizePages, addWatermark, addPageNumbers, imagesToPdf,
  pdfToImages, extractText, compressPdfBasic,
} from './pdfOps.js';
import { protectPdf, unlockPdf, compressPdfStrong } from './security.js';
import { compressPdfImages } from './compress.js';
import { officeToPdf, pdfToOffice } from './officeOps.js';
import { ocr } from './ocr.js';
import { resizeForExam, removeBackground, convertImage } from './imageOps.js';
import { convertSheet, cleanSheet, mergeSheets } from './sheetOps.js';
import { renderInvoice } from './invoice.js';
import { legacyToUnicode, unicodeToLegacy } from '../../public/js/lib/tamilFonts.js';

const stem = (name, fallback) => (name || fallback).replace(/\.[^.]+$/, '');
const parseJson = (v, what) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { throw new Error(`"${what}" must be valid JSON.`); }
};

const asPdfResult = (bytes, name) => [{ name, bytes: Buffer.from(bytes) }];

/** Each handler takes (files, options) where files = [{buffer, mimetype, originalname}],
 *  and returns [{name, bytes}]. This is the single source of truth for which tools the
 *  hosted job API (src/routes/v1.js) exposes — it reuses the exact same PDF logic as the
 *  synchronous /api/* routes used by the bundled UI. */
export const TOOLS = {
  merge: async (files) => asPdfResult(await mergePdfs(files.map((f) => f.buffer)), 'merged.pdf'),

  split: async (files, { ranges, everyN } = {}) => {
    const results = everyN
      ? await splitEveryNPages(files[0].buffer, Math.max(1, parseInt(everyN, 10) || 1))
      : await splitPdf(files[0].buffer, ranges || []);
    return results.map((r) => ({ name: r.name, bytes: Buffer.from(r.bytes) }));
  },

  'remove-pages': async (files, { pages } = {}) => asPdfResult(await removePages(files[0].buffer, pages), 'removed_pages.pdf'),

  'extract-pages': async (files, { pages } = {}) => asPdfResult(await extractPages(files[0].buffer, pages), 'extracted.pdf'),

  rotate: async (files, { angle, pages } = {}) =>
    asPdfResult(await rotatePages(files[0].buffer, parseInt(angle, 10) || 90, pages || 'all'), 'rotated.pdf'),

  organize: async (files, { order } = {}) => {
    if (!Array.isArray(order) || !order.length) throw new Error('"options.order" must be a non-empty array of 1-based page numbers.');
    return asPdfResult(await organizePages(files[0].buffer, order.map((n) => n - 1)), 'organized.pdf');
  },

  watermark: async (files, opts = {}) => {
    if (!opts.text) throw new Error('"options.text" is required.');
    return asPdfResult(await addWatermark(files[0].buffer, opts), 'watermarked.pdf');
  },

  'page-numbers': async (files, opts = {}) => asPdfResult(await addPageNumbers(files[0].buffer, opts), 'numbered.pdf'),

  'images-to-pdf': async (files, { pageSize } = {}) => asPdfResult(await imagesToPdf(files, { pageSize: pageSize || 'fit' }), 'images.pdf'),

  'pdf-to-images': async (files, { format, scale } = {}) => {
    const results = await pdfToImages(files[0].buffer, { format: format === 'jpg' ? 'jpg' : 'png', scale: parseFloat(scale) || 2 });
    return results.map((r) => ({ name: r.name, bytes: Buffer.from(r.bytes) }));
  },

  'pdf-to-text': async (files) => [{ name: 'extracted.txt', bytes: Buffer.from(await extractText(files[0].buffer), 'utf-8') }],

  compress: async (files, { quality } = {}) => {
    const strong = await compressPdfStrong(files[0].buffer, quality || 'ebook');
    if (strong) return asPdfResult(strong, 'compressed.pdf');
    const { bytes } = await compressPdfImages(files[0].buffer, quality || 'ebook');
    // Never hand back a bigger file than the user uploaded.
    const best = bytes.length < files[0].buffer.length ? bytes : await compressPdfBasic(files[0].buffer);
    return asPdfResult(best.length < files[0].buffer.length ? best : files[0].buffer, 'compressed.pdf');
  },

  protect: async (files, { password } = {}) => {
    if (!password) throw new Error('"options.password" is required.');
    return asPdfResult(await protectPdf(files[0].buffer, password), 'protected.pdf');
  },

  unlock: async (files, { password } = {}) => {
    if (!password) throw new Error('"options.password" is required.');
    return asPdfResult(await unlockPdf(files[0].buffer, password), 'unlocked.pdf');
  },

  /* ---- Office ---- */
  'office-to-pdf': async (files) => {
    const out = [];
    for (const f of files) { const r = await officeToPdf(f); out.push({ name: r.name, bytes: r.bytes }); }
    return out;
  },
  'pdf-to-word': async (files) => { const r = await pdfToOffice(files[0], 'docx'); return [r]; },
  'pdf-to-powerpoint': async (files) => { const r = await pdfToOffice(files[0], 'pptx'); return [r]; },

  /* ---- OCR ---- */
  ocr: async (files, { lang, output, maxPages } = {}) => {
    const { text, pdf } = await ocr(files, { lang: lang || 'tam+eng', maxPages });
    const base = stem(files[0].originalname, 'ocr');
    const txt = { name: `${base}_ocr.txt`, bytes: Buffer.from(text, 'utf-8') };
    const searchable = { name: `${base}_searchable.pdf`, bytes: Buffer.from(pdf) };
    if (output === 'text') return [txt];
    if (output === 'pdf') return [searchable];
    return [searchable, txt];
  },

  /* ---- Images ---- */
  'exam-photo': async (files, opts = {}) => {
    const r = await resizeForExam(files[0].buffer, opts);
    return [{ name: `${stem(files[0].originalname, 'photo')}_${opts.width}x${opts.height}.jpg`, bytes: r.bytes }];
  },
  'remove-background': async (files, { background } = {}) => {
    const out = [];
    for (const f of files) {
      const r = await removeBackground(f.buffer, { background: background || undefined });
      out.push({ name: `${stem(f.originalname, 'image')}_nobg.${r.ext}`, bytes: r.bytes });
    }
    return out;
  },
  'convert-image': async (files, opts = {}) => {
    const out = [];
    for (const f of files) {
      const r = await convertImage(f.buffer, opts);
      out.push({ name: `${stem(f.originalname, 'image')}.${r.ext}`, bytes: r.bytes });
    }
    return out;
  },

  /* ---- Spreadsheets ---- */
  'sheet-convert': async (files, opts = {}) => convertSheet(files, opts),
  'sheet-clean': async (files, opts = {}) => {
    const { files: out, report } = await cleanSheet(files, opts);
    return [...out, { name: 'cleaning_report.txt', bytes: Buffer.from(report.join('\n'), 'utf-8') }];
  },
  'sheet-merge': async (files, opts = {}) => mergeSheets(files, opts),

  /* ---- Tamil ---- */
  'tamil-font-convert': async (files, { text, font = 'bamini', direction = 'to-unicode' } = {}) => {
    const input = files[0] ? files[0].buffer.toString('utf-8') : text;
    if (!input) throw new Error('Provide "text" or upload a .txt file.');
    const out = direction === 'to-legacy' ? unicodeToLegacy(input, font) : legacyToUnicode(input, font);
    return [{ name: `converted_${direction === 'to-legacy' ? font : 'unicode'}.txt`, bytes: Buffer.from(out, 'utf-8') }];
  },

  /* ---- Business ---- */
  'gst-invoice': async (files, { invoice } = {}) => {
    const inv = parseJson(invoice, 'invoice');
    if (!inv || typeof inv !== 'object') throw new Error('"options.invoice" (invoice JSON) is required.');
    const safeNo = String(inv.invoiceNo || 'invoice').replace(/[^a-zA-Z0-9_-]/g, '_');
    return asPdfResult(await renderInvoice(inv), `invoice_${safeNo}.pdf`);
  },
};

/** Per-tool limits used by both APIs. minFiles 0 = the tool works from options alone. */
export const TOOL_META = {
  merge: { minFiles: 2 },
  'sheet-merge': { minFiles: 2 },
  'tamil-font-convert': { minFiles: 0 },
  'gst-invoice': { minFiles: 0 },
};
export const minFilesFor = (tool) => TOOL_META[tool]?.minFiles ?? 1;
