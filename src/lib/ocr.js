import { mkdir, writeFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import { pdfToImages } from './pdfOps.js';
import { openImage } from './imageOps.js';

/** OCR with tesseract.js (Apache-2.0, WebAssembly — no system binary needed).
 *  Language data for Tamil and English ships via npm (@tesseract.js-data/*), so nothing is
 *  downloaded at runtime. Workers are created per language set and reused. */

const require = createRequire(import.meta.url);
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const CACHE = join(DATA_DIR, 'tessdata');
export const OCR_LANGS = { 'tam+eng': 'Tamil + English', tam: 'Tamil', eng: 'English' };

let prepared;
async function prepareLangData() {
  if (!prepared) {
    prepared = (async () => {
      await mkdir(CACHE, { recursive: true });
      for (const code of ['tam', 'eng']) {
        const target = join(CACHE, `${code}.traineddata`);
        try { await access(target); continue; } catch { /* not cached yet */ }
        const { langPath } = require(`@tesseract.js-data/${code}`);
        // Use the "best_int" models when present — noticeably better on Tamil conjuncts.
        const best = langPath.replace(/4\.0\.0$/, '4.0.0_best_int');
        let gz;
        try { gz = readFileSync(join(best, `${code}.traineddata.gz`)); } catch { gz = readFileSync(join(langPath, `${code}.traineddata.gz`)); }
        await writeFile(target, gunzipSync(gz));
      }
    })();
  }
  return prepared;
}

const workers = new Map();
async function getWorker(lang) {
  if (!workers.has(lang)) {
    workers.set(lang, (async () => {
      await prepareLangData();
      const { createWorker } = await import('tesseract.js');
      // cachePath holds the unpacked .traineddata files, so langPath is never consulted.
      return createWorker(lang, 1, { cachePath: CACHE, langPath: CACHE, gzip: false, cacheMethod: 'readOnly' });
    })());
  }
  return workers.get(lang);
}

/** OCRs images or a (scanned) PDF. Returns text plus a searchable PDF (original page images
 *  with an invisible text layer — the format scanners produce). */
export async function ocr(files, { lang = 'tam+eng', maxPages } = {}) {
  if (!OCR_LANGS[lang]) throw new Error(`Unsupported language "${lang}". Use one of: ${Object.keys(OCR_LANGS).join(', ')}`);
  const pages = [];
  for (const f of files) {
    if (f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '')) {
      const imgs = await pdfToImages(f.buffer, { format: 'png', scale: 2.5 }); // ~180 DPI for A4
      for (const im of imgs) pages.push(Buffer.from(im.bytes));
    } else {
      pages.push(await (await openImage(f.buffer)).png().toBuffer());
    }
  }
  if (!pages.length) throw new Error('Nothing to OCR.');
  const cap = Math.min(Number(maxPages) || Infinity, Number(process.env.OCR_MAX_PAGES || 50));
  if (pages.length > cap) {
    throw new Error(`This file has ${pages.length} pages; your plan allows OCR on up to ${cap} pages per task.`);
  }

  const worker = await getWorker(lang);
  const texts = [];
  const out = await PDFDocument.create();
  for (const png of pages) {
    const { data } = await worker.recognize(png, { pdfTitle: 'OCR output' }, { text: true, pdf: true });
    // Tesseract emits a zero-width non-joiner after Tamil pulli (்); it breaks search and copy-paste.
    texts.push(data.text.replace(/\u0BCD\u200C/g, '\u0BCD').trim());
    const pagePdf = await PDFDocument.load(Uint8Array.from(data.pdf));
    const copied = await out.copyPages(pagePdf, pagePdf.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return {
    text: texts.join('\n\n--- Page Break ---\n\n'),
    pdf: await out.save(),
  };
}
