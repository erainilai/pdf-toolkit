import { Router } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { detectSystemTools } from '../lib/systemTools.js';
import { protectPdf, unlockPdf, compressPdfStrong } from '../lib/security.js';
import {
  mergePdfs, splitPdf, splitEveryNPages, removePages, extractPages,
  rotatePages, organizePages, addWatermark, addPageNumbers, imagesToPdf,
  pdfToImages, renderThumbnails, extractText, compressPdfBasic,
} from '../lib/pdfOps.js';
import { TOOLS, minFilesFor } from '../lib/jobRegistry.js';
import { compressPdfImages } from '../lib/compress.js';
import { createIpRateLimiter } from '../middleware/rateLimiter.js';

export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 50 } });

const router = Router();

// The browser UI is unauthenticated, so it gets a per-IP limit (WEB_RATE_LIMIT_MAX per minute).
router.use(createIpRateLimiter());

const asHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function sendPdf(res, bytes, filename) {
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(bytes));
}

function sendZip(res, files, zipName) {
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${zipName}"`);
  const archive = archiver('zip');
  archive.pipe(res);
  for (const f of files) archive.append(Buffer.from(f.bytes), { name: f.name });
  archive.finalize();
}

router.get('/system-info', asHandler(async (req, res) => {
  const tools = await detectSystemTools();
  res.json({
    qpdf: tools.qpdf,
    ghostscript: tools.ghostscript,
    libreoffice: tools.libreoffice,
    notes: {
      qpdf: tools.qpdf ? null : "Install qpdf ('brew install qpdf') to enable Protect/Unlock.",
      ghostscript: null, // optional: built-in image recompression covers most cases
      libreoffice: tools.libreoffice ? null : "Install LibreOffice ('brew install --cask libreoffice') to enable Office ↔ PDF.",
    },
  });
}));

router.post('/merge', upload.array('files', 50), asHandler(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Upload at least 2 PDF files.' });
  const bytes = await mergePdfs(req.files.map((f) => f.buffer));
  sendPdf(res, bytes, 'merged.pdf');
}));

router.post('/split', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const { ranges, everyN } = req.body;
  const files = everyN
    ? await splitEveryNPages(req.file.buffer, Math.max(1, parseInt(everyN, 10) || 1))
    : await splitPdf(req.file.buffer, JSON.parse(ranges || '[]'));
  if (files.length === 1) return sendPdf(res, files[0].bytes, files[0].name);
  sendZip(res, files, 'split.zip');
}));

router.post('/remove-pages', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const bytes = await removePages(req.file.buffer, req.body.pages);
  sendPdf(res, bytes, 'removed_pages.pdf');
}));

router.post('/extract-pages', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const bytes = await extractPages(req.file.buffer, req.body.pages);
  sendPdf(res, bytes, 'extracted.pdf');
}));

router.post('/rotate', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const angle = parseInt(req.body.angle, 10) || 90;
  const bytes = await rotatePages(req.file.buffer, angle, req.body.pages || 'all');
  sendPdf(res, bytes, 'rotated.pdf');
}));

router.post('/organize', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const order = JSON.parse(req.body.order || '[]').map((n) => n - 1);
  if (!order.length) return res.status(400).json({ error: 'No page order supplied.' });
  const bytes = await organizePages(req.file.buffer, order);
  sendPdf(res, bytes, 'organized.pdf');
}));

router.post('/thumbnails', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const thumbs = await renderThumbnails(req.file.buffer, { maxPages: Number(process.env.MAX_THUMBNAIL_PAGES || 300) });
  res.json({ thumbs });
}));

router.post('/watermark', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const { text, opacity, rotation, fontSize, color, position } = req.body;
  if (!text) return res.status(400).json({ error: 'Watermark text is required.' });
  const bytes = await addWatermark(req.file.buffer, {
    text,
    opacity: opacity !== undefined ? parseFloat(opacity) : undefined,
    rotation: rotation !== undefined ? parseFloat(rotation) : undefined,
    fontSize: fontSize !== undefined ? parseFloat(fontSize) : undefined,
    color, position,
  });
  sendPdf(res, bytes, 'watermarked.pdf');
}));

