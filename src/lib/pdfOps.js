import { PDFDocument, degrees, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
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

export async function pdfToImages(buffer, { format = 'png', scale = 2 } = {}) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
    isEvalSupported: false,
  });
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
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
    isEvalSupported: false,
  });
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
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
    isEvalSupported: false,
  });
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
