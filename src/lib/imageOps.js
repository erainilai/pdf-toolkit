import sharp from 'sharp';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];
function isHeic(buf) {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIC_BRANDS.includes(buf.toString('ascii', 8, 12));
}

/** Decodes any supported upload (JPG, PNG, WebP, AVIF, GIF, TIFF, BMP-ish, HEIC from iPhones)
 *  into a sharp pipeline. HEIC goes through heic-convert because prebuilt sharp/libvips ships
 *  without a HEVC decoder (patent licensing). */
export async function openImage(buffer) {
  if (isHeic(buffer)) {
    const { default: convert } = await import('heic-convert');
    const png = await convert({ buffer, format: 'PNG' });
    return sharp(Buffer.from(png));
  }
  return sharp(buffer, { failOn: 'none' }).rotate(); // rotate() applies EXIF orientation
}

/** Returns {buffer, mimetype} that pdf-lib can embed: JPG/PNG pass through, others converted. */
export async function toEmbeddable(file) {
  const t = file.mimetype;
  if (t === 'image/jpeg' || t === 'image/png') {
    const img = sharp(file.buffer);
    const { orientation } = await img.metadata();
    if (!orientation || orientation === 1) return { buffer: file.buffer, mimetype: t };
  }
  const pipeline = await openImage(file.buffer);
  const { hasAlpha } = await pipeline.metadata();
  if (hasAlpha) return { buffer: await pipeline.png().toBuffer(), mimetype: 'image/png' };
  return { buffer: await pipeline.jpeg({ quality: 90 }).toBuffer(), mimetype: 'image/jpeg' };
}

/** Exam photo/signature resizer: exact pixel size, white background, JPEG between minKB and
 *  maxKB. Binary-searches JPEG quality for the largest file that fits under maxKB; if even
 *  max quality is below minKB, pads with harmless JPEG comment bytes (portals check size only). */
export async function resizeForExam(buffer, { width, height, minKB = 0, maxKB, dpi = 200, fit = 'cover' }) {
  width = parseInt(width, 10);
  height = parseInt(height, 10);
  maxKB = Number(maxKB);
  minKB = Number(minKB) || 0;
  if (!width || !height || !maxKB) throw new Error('width, height and maxKB are required.');
  const base = await (await openImage(buffer))
    .resize(width, height, { fit, position: 'attention', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .toBuffer();

  const encode = (q) => sharp(base).withMetadata({ density: Number(dpi) || 200 })
    .jpeg({ quality: q, chromaSubsampling: '4:4:4' }).toBuffer();

  let lo = 5, hi = 100, best = null;
  while (lo <= hi) {
    const q = Math.floor((lo + hi) / 2);
    const out = await encode(q);
    if (out.length <= maxKB * 1024) { best = { q, out }; lo = q + 1; } else { hi = q - 1; }
  }
  if (!best) throw new Error(`Cannot get this image under ${maxKB} KB at ${width}×${height}. Try a simpler image.`);
  let out = best.out;
  if (out.length < minKB * 1024) out = padJpeg(out, minKB * 1024 + 256);
  return { bytes: out, quality: best.q, sizeKB: +(out.length / 1024).toFixed(1) };
}

/** Inserts a COM (comment) segment after SOI to raise file size without touching pixels. */
function padJpeg(jpeg, targetBytes) {
  let need = targetBytes - jpeg.length;
  const segments = [];
  while (need > 0) {
    const len = Math.min(65533, Math.max(1, need - 4));
    const seg = Buffer.alloc(len + 4, 0x20);
    seg[0] = 0xff; seg[1] = 0xfe; seg.writeUInt16BE(len + 2, 2);
    segments.push(seg);
    need -= seg.length;
  }
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
}

/* ---------------- Background removal (U²-Net via ONNX Runtime) ---------------- */

const MODEL_PATH = process.env.BG_MODEL_PATH || join(ROOT, 'models', 'u2netp.onnx');
let sessionPromise;
async function getSession() {
  if (!sessionPromise) {
    if (!existsSync(MODEL_PATH)) {
      throw new Error(`Background-removal model not found at ${MODEL_PATH}. Run "npm run models" to download it.`);
    }
    sessionPromise = import('onnxruntime-node').then((ort) =>
      ort.InferenceSession.create(readFileSync(MODEL_PATH)).then((s) => ({ ort, s })));
  }
  return sessionPromise;
}

const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Removes the background and returns a PNG with transparency (or a solid background colour
 *  if `background` is given, e.g. "#ffffff" for exam/ID photos). */
export async function removeBackground(buffer, { background } = {}) {
  const { ort, s } = await getSession();
  const img = await openImage(buffer);
  const { data: rgb, info } = await img.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const small = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer();
  let max = 0;
  for (const v of small) if (v > max) max = v;
  max = max || 1;
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = (small[i * 3 + c] / max - MEAN[c]) / STD[c];
  }
  const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) };
  const results = await s.run(feeds);
  const pred = results[s.outputNames[0]].data;

  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < SIZE * SIZE; i++) { if (pred[i] < mn) mn = pred[i]; if (pred[i] > mx) mx = pred[i]; }
  const mask = Buffer.alloc(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) mask[i] = Math.round(((pred[i] - mn) / (mx - mn || 1)) * 255);

  const alpha = await sharp(mask, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer();

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  let out = sharp(rgba, { raw: { width, height, channels: 4 } });
  if (background) {
    out = out.flatten({ background });
    return { bytes: await out.jpeg({ quality: 92 }).toBuffer(), ext: 'jpg' };
  }
  return { bytes: await out.png().toBuffer(), ext: 'png' };
}

/** General-purpose image converter/resizer/compressor. */
export async function convertImage(buffer, { format = 'jpg', width, height, quality = 80 } = {}) {
  let p = await openImage(buffer);
  const w = parseInt(width, 10) || null;
  const h = parseInt(height, 10) || null;
  if (w || h) p = p.resize(w, h, { fit: 'inside', withoutEnlargement: true });
  const q = Math.min(100, Math.max(1, parseInt(quality, 10) || 80));
  switch (format) {
    case 'png': return { bytes: await p.png({ compressionLevel: 9 }).toBuffer(), ext: 'png' };
    case 'webp': return { bytes: await p.webp({ quality: q }).toBuffer(), ext: 'webp' };
    case 'avif': return { bytes: await p.avif({ quality: q }).toBuffer(), ext: 'avif' };
    default: return { bytes: await p.flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true }).toBuffer(), ext: 'jpg' };
  }
}