router.post('/page-numbers', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const { position, startAt, format } = req.body;
  const bytes = await addPageNumbers(req.file.buffer, {
    position, format,
    startAt: startAt !== undefined ? parseInt(startAt, 10) : undefined,
  });
  sendPdf(res, bytes, 'numbered.pdf');
}));

router.post('/images-to-pdf', upload.array('files', 100), asHandler(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Upload at least 1 image.' });
  const bytes = await imagesToPdf(req.files, { pageSize: req.body.pageSize || 'fit' });
  sendPdf(res, bytes, 'images.pdf');
}));

router.post('/pdf-to-images', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const format = req.body.format === 'jpg' ? 'jpg' : 'png';
  const files = await pdfToImages(req.file.buffer, { format, scale: parseFloat(req.body.scale) || 2 });
  if (files.length === 1) {
    res.set('Content-Type', format === 'jpg' ? 'image/jpeg' : 'image/png');
    res.set('Content-Disposition', `attachment; filename="${files[0].name}"`);
    return res.send(Buffer.from(files[0].bytes));
  }
  sendZip(res, files, 'pages.zip');
}));

router.post('/pdf-to-text', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const text = await extractText(req.file.buffer);
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="extracted.txt"');
  res.send(text);
}));

router.post('/compress', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  const quality = req.body.quality || 'ebook';
  const strong = await compressPdfStrong(req.file.buffer, quality);
  let bytes = strong;
  let mode = 'ghostscript';
  if (!bytes) {
    const r = await compressPdfImages(req.file.buffer, quality);
    bytes = r.bytes; mode = `images:${r.imagesRecompressed}`;
    if (bytes.length >= req.file.buffer.length) {
      const basic = await compressPdfBasic(req.file.buffer);
      bytes = basic.length < req.file.buffer.length ? basic : req.file.buffer;
      mode = 'basic';
    }
  }
  res.set('X-Compression-Mode', mode);
  const originalSize = req.file.buffer.length;
  const newSize = bytes.length;
  res.set('X-Original-Size', String(originalSize));
  res.set('X-Compressed-Size', String(newSize));
  sendPdf(res, bytes, 'compressed.pdf');
}));

router.post('/protect', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  if (!req.body.password) return res.status(400).json({ error: 'Password is required.' });
  const bytes = await protectPdf(req.file.buffer, req.body.password);
  sendPdf(res, bytes, 'protected.pdf');
}));

router.post('/unlock', upload.single('file'), asHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file.' });
  if (!req.body.password) return res.status(400).json({ error: 'Password is required.' });
  const bytes = await unlockPdf(req.file.buffer, req.body.password);
  sendPdf(res, bytes, 'unlocked.pdf');
}));

/** Generic synchronous endpoint for every tool in the registry (the tools added after the
 *  original 14 have no hand-written route). Options come from form fields, or from a single
 *  JSON "options" field. One output file is returned as-is; several are zipped. */
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

router.post('/tool/:tool', upload.array('files', 50), asHandler(async (req, res) => {
  const { tool } = req.params;
  const handler = TOOLS[tool];
  if (!handler) return res.status(404).json({ error: `Unknown tool "${tool}".` });
  const files = req.files || [];
  const min = minFilesFor(tool);
  if (files.length < min) return res.status(400).json({ error: min > 1 ? `Upload at least ${min} files.` : 'Upload a file first.' });
  let options = { ...req.body };
  if (typeof req.body.options === 'string') {
    try { options = JSON.parse(req.body.options); } catch { return res.status(400).json({ error: '"options" must be valid JSON.' }); }
  }
  const outputs = await handler(files, options);
  if (outputs.length === 1) {
    const [out] = outputs;
    const ext = out.name.split('.').pop().toLowerCase();
    res.set('Content-Type', MIME[ext] || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(out.name)}"; filename*=UTF-8''${encodeURIComponent(out.name)}`);
    return res.send(Buffer.from(out.bytes));
  }
  sendZip(res, outputs, `${tool}.zip`);
}));

export default router;
