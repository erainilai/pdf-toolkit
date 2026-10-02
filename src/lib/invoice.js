import { PDFDocument, rgb } from 'pdf-lib';
import { embedFonts, textWidth, drawText } from './fonts.js';
import { GST_STATES, validateGstin } from '../../public/js/lib/gst.js';

export { GST_STATES, validateGstin };

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigits(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`; }
function threeDigits(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}
/** Indian numbering: 1,23,45,678 → "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight". */
export function amountInWords(amount) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const parts = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  let words = `Rupees ${parts.join(' ') || 'Zero'}`;
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return `${words} Only`;
}

/** State code from a GSTIN's first two digits — usable even when the check digit is wrong. */
function stateOf(gstin) {
  const code = String(gstin || '').trim().slice(0, 2);
  return GST_STATES[code] ? code : undefined;
}

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const inr = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Computes line and tax totals. Intra-state supply → CGST + SGST (half each); inter-state → IGST. */
export function computeInvoice(inv) {
  const sellerState = stateOf(inv.seller?.gstin) || inv.seller?.stateCode;
  const pos = String(inv.placeOfSupply || stateOf(inv.buyer?.gstin) || inv.buyer?.stateCode || sellerState || '').padStart(2, '0');
  const intra = !!sellerState && sellerState === pos;
  const items = (inv.items || []).map((it, i) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const discount = Number(it.discount) || 0;
    const taxable = r2(qty * rate - discount);
    const gstRate = Number(it.gstRate) || 0;
    const tax = r2((taxable * gstRate) / 100);
    if (!it.description) throw new Error(`Item ${i + 1}: description is required.`);
    return { ...it, qty, rate, discount, taxable, gstRate, tax, total: r2(taxable + tax) };
  });
  if (!items.length) throw new Error('Add at least one item.');
  const byRate = {};
  for (const it of items) {
    const k = it.gstRate;
    byRate[k] ??= { rate: k, taxable: 0, tax: 0 };
    byRate[k].taxable = r2(byRate[k].taxable + it.taxable);
    byRate[k].tax = r2(byRate[k].tax + it.tax);
  }
  const taxable = r2(items.reduce((s, i) => s + i.taxable, 0));
  const tax = r2(items.reduce((s, i) => s + i.tax, 0));
  const exact = r2(taxable + tax);
  const roundOff = inv.roundOff === false ? 0 : r2(Math.round(exact) - exact);
  const total = r2(exact + roundOff);
  return {
    items, intra, placeOfSupply: pos, sellerState,
    summary: Object.values(byRate).sort((a, b) => a.rate - b.rate),
    taxable, tax, cgst: intra ? r2(tax / 2) : 0, sgst: intra ? r2(tax - r2(tax / 2)) : 0, igst: intra ? 0 : tax,
    roundOff, total, words: amountInWords(total),
  };
}

/* ---------------- PDF rendering ---------------- */

const A4 = [595.28, 841.89];
const M = 36;
const GREY = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.75, 0.75, 0.75);
const DARK = rgb(0.1, 0.1, 0.1);
const ACCENT = rgb(0.12, 0.3, 0.55);

function wrap(face, text, size, maxW) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (textWidth(face, test, size) <= maxW || !line) line = test;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderInvoice(inv) {
  const calc = computeInvoice(inv);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${inv.invoiceNo || ''}`.trim());
  const { regular: R, bold: B } = await embedFonts(pdf);
  let page = pdf.addPage(A4);
  const W = A4[0] - 2 * M;
  let y = A4[1] - M;

  const text = (t, x, yy, size = 9, face = R, color = DARK) => drawText(page, face, String(t ?? ''), { x, y: yy, size, color });
  const right = (t, xRight, yy, size = 9, face = R, color = DARK) => text(t, xRight - textWidth(face, String(t ?? ''), size), yy, size, face, color);
  const hline = (yy, x1 = M, x2 = M + W, c = LINE) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.6, color: c });

  // Header
  text(inv.title || 'TAX INVOICE', M, y - 14, 16, B, ACCENT);
  right(`Invoice No: ${inv.invoiceNo || '-'}`, M + W, y - 6, 9, B);
  right(`Date: ${inv.date || new Date().toISOString().slice(0, 10)}`, M + W, y - 18);
  if (inv.dueDate) right(`Due: ${inv.dueDate}`, M + W, y - 30);
  y -= 44;
  hline(y, M, M + W, ACCENT);
  y -= 16;

  // Seller / buyer blocks
  const colW = W / 2 - 10;
  const block = (title, p, x) => {
    let yy = y;
    text(title, x, yy, 8, B, GREY); yy -= 13;
    text(p?.name || '', x, yy, 10.5, B); yy -= 13;
    for (const l of wrap(R, p?.address || '', 9, colW)) { text(l, x, yy); yy -= 11.5; }
    const v = p?.gstin ? validateGstin(p.gstin) : null;
    if (p?.gstin) { text(`GSTIN: ${String(p.gstin).toUpperCase()}${v.valid ? '' : '  (check GSTIN)'}`, x, yy, 9, B, v.valid ? DARK : rgb(0.7, 0.1, 0.1)); yy -= 11.5; }
    const st = stateOf(p?.gstin) || p?.stateCode;
    if (st && GST_STATES[st]) { text(`State: ${GST_STATES[st]} (${st})`, x, yy); yy -= 11.5; }
    if (p?.phone) { text(`Phone: ${p.phone}`, x, yy); yy -= 11.5; }
    if (p?.email) { text(`Email: ${p.email}`, x, yy); yy -= 11.5; }
    return yy;
  };
  const y1 = block('FROM', inv.seller, M);
  const y2 = block('BILL TO', inv.buyer, M + W / 2 + 10);
  y = Math.min(y1, y2) - 6;
  text(`Place of supply: ${GST_STATES[calc.placeOfSupply] || '-'} (${calc.placeOfSupply})${calc.intra ? '' : '  •  Inter-state (IGST)'}`, M, y, 9, R, GREY);
  y -= 16;

  // Items table
  const cols = [
    { k: '#', w: 22, a: 'l' }, { k: 'Description', w: 0, a: 'l' }, { k: 'HSN/SAC', w: 52, a: 'l' },
    { k: 'Qty', w: 40, a: 'r' }, { k: 'Rate', w: 58, a: 'r' }, { k: 'Taxable', w: 66, a: 'r' },
    { k: 'GST', w: 34, a: 'r' }, { k: 'Amount', w: 70, a: 'r' },
  ];
  cols[1].w = W - cols.reduce((s, c) => s + c.w, 0);
  const xs = []; { let x = M; for (const c of cols) { xs.push(x); x += c.w; } }
  const cell = (c, i, v, yy, face = R) => (c.a === 'r' ? right(v, xs[i] + c.w - 4, yy, 8.5, face) : text(v, xs[i] + 4, yy, 8.5, face));
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W, height: 18, color: rgb(0.93, 0.95, 0.98) });
    cols.forEach((c, i) => cell(c, i, c.k, y, B));
    y -= 18;
  };
  header();
  calc.items.forEach((it, n) => {
    const desc = wrap(R, it.description, 8.5, cols[1].w - 8);
    const h = desc.length * 11 + 6;
    if (y - h < M + 170) { page = pdf.addPage(A4); y = A4[1] - M; header(); }
    const vals = [n + 1, null, it.hsn || '', `${it.qty}${it.unit ? ` ${it.unit}` : ''}`, inr(it.rate), inr(it.taxable), `${it.gstRate}%`, inr(it.total)];
    cols.forEach((c, i) => { if (i !== 1) cell(c, i, vals[i], y); });
    desc.forEach((l, k) => text(l, xs[1] + 4, y - k * 11, 8.5));
    y -= h; hline(y + 8);
  });

  // Tax summary (left) and totals (right)
  y -= 8;
  const top = y;
  text('Tax summary', M, y, 8, B, GREY); y -= 13;
  const tCols = calc.intra ? ['Rate', 'Taxable', 'CGST', 'SGST'] : ['Rate', 'Taxable', 'IGST'];
  tCols.forEach((h, i) => right(h, M + 50 + i * 70, y, 8, B)); y -= 12;
  for (const s of calc.summary) {
    const vals = calc.intra ? [`${s.rate}%`, inr(s.taxable), inr(r2(s.tax / 2)), inr(r2(s.tax - r2(s.tax / 2)))] : [`${s.rate}%`, inr(s.taxable), inr(s.tax)];
    vals.forEach((v, i) => right(v, M + 50 + i * 70, y, 8)); y -= 11;
  }
  const leftBottom = y;

  y = top;
  const tx = M + W - 210;
  const row = (label, value, face = R, size = 9) => { text(label, tx, y, size, face); right(value, M + W, y, size, face); y -= 14; };
  row('Taxable value', inr(calc.taxable));
  if (calc.intra) { row('CGST', inr(calc.cgst)); row('SGST', inr(calc.sgst)); } else row('IGST', inr(calc.igst));
  if (calc.roundOff) row('Round off', inr(calc.roundOff));
  hline(y + 12, tx, M + W, DARK);
  row('Total', `₹ ${inr(calc.total)}`, B, 11);

  y = Math.min(y, leftBottom) - 8;
  for (const l of wrap(R, calc.words, 9, W)) { text(l, M, y, 9, B); y -= 12; }
  y -= 6;

  // Bank, notes, signature
  const footTop = y;
  if (inv.bank && (inv.bank.account || inv.bank.upi)) {
    text('Bank details', M, y, 8, B, GREY); y -= 12;
    for (const [k, v] of [['Bank', inv.bank.name], ['A/c No', inv.bank.account], ['IFSC', inv.bank.ifsc], ['UPI', inv.bank.upi]]) {
      if (v) { text(`${k}: ${v}`, M, y, 8.5); y -= 11; }
    }
  }
  if (inv.notes) {
    y -= 4; text('Notes', M, y, 8, B, GREY); y -= 12;
    for (const l of wrap(R, inv.notes, 8.5, W / 2)) { text(l, M, y, 8.5); y -= 11; }
  }
  const sy = Math.max(M + 10, footTop - 50);
  right(`For ${inv.seller?.name || ''}`, M + W, footTop, 9, B);
  right('Authorised signatory', M + W, sy, 8.5, R, GREY);
  hline(sy + 12, M + W - 140, M + W, GREY);

  return pdf.save();
}
