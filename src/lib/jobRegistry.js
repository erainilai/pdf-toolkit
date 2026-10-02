import {
  mergePdfs, splitPdf, splitEveryNPages, removePages, extractPages,
  rotatePages, organizePages, addWatermark, addPageNumbers, imagesToPdf,
  pdfToImages, extractText, compressPdfBasic,
} from './pdfOps.js';
import { protectPdf, unlockPdf, compressPdfStrong } from './security.js';

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
    return asPdfResult(strong || await compressPdfBasic(files[0].buffer), 'compressed.pdf');
  },

  protect: async (files, { password } = {}) => {
    if (!password) throw new Error('"options.password" is required.');
    return asPdfResult(await protectPdf(files[0].buffer, password), 'protected.pdf');
  },

  unlock: async (files, { password } = {}) => {
    if (!password) throw new Error('"options.password" is required.');
    return asPdfResult(await unlockPdf(files[0].buffer, password), 'unlocked.pdf');
  },
};
