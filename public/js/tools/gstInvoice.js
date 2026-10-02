import { GST_STATES, validateGstin } from '../lib/gst.js';

/* GST invoice form. Builds the invoice JSON that /api/tool/gst-invoice renders to PDF.
 * Seller and bank details are remembered in this browser (localStorage) for the next invoice. */

const SAVE_KEY = 'gstInvoice.seller.v1';
let ctx;
let root;

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch { return {}; }
}
function save(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* private mode etc. */ }
}

export function mount(container, context) {
  ctx = context;
  root = container;
  const saved = loadSaved();
  const stateOpts = Object.entries(GST_STATES).map(([c, n]) => `<option value="${c}">${c} — ${n}</option>`).join('');
  const today = new Date().toISOString().slice(0, 10);
  container.innerHTML = `
    <div class="grid-2">
      <fieldset class="fieldset"><legend>Your business</legend>
        <div class="field"><label>Business name</label><input type="text" data-k="seller.name" value="${esc(saved.seller?.name)}"></div>
        <div class="field"><label>Address</label><textarea rows="2" data-k="seller.address">${esc(saved.seller?.address)}</textarea></div>
        <div class="field"><label>GSTIN <span class="gst-check" data-for="seller"></span></label><input type="text" data-k="seller.gstin" maxlength="15" value="${esc(saved.seller?.gstin)}" style="text-transform:uppercase"></div>
        <div class="field-row">
          <div class="field"><label>Phone</label><input type="text" data-k="seller.phone" value="${esc(saved.seller?.phone)}"></div>
          <div class="field"><label>Email</label><input type="text" data-k="seller.email" value="${esc(saved.seller?.email)}"></div>
        </div>
      </fieldset>
      <fieldset class="fieldset"><legend>Bill to</legend>
        <div class="field"><label>Customer name (Tamil is fine)</label><input type="text" data-k="buyer.name"></div>
        <div class="field"><label>Address</label><textarea rows="2" data-k="buyer.address"></textarea></div>
        <div class="field"><label>GSTIN (leave blank for unregistered customers) <span class="gst-check" data-for="buyer"></span></label><input type="text" data-k="buyer.gstin" maxlength="15" style="text-transform:uppercase"></div>
        <div class="field"><label>Place of supply</label><select data-k="placeOfSupply"><option value="">Same as your state</option>${stateOpts}</select></div>
      </fieldset>
    </div>
    <div class="field-row">
      <div class="field"><label>Invoice number</label><input type="text" data-k="invoiceNo" value="${esc(nextNumber(saved.lastInvoiceNo))}"></div>
      <div class="field"><label>Invoice date</label><input type="date" data-k="date" value="${today}"></div>
      <div class="field"><label>Due date (optional)</label><input type="date" data-k="dueDate"></div>
    </div>
    <fieldset class="fieldset"><legend>Items</legend>
      <table class="items-table">
        <thead><tr><th style="width:34%">Description</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate (₹)</th><th>Discount (₹)</th><th>GST %</th><th></th></tr></thead>
        <tbody id="giItems"></tbody>
      </table>
      <datalist id="gstRates"><option value="0"><option value="3"><option value="5"><option value="18"><option value="40"></datalist>
      <div><button class="secondary-btn" type="button" id="giAdd">+ Add item</button></div>
      <div class="totals" id="giTotals"></div>
    </fieldset>
    <div class="grid-2">
      <fieldset class="fieldset"><legend>Bank / UPI (optional)</legend>
        <div class="field-row">
          <div class="field"><label>Bank</label><input type="text" data-k="bank.name" value="${esc(saved.bank?.name)}"></div>
          <div class="field"><label>Account no.</label><input type="text" data-k="bank.account" value="${esc(saved.bank?.account)}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>IFSC</label><input type="text" data-k="bank.ifsc" value="${esc(saved.bank?.ifsc)}"></div>
          <div class="field"><label>UPI ID</label><input type="text" data-k="bank.upi" value="${esc(saved.bank?.upi)}"></div>
        </div>
      </fieldset>
      <fieldset class="fieldset"><legend>Notes</legend>
        <textarea rows="5" data-k="notes" placeholder="Payment terms, thank-you note…">${esc(saved.notes)}</textarea>
      </fieldset>
    </div>
    <div class="hint">Check GST rates and HSN codes with your accountant — rates were restructured in September 2025.</div>`;

  addItem();
  root.querySelector('#giAdd').addEventListener('click', () => addItem());
  root.addEventListener('input', () => { refresh(); ctx.updateSubmitState(); });
  refresh();
}

