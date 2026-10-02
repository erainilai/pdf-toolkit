import { FONT_TABLES } from './tamilFontData.js';

/** Converts Tamil text typed in legacy fonts (Bamini, SunTommy — still common in DTP shops,
 *  old Word files and government forms) to Unicode, and back. Runs in the browser and Node.
 *
 *  Legacy fonts store each written syllable as a run of ASCII codes in *visual* order (e.g.
 *  the "ெ" sign is typed before the consonant), so conversion is a greedy longest-match over
 *  whole syllables rather than a per-character map. */

export const FONTS = { bamini: 'Bamini', suntommy: 'SunTommy' };

const compiled = {};
function tables(font) {
  if (!FONT_TABLES[font]) throw new Error(`Unknown font "${font}". Use: ${Object.keys(FONTS).join(', ')}`);
  if (!compiled[font]) {
    const toUni = new Map();
    const toFont = new Map();
    for (const [uni, code] of FONT_TABLES[font]) {
      if (!toUni.has(code)) toUni.set(code, uni);
      if (!toFont.has(uni)) toFont.set(uni, code); // first listed variant is the canonical one
    }
    compiled[font] = {
      toUni, toFont,
      maxCode: Math.max(...[...toUni.keys()].map((k) => k.length)),
      maxUni: Math.max(...[...toFont.keys()].map((k) => k.length)),
    };
  }
  return compiled[font];
}

function greedy(text, map, maxLen) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (let len = Math.min(maxLen, text.length - i); len > 0; len--) {
      const piece = text.slice(i, i + len);
      const hit = map.get(piece);
      if (hit !== undefined) { out += hit; i += len; matched = true; break; }
    }
    if (!matched) { out += text[i]; i++; }
  }
  return out;
}

export function legacyToUnicode(text, font = 'bamini') {
  const t = tables(font);
  return greedy(String(text), t.toUni, t.maxCode);
}

export function unicodeToLegacy(text, font = 'bamini') {
  const t = tables(font);
  // Normalise so decomposed vowel signs (ொ = ெ + ா) match the table's composed forms.
  return greedy(String(text).normalize('NFC'), t.toFont, t.maxUni);
}
