import { inflateSync as zlibInflateSync } from 'node:zlib';
import { PDFDocument, degrees, rgb, PDFName, PDFRawStream } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { embedFonts, textWidth, drawText, lineHeight } from './fonts.js';
import { toEmbeddable } from './imageOps.js';

/** Parses "1-3,5,8-10" into a sorted, de-duplicated list of 0-based page indices. */
export function parsePageRanges(spec, pageCount) {
  const indices = new Set();
  const parts = String(spec).split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`Invalid page range: "${part}"`);
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end < 1 || start > pageCount || end > pageCount || start > end) {
      throw new Error(`Page range "${part}" is out of bounds (document has ${pageCount} pages)`);
    }
    for (let p = start; p <= end; p++) indices.add(p - 1);
  }
  if (indices.size === 0) throw new Error('No valid pages specified');
  return [...indices].sort((a, b) => a - b);
}

export async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/** Splits into one PDF per range in `ranges` (array of "a-b" strings); returns [{name, bytes}]. */
export async function splitPdf(buffer, ranges) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  const results = [];
  for (let i = 0; i < ranges.length; i++) {
    const indices = parsePageRanges(ranges[i], pageCount);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    results.push({ name: `split_${i + 1}.pdf`, bytes: await out.save() });
  }
  return results;
}

export async function splitEveryNPages(buffer, n) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  const results = [];
  for (let start = 0; start < pageCount; start += n) {
    const indices = [];
    for (let i = start; i < Math.min(start + n, pageCount); i++) indices.push(i);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    results.push({ name: `pages_${start + 1}-${indices[indices.length - 1] + 1}.pdf`, bytes: await out.save() });
  }
  return results;
}

export async function removePages(buffer, pagesToRemoveSpec) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  const remove = new Set(parsePageRanges(pagesToRemoveSpec, pageCount));
  const keep = [];
  for (let i = 0; i < pageCount; i++) if (!remove.has(i)) keep.push(i);
  if (keep.length === 0) throw new Error('Cannot remove all pages from the document');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, keep);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

export async function extractPages(buffer, spec) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const indices = parsePageRanges(spec, src.getPageCount());
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/** angle: 90 | 180 | 270 (clockwise). spec: page range string, or "all". */
export async function rotatePages(buffer, angle, spec) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = pdf.getPageCount();
  const indices = spec && spec !== 'all' ? parsePageRanges(spec, pageCount) : [...Array(pageCount).keys()];
  const pages = pdf.getPages();
  for (const i of indices) {
    const page = pages[i];
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + angle) % 360));
  }
  return pdf.save();
}

/** order: array of 0-based page indices in desired output order (may omit pages to delete them). */
export async function organizePages(buffer, order) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, order);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

const POSITIONS = {
  center: (w, h, tw, th) => ({ x: (w - tw) / 2, y: (h - th) / 2 }),
  top: (w, h, tw, th) => ({ x: (w - tw) / 2, y: h - th - 30 }),
  bottom: (w, h, tw, th) => ({ x: (w - tw) / 2, y: 30 }),
  'top-left': () => ({ x: 24, y: null }),
  'top-right': (w, h, tw) => ({ x: w - tw - 24, y: null }),
  'bottom-left': () => ({ x: 24, y: 24 }),
  'bottom-right': (w, h, tw) => ({ x: w - tw - 24, y: 24 }),
};

export async function addWatermark(buffer, { text, opacity = 0.3, rotation = -45, fontSize = 48, color = '#ff0000', position = 'center' }) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const { bold } = await embedFonts(pdf);
  const col = hexToRgb(color);
  const size = Number(fontSize) || 48;
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const tw = textWidth(bold, text, size);
    const th = lineHeight(bold, size);
    const rot = Number(rotation ?? -45);
    let x, y;
    if (!POSITIONS[position] || position === 'center') {
      // Rotate around the page centre so diagonal watermarks stay centred on the page.
      const a = (rot * Math.PI) / 180;
      x = width / 2 - (tw / 2) * Math.cos(a) + (th / 3) * Math.sin(a);
      y = height / 2 - (tw / 2) * Math.sin(a) - (th / 3) * Math.cos(a);
    } else {
      ({ x, y } = POSITIONS[position](width, height, tw, th));
      if (y === null) y = height - th - 24;
    }
    drawText(page, bold, text, {
      x, y, size, color: rgb(col.r, col.g, col.b), opacity: Number(opacity ?? 0.3),
      rotate: degrees(rot),
    });
  }
  return pdf.save();
}