function nextNumber(last) {
  if (!last) return `INV-${new Date().getFullYear()}-001`;
  const m = String(last).match(/^(.*?)(\d+)$/);
  return m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') : last;
}

function addItem(item = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input data-i="description" value="${esc(item.description)}" placeholder="Item or service"></td>
    <td><input data-i="hsn" value="${esc(item.hsn)}"></td>
    <td><input data-i="qty" type="number" min="0" step="any" value="${esc(item.qty ?? 1)}"></td>
    <td><input data-i="unit" value="${esc(item.unit)}" placeholder="nos"></td>
    <td><input data-i="rate" type="number" min="0" step="any" value="${esc(item.rate)}"></td>
    <td><input data-i="discount" type="number" min="0" step="any" value="${esc(item.discount)}"></td>
    <td><input data-i="gstRate" type="number" min="0" step="any" list="gstRates" value="${esc(item.gstRate ?? 18)}"></td>
    <td class="rm" title="Remove">✕</td>`;
  tr.querySelector('.rm').addEventListener('click', () => {
    if (root.querySelectorAll('#giItems tr').length > 1) tr.remove();
    refresh();
    ctx.updateSubmitState();
  });
  root.querySelector('#giItems').appendChild(tr);
}

function collect() {
  const inv = {};
  root.querySelectorAll('[data-k]').forEach((el) => {
    const path = el.dataset.k.split('.');
    let o = inv;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]] ??= {};
    let v = el.value.trim();
    if (el.dataset.k.endsWith('gstin')) v = v.toUpperCase();
    o[path[path.length - 1]] = v;
  });
  inv.items = [...root.querySelectorAll('#giItems tr')].map((tr) => {
    const it = {};
    tr.querySelectorAll('[data-i]').forEach((el) => { it[el.dataset.i] = el.value.trim(); });
    return it;
  }).filter((it) => it.description);
  if (!inv.placeOfSupply) delete inv.placeOfSupply;
  return inv;
}

function refresh() {
  const inv = collect();
  for (const who of ['seller', 'buyer']) {
    const el = root.querySelector(`.gst-check[data-for="${who}"]`);
    const g = inv[who]?.gstin;
    if (!g) { el.textContent = ''; continue; }
    const v = validateGstin(g);
    el.className = `gst-check ${v.valid ? 'ok-text' : 'err-text'}`;
    el.textContent = v.valid ? `✓ ${GST_STATES[v.stateCode]}` : g.length < 15 ? '' : `✕ invalid (${v.reason})`;
  }
  let taxable = 0, tax = 0;
  for (const it of inv.items) {
    const t = (Number(it.qty) || 0) * (Number(it.rate) || 0) - (Number(it.discount) || 0);
    taxable += t;
    tax += (t * (Number(it.gstRate) || 0)) / 100;
  }
  const fmt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  root.querySelector('#giTotals').innerHTML = `Taxable ₹${fmt(taxable)} · GST ₹${fmt(tax)}<br><strong>Total ≈ ₹${fmt(Math.round(taxable + tax))}</strong>`;
}

export function isReady() {
  const inv = collect();
  return !!(inv.seller?.name && inv.items.length);
}

export function buildBody(body) {
  const inv = collect();
  save({ seller: inv.seller, bank: inv.bank, notes: inv.notes, lastInvoiceNo: inv.invoiceNo });
  body.set('options', JSON.stringify({ invoice: inv }));
}
