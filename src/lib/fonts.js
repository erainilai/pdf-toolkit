import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// @pdf-lib/fontkit's complex-script (Indic) shaper is compiled with regenerator and expects
// a global regeneratorRuntime, which Node doesn't provide.
import 'regenerator-runtime/runtime.js';

const fontkit = createRequire(import.meta.url)('@pdf-lib/fontkit');

/** Unicode font support for pdf-lib. pdf-lib's built-in StandardFonts only cover
 *  WinAnsi (Latin-1), so Tamil text or the ₹ sign throw "cannot encode" errors. These helpers
 *  embed Noto Sans / Noto Sans Tamil (SIL Open Font License — safe to bundle and host) and
 *  draw mixed-script strings by splitting them into per-script runs. */

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
const cache = new Map();
function fontBytes(file) {
  if (!cache.has(file)) cache.set(file, readFileSync(join(FONT_DIR, file)));
  return cache.get(file);
}

const TAMIL = /[஀-௿]/;

/** Registers fontkit and embeds the Latin + Tamil faces (regular and bold) once per document. */
export async function embedFonts(pdf) {
  pdf.registerFontkit(fontkit);
  const [latin, latinBold, tamil, tamilBold] = await Promise.all([
    pdf.embedFont(fontBytes('NotoSans-Regular.ttf'), { subset: true }),
    pdf.embedFont(fontBytes('NotoSans-Bold.ttf'), { subset: true }),
    pdf.embedFont(fontBytes('NotoSansTamil-Regular.ttf'), { subset: true }),
    pdf.embedFont(fontBytes('NotoSansTamil-Bold.ttf'), { subset: true }),
  ]);
  return {
    regular: { latin, tamil },
    bold: { latin: latinBold, tamil: tamilBold },
  };
}

/** Splits text into runs of [isTamil, text]. Spaces and punctuation stay with the run they
 *  sit in, so word spacing is measured with the surrounding script's font. */
export function splitRuns(text) {
  const runs = [];
  for (const ch of String(text)) {
    const isTamil = TAMIL.test(ch);
    const neutral = /[\s.,:;!?()\-/'"]/.test(ch);
    const last = runs[runs.length - 1];
    if (last && (last.tamil === isTamil || neutral)) last.text += ch;
    else runs.push({ tamil: isTamil, text: ch });
  }
  return runs;
}

/** Width of a mixed-script string at a given size. `face` is fonts.regular or fonts.bold. */
export function textWidth(face, text, size) {
  return splitRuns(text).reduce(
    (w, r) => w + (r.tamil ? face.tamil : face.latin).widthOfTextAtSize(r.text, size), 0);
}

/** Draws a mixed-script string left-aligned at (x, y). Extra drawText options (color,
 *  opacity) are passed through. Rotation is applied around (x, y) for every run. */
export function drawText(page, face, text, { x, y, size, rotate, ...rest }) {
  const angle = rotate ? (rotate.angle * Math.PI) / 180 : 0;
  let offset = 0;
  for (const r of splitRuns(text)) {
    const font = r.tamil ? face.tamil : face.latin;
    page.drawText(r.text, {
      ...rest,
      x: x + offset * Math.cos(angle),
      y: y + offset * Math.sin(angle),
      size, font, rotate,
    });
    offset += font.widthOfTextAtSize(r.text, size);
  }
}

export function lineHeight(face, size) {
  return face.latin.heightAtSize(size);
}