export async function addPageNumbers(buffer, { position = 'bottom-right', startAt = 1, format = '{n}', fontSize = 11 }) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const { regular } = await embedFonts(pdf);
  const pages = pdf.getPages();
  const total = pages.length;
  const size = Number(fontSize) || 11;
  pages.forEach((page, i) => {
    const n = (Number(startAt) || 1) + i;
    const text = String(format).replaceAll('{n}', n).replaceAll('{total}', total);
    const { width, height } = page.getSize();
    const tw = textWidth(regular, text, size);
    let x;
    if (position.endsWith('left')) x = 24;
    else if (position.endsWith('right')) x = width - tw - 24;
    else x = (width - tw) / 2;
    const y = position.startsWith('top') ? height - 30 : 20;
    drawText(page, regular, text, { x, y, size, color: rgb(0.2, 0.2, 0.2) });
  });
  return pdf.save();
}

export async function imagesToPdf(images, { pageSize = 'fit' } = {}) {
  const pdf = await PDFDocument.create();
  for (const original of images) {
    const img = await toEmbeddable(original); // WebP/HEIC/TIFF/GIF → JPG/PNG, EXIF rotation applied
    const isPng = img.mimetype === 'image/png';
    const embedded = isPng ? await pdf.embedPng(img.buffer) : await pdf.embedJpg(img.buffer);
    const { width, height } = embedded;
    let pageW = width, pageH = height;
    if (pageSize === 'a4') {
      pageW = 595.28; pageH = 841.89;
    }
    const page = pdf.addPage([pageW, pageH]);
    if (pageSize === 'a4') {
      const scale = Math.min(pageW / width, pageH / height);
      const w = width * scale, h = height * scale;
      page.drawImage(embedded, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
    } else {
      page.drawImage(embedded, { x: 0, y: 0, width, height });
    }
  }
  return pdf.save();
}

function openPdfJs(buffer) {
  return pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
    isEvalSupported: false,
  });
}

export async function pdfToImages(buffer, { format = 'png', scale = 2 } = {}) {
  const loadingTask = openPdfJs(buffer);
  const doc = await loadingTask.promise;
  const results = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const bytes = format === 'jpg' || format === 'jpeg'
      ? await canvas.encode('jpeg')
      : await canvas.encode('png');
    results.push({ name: `page_${String(i).padStart(3, '0')}.${format === 'jpeg' ? 'jpg' : format}`, bytes });
  }
  await loadingTask.destroy();
  return results;
}

