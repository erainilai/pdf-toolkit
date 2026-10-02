import { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';

/** Image-recompression pass for PDFs, without Ghostscript (AGPL). Most PDF bloat is
 *  oversized scans/photos, so we downsample and re-encode embedded images as JPEG and keep
 *  the new bytes only when they are actually smaller. Vector content, fonts and text are
 *  untouched, so the output stays selectable/searchable.
 *
 *  Handles: JPEG images (DCTDecode) and 8-bit RGB/Gray Flate images without predictors.
 *  Skips: image masks, CMYK/indexed/16-bit images, JBIG2/JPX, images with Decode arrays —
 *  those are left exactly as they were. */

export const COMPRESS_PRESETS = {
  screen: { maxDim: 1200, quality: 55 },   // smallest
  ebook: { maxDim: 1800, quality: 70 },    // balanced
  printer: { maxDim: 3000, quality: 85 },  // high quality
};

function nameOf(obj) {
  return obj instanceof PDFName ? obj.asString() : null;
}

function filtersOf(dict) {
  const f = dict.get(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFArray) return f.asArray().map(nameOf);
  return [nameOf(f)];
}

function channelsFor(dict, context) {
  let cs = dict.get(PDFName.of('ColorSpace'));
  if (cs && !(cs instanceof PDFName)) cs = context.lookup(cs);
  const n = nameOf(cs);
  if (n === '/DeviceRGB') return 3;
  if (n === '/DeviceGray') return 1;
  if (cs instanceof PDFArray) {
    const arr = cs.asArray();
    if (nameOf(arr[0]) === '/ICCBased') {
      const iccStream = context.lookup(arr[1]);
      const N = iccStream?.dict?.get(PDFName.of('N'));
      if (N instanceof PDFNumber && (N.asNumber() === 1 || N.asNumber() === 3)) return N.asNumber();
    }
  }
  return null;
}

export async function compressPdfImages(buffer, quality = 'ebook') {
  const preset = COMPRESS_PRESETS[quality] || COMPRESS_PRESETS.ebook;
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const context = pdf.context;
  let replaced = 0;

  // Soft masks (transparency) are images too; lossy-encoding them causes halo artifacts.
  const softMasks = new Set();
  for (const [, obj] of context.enumerateIndirectObjects()) {
    const sm = obj?.dict?.get?.(PDFName.of('SMask'));
    if (sm?.toString) softMasks.add(sm.toString());
  }

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (softMasks.has(ref.toString())) continue;
    const dict = obj.dict;
    if (nameOf(dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
    if (dict.get(PDFName.of('ImageMask')) || dict.get(PDFName.of('Decode')) || dict.get(PDFName.of('Mask'))) continue;
    const bpc = dict.get(PDFName.of('BitsPerComponent'));
    if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) continue;
    const channels = channelsFor(dict, context);
    if (!channels) continue;
    const width = dict.get(PDFName.of('Width'))?.asNumber?.();
    const height = dict.get(PDFName.of('Height'))?.asNumber?.();
    if (!width || !height) continue;

    const filters = filtersOf(dict);
    const original = obj.contents;
    let input;
    try {
      if (filters.length === 1 && filters[0] === '/DCTDecode') {
        input = sharp(Buffer.from(original));
      } else if (filters.length === 1 && filters[0] === '/FlateDecode') {
        const parms = dict.get(PDFName.of('DecodeParms'));
        if (parms instanceof PDFDict && parms.get(PDFName.of('Predictor'))) continue;
        const raw = inflateSync(Buffer.from(original));
        if (raw.length < width * height * channels) continue;
        input = sharp(raw.subarray(0, width * height * channels), { raw: { width, height, channels } });
      } else {
        continue;
      }

      const scale = Math.min(1, preset.maxDim / Math.max(width, height));
      const newW = Math.max(1, Math.round(width * scale));
      const newH = Math.max(1, Math.round(height * scale));
      let pipeline = input.resize(newW, newH, { fit: 'fill' });
      pipeline = channels === 1 ? pipeline.toColourspace('b-w') : pipeline.toColourspace('srgb');
      const jpeg = await pipeline.jpeg({ quality: preset.quality, mozjpeg: true }).toBuffer();
      if (jpeg.length >= original.length * 0.95) continue;

      const newDict = dict.clone(context);
      newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      newDict.delete(PDFName.of('DecodeParms'));
      newDict.set(PDFName.of('Width'), PDFNumber.of(newW));
      newDict.set(PDFName.of('Height'), PDFNumber.of(newH));
      newDict.set(PDFName.of('ColorSpace'), PDFName.of(channels === 1 ? 'DeviceGray' : 'DeviceRGB'));
      newDict.set(PDFName.of('Length'), PDFNumber.of(jpeg.length));
      context.assign(ref, PDFRawStream.of(newDict, jpeg));
      replaced++;
    } catch {
      // Unreadable or unusual image data: leave it untouched.
    }
  }

  const bytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
  return { bytes, imagesRecompressed: replaced };
}
