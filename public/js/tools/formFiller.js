import { esc } from '../state.js';

/** Custom tool: inspects a PDF's AcroForm fields (POST /api/form-fields) and renders real
 *  inputs for them before the user submits. Follows the organize tool's two-phase pattern
 *  (inspect via a dedicated endpoint, then submit values with the original file). */
let ctx = null;
let fields = [];
let values = {};
let container = null;

export function mount(host, c) {
  ctx = c;
  container = host;
  container.innerHTML = '<p class="muted">Upload a PDF to see its form fields.</p>';
}

export async function onFiles(files) {
  if (!files?.length) { container.innerHTML = '<p class="muted">Upload a PDF to see its form fields.</p>'; fields = []; ctx.updateSubmitState(); return; }
  container.innerHTML = '<p class="muted">Reading form fields…</p>';
  const fd = new FormData();
  fd.set('file', files[0]);
  try {
    const res = await fetch('/api/form-fields', { method: 'POST', credentials: 'same-origin', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not read this PDF.');
    fields = data.fields.filter((f) => f.type !== 'unsupported');
    values = Object.fromEntries(fields.map((f) => [f.name, f.value]));
    render();
  } catch (err) {
    container.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    fields = [];
  }
  ctx.updateSubmitState();
}

function render() {
  if (!fields.length) { container.innerHTML = '<p class="muted">This PDF has no fillable form fields.</p>'; return; }
  container.innerHTML = fields.map((f) => {
    const id = `ff_${f.name}`;
    if (f.type === 'checkbox') {
      return `<div class="field check"><input type="checkbox" id="${id}" data-field="${esc(f.name)}" ${values[f.name] ? 'checked' : ''}><label for="${id}">${esc(f.name)}</label></div>`;
    }
    if (f.type === 'select' || f.type === 'radio') {
      const opts = (f.options || []).map((o) => `<option value="${esc(o)}" ${String(o) === String(values[f.name]) ? 'selected' : ''}>${esc(o)}</option>`).join('');
      return `<div class="field"><label for="${id}">${esc(f.name)}</label><select id="${id}" data-field="${esc(f.name)}">${opts}</select></div>`;
    }
    return `<div class="field"><label for="${id}">${esc(f.name)}</label><input id="${id}" type="text" data-field="${esc(f.name)}" value="${esc(values[f.name] ?? '')}"></div>`;
  }).join('');
  container.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      values[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
    });
  });
}

export function isReady() {
  return fields.length > 0;
}

export function buildBody(fd) {
  fd.set('options', JSON.stringify({ values, flatten: true }));
}