export async function renderThumbnails(buffer, { maxWidth = 160, maxPages = Infinity } = {}) {
  const loadingTask = openPdfJs(buffer);
  const doc = await loadingTask.promise;
  if (doc.numPages > maxPages) {
    await loadingTask.destroy();
    throw new Error(`This PDF has ${doc.numPages} pages; visual organizing supports up to ${maxPages}. Use Extract/Remove pages instead.`);
  }
  const thumbs = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = maxWidth / unscaled.width;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const png = await canvas.encode('png');
    thumbs.push({ page: i, dataUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}` });
  }
  await loadingTask.destroy();
  return thumbs;
}

export async function extractText(buffer) {
  const loadingTask = openPdfJs(buffer);
  const doc = await loadingTask.promise;
  const pagesText = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pagesText.push(content.items.map((it) => it.str).join(' '));
  }
  await loadingTask.destroy();
  return pagesText.join('\n\n--- Page Break ---\n\n');
}

/** Basic, dependency-free compression: strips unused objects and uses compressed object streams. */
export async function compressPdfBasic(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  return pdf.save({ useObjectStreams: true, addDefaultPage: false });
}

function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/.{1,2}/g);
  return { r: parseInt(m[0], 16) / 255, g: parseInt(m[1], 16) / 255, b: parseInt(m[2], 16) / 255 };
}

/** Renders one page to a raster canvas at `scale`. Shared by grayscale conversion and
 *  redaction (both "render a page, manipulate pixels, re-embed as an image page"), and by
 *  the /api/page-preview route used for interactive positioning (Sign, Redact). Caller is
 *  responsible for `canvas.encode('png')` once any extra drawing is done. */
export async function rasterizePage(buffer, pageIndex, { scale = 2 } = {}) {
  const loadingTask = openPdfJs(buffer);
  const doc = await loadingTask.promise;
  if (pageIndex < 0 || pageIndex >= doc.numPages) {
    await loadingTask.destroy();
    throw new Error(`Page ${pageIndex + 1} does not exist in this document.`);
  }
  const page = await doc.getPage(pageIndex + 1); // pdf.js pages are 1-based
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  await loadingTask.destroy();
  return { canvas, ctx, width: canvas.width, height: canvas.height };
}

/** Only overwrites fields that were actually provided — existing values stay for blank ones. */
export async function setMetadata(buffer, { title, author, subject, keywords } = {}) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  if (title) pdf.setTitle(title);
  if (author) pdf.setAuthor(author);
  if (subject) pdf.setSubject(subject);
  if (keywords) pdf.setKeywords(String(keywords).split(',').map((s) => s.trim()).filter(Boolean));
  return pdf.save();
}

/** Margins in points (72pt = 1 inch), trimmed from each page's visible area via its crop box. */
export async function cropPages(buffer, { top = 0, bottom = 0, left = 0, right = 0 } = {}) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const w = width - left - right, h = height - top - bottom;
    if (w <= 0 || h <= 0) throw new Error('Margins are too large — nothing would be left of the page.');
    page.setCropBox(left, bottom, w, h);
  }
  return pdf.save();
}

export async function flattenForm(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const form = pdf.getForm();
  if (form.getFields().length === 0) throw new Error('This PDF has no fillable form fields to flatten.');
  form.flatten();
  return pdf.save();
}

const N_UP_GRIDS = { 2: [2, 1], 4: [2, 2], 6: [3, 2] }; // [cols, rows]

/** Lays `n` source pages onto each landscape A4 output sheet, in a grid. */
export async function nUpPages(buffer, n) {
  const [cols, rows] = N_UP_GRIDS[n] || N_UP_GRIDS[2];
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const srcPages = src.getPages();
  const PAGE_W = 841.89, PAGE_H = 595.28; // landscape A4
  const cellW = PAGE_W / cols, cellH = PAGE_H / rows;
  for (let i = 0; i < srcPages.length; i += n) {
    const page = out.addPage([PAGE_W, PAGE_H]);
    for (let j = 0; j < n && i + j < srcPages.length; j++) {
      const embedded = await out.embedPage(srcPages[i + j]);
      const scale = Math.min(cellW / embedded.width, cellH / embedded.height) * 0.95;
      const w = embedded.width * scale, h = embedded.height * scale;
      const col = j % cols, row = Math.floor(j / cols);
      const x = col * cellW + (cellW - w) / 2;
      const y = PAGE_H - (row + 1) * cellH + (cellH - h) / 2;
      page.drawPage(embedded, { x, y, width: w, height: h });
    }
  }
  return out.save();
}

/** Rasterizes every page and desaturates it — works with no system dependencies, at the cost
 *  of the output losing text search/copy (see plan: Ghostscript is deliberately excluded from
 *  production for licensing reasons, so this can't just call `gs -sColorConversionStrategy=Gray`). */
export async function grayscalePdf(buffer) {
  const loadingTask = openPdfJs(buffer);
  const doc = await loadingTask.promise;
  const out = await PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let p = 0; p < d.length; p += 4) {
      const gray = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      d[p] = d[p + 1] = d[p + 2] = gray;
    }
    ctx.putImageData(imgData, 0, 0);
    const png = await canvas.encode('png');
    const embedded = await out.embedPng(png);
    const outPage = out.addPage([canvas.width, canvas.height]);
    outPage.drawImage(embedded, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  }
  await loadingTask.destroy();
  return out.save();
}

/** Best-effort: walks each page's image XObjects and pulls out JPEG (DCTDecode) streams as-is,
 *  and raw bitmaps (FlateDecode, no filter) via sharp. Rarer encodings (CCITTFax, JPX, JBIG2)
 *  are skipped rather than erroring, since they're uncommon in typical PDFs. */
export async function extractImages(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const out = [];
  let n = 0;
  for (const page of pdf.getPages()) {
    const resources = page.node.Resources();
    const xobjects = resources?.lookup(PDFName.of('XObject'));
    if (!xobjects) continue;
    for (const key of xobjects.keys()) {
      const xobj = xobjects.lookup(key);
      if (!(xobj instanceof PDFRawStream)) continue;
      const dict = xobj.dict;
      const subtype = dict.lookup(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Image') continue;
      const filter = dict.lookup(PDFName.of('Filter'))?.toString();
      n++;
      try {
        if (filter === '/DCTDecode') {
          out.push({ name: `image_${n}.jpg`, bytes: Buffer.from(xobj.contents) });
        } else if (filter === '/FlateDecode' || !filter) {
          const width = dict.lookup(PDFName.of('Width'))?.asNumber();
          const height = dict.lookup(PDFName.of('Height'))?.asNumber();
          const colorSpace = dict.lookup(PDFName.of('ColorSpace'))?.toString();
          const channels = colorSpace === '/DeviceGray' ? 1 : colorSpace === '/DeviceCMYK' ? 4 : 3;
          // PDFRawStream.contents is exactly what's stored in the file — still FlateDecode
          // (zlib) compressed, not decoded pixel bytes, despite the "raw" in the class name.
          const raw = filter === '/FlateDecode' ? zlibInflateSync(Buffer.from(xobj.contents)) : Buffer.from(xobj.contents);
          const png = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
          out.push({ name: `image_${n}.png`, bytes: png });
        }
      } catch { /* unsupported encoding for this image — skip it, keep going */ }
    }
  }
  if (!out.length) throw new Error('No extractable images found in this PDF.');
  return out;
}

/** Walks the AcroForm and reports each field's name, type and current value/options. */
export async function listFormFields(buffer) {
  const { PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = await import('pdf-lib');
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const form = pdf.getForm();
  return form.getFields().map((f) => {
    const name = f.getName();
    if (f instanceof PDFTextField) return { name, type: 'text', value: f.getText() || '' };
    if (f instanceof PDFCheckBox) return { name, type: 'checkbox', value: f.isChecked() };
    if (f instanceof PDFDropdown) return { name, type: 'select', value: f.getSelected()[0] || '', options: f.getOptions() };
    if (f instanceof PDFRadioGroup) return { name, type: 'radio', value: f.getSelected() || '', options: f.getOptions() };
    return { name, type: 'unsupported', value: null };
  });
}

/** Sets each named field's value; unknown/missing field names are ignored. `flatten` bakes
 *  the filled values into the page content so the result is no longer form-editable. */
export async function fillFormFields(buffer, values, flatten) {
  const { PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = await import('pdf-lib');
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const form = pdf.getForm();
  for (const [name, value] of Object.entries(values || {})) {
    const field = form.getFields().find((f) => f.getName() === name);
    if (!field) continue;
    if (field instanceof PDFTextField) field.setText(value == null ? '' : String(value));
    else if (field instanceof PDFCheckBox) { if (value) field.check(); else field.uncheck(); }
    else if (field instanceof PDFDropdown) field.select(String(value));
    else if (field instanceof PDFRadioGroup) field.select(String(value));
  }
  if (flatten) form.flatten();
  return pdf.save();
}

/** Stamps a signature image onto one page. x/y/width/height are FRACTIONS (0-1, top-left
 *  origin) of the page — resolution-independent of whatever size the client rendered its
 *  preview at. Converted here using the PDF's own page size, then flipped for PDF's
 *  bottom-left origin. */
export async function signPdf(buffer, { pageIndex = 0, x, y, width, height, signaturePng }) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = pdf.getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) throw new Error(`Page ${pageIndex + 1} does not exist in this document.`);
  const page = pages[pageIndex];
  const { width: pageW, height: pageH } = page.getSize();
  const png = await pdf.embedPng(signaturePng);
  const w = width * pageW, h = height * pageH;
  page.drawImage(png, { x: x * pageW, y: pageH - (y * pageH) - h, width: w, height: h });
  return pdf.save();
}

/** True redaction: pages with boxes are rasterized with the boxes painted solid black, then
 *  re-embedded as image-only pages (the covered text is genuinely gone, not just hidden).
 *  Pages without boxes are copied through untouched, keeping their text searchable/selectable.
 *  `redactions`: [{ pageIndex, boxes: [{x, y, width, height}] }], all coordinates as fractions
 *  (0-1, top-left origin) of the page. */
export async function redactPages(buffer, redactions) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const redactMap = new Map((redactions || []).map((r) => [r.pageIndex, r.boxes]));
  const out = await PDFDocument.create();
  const pageCount = src.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const boxes = redactMap.get(i);
    if (!boxes?.length) {
      const [copied] = await out.copyPages(src, [i]);
      out.addPage(copied);
      continue;
    }
    const { canvas, ctx, width, height } = await rasterizePage(buffer, i, { scale: 2 });
    ctx.fillStyle = '#000000';
    for (const b of boxes) ctx.fillRect(b.x * width, b.y * height, b.width * width, b.height * height);
    const png = await canvas.encode('png');
    const embedded = await out.embedPng(png);
    const page = out.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
  }
  return out.save();
}
