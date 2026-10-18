import { TOOLS, toolById, suiteById } from '../catalog.js';
import { state, esc, fmtSize, refreshMe } from '../state.js';
import { submitJob, waitForJob, ApiError } from '../api.js';
import { openUpgrade, openAuth, toast } from '../app.js';
import * as examPhoto from '../tools/examPhoto.js';
import * as tamilFont from '../tools/tamilFont.js';
import * as gstInvoice from '../tools/gstInvoice.js';

const CUSTOM = { 'exam-photo': examPhoto, 'tamil-font': tamilFont, 'gst-invoice': gstInvoice };

let stashed = null;            // files dropped on the home page, handed to the next tool
let current = null;            // { tool, files, form, abort, organize, custom }

export function stashFiles(files) { stashed = files; }
export function leaveTool() { current?.abort?.abort(); current = null; }

export function renderTool(main, id) {
  const tool = toolById(id);
  if (!tool) { main.innerHTML = '<div class="page-head"><h1>Tool not found</h1><p><a href="#/">See all tools</a></p></div>'; return 'Not found'; }
  const suite = suiteById(tool.suite);
  main.dataset.suite = tool.suite;
  current = { tool, files: [], form: {}, abort: new AbortController(), organize: null, custom: CUSTOM[tool.custom] || null };

  main.innerHTML = `
    <div class="page-head">
      <div class="crumbs"><a href="#/">All tools</a> / <a href="#/suite/${suite.id}">${esc(suite.name)}</a></div>
      <div class="tool-title"><h1>${esc(tool.name)}</h1><span class="stamp">${esc(tool.formats)}</span></div>
      <p>${esc(tool.desc)}</p>
    </div>
    <div class="tool-layout">
      <section class="workbench" aria-label="${esc(tool.name)}">
        ${tool.noUpload ? '' : `
        <div class="dropzone" id="dz" role="button" tabindex="0" aria-label="Choose files">
          <strong>${tool.multiple ? 'Drop files here or click to choose' : 'Drop a file here or click to choose'}</strong>
          <span>${esc(acceptLabel(tool))}</span>
          <input type="file" id="fileInput" hidden ${tool.multiple ? 'multiple' : ''} accept="${esc(tool.accept || '')}">
        </div>
        <ul class="files" id="fileList"></ul>`}
        <div id="organize" class="thumbs hidden"></div>
        <div id="custom" class="custom ${current.custom ? '' : 'hidden'}"></div>
        <div id="fields" class="fields"></div>
        <div class="actions">
          ${tool.noSubmit ? '' : `<button class="btn btn-primary" id="go" type="button" disabled>${esc(tool.submitLabel || actionLabel(tool))}</button>`}
          ${tool.browserOnly ? '<span class="privacy-note">Runs on your device — nothing is uploaded.</span>' : ''}
        </div>
        <div class="progress hidden" id="progress"><div class="progress-track"><div class="progress-fill" id="bar"></div></div><div class="status" id="status" role="status"></div></div>
        <div id="result"></div>
      </section>
      <aside class="side">
        ${tool.browserOnly ? '' : planBlock()}
        <div class="side-block"><h3>More in ${esc(suite.name)}</h3><ul>
          ${TOOLS.filter((t) => t.suite === tool.suite && t.id !== tool.id).map((t) => `<li><a href="#/tool/${t.id}">${esc(t.name)}</a></li>`).join('')}
        </ul></div>
      </aside>
    </div>`;

  wireUpload(main);
  renderFields(main);
  if (current.custom) {
    current.custom.mount(main.querySelector('#custom'), {
      setStatus: (text, kind) => setStatus(main, text, kind),
      showDownload: (blob, name, extra) => showLocalDownload(main, blob, name, extra),
      updateSubmitState: () => updateGo(main),
      getFiles: () => current?.files || [],
    });
  }
  if (stashed && !tool.noUpload) { addFiles(main, stashed); }
  stashed = null;
  main.querySelector('#go')?.addEventListener('click', () => run(main));
  updateGo(main);
  return tool.name;
}

const actionLabel = (t) => ({ merge: 'Merge PDFs', split: 'Split PDF', compress: 'Compress PDF', organize: 'Save new order' }[t.id] || `${t.name.split(' ')[0]} now`);

function acceptLabel(t) {
  const lim = state.me?.limits;
  const types = (t.accept || '').replace(/image\/\*/g, 'images').replace(/\./g, '').toUpperCase().replace(/,/g, ', ');
  return `${types}${lim ? ` · up to ${lim.maxFileMB} MB each` : ''}`;
}

function planBlock() {
  const me = state.me;
  if (!me) return '';
  const pct = Math.min(100, (me.usage.today / me.limits.tasksPerDay) * 100);
  const paid = me.tier === 'pro' || me.tier === 'daypass';
  return `<div class="side-block" id="planBlock"><h3>${esc(me.limits.label)} plan</h3>
    <div class="limits">
      <span><b>${me.usage.remaining}</b> of ${me.limits.tasksPerDay} tasks left today</span>
      <div class="meter ${me.usage.remaining <= 2 ? 'low' : ''}" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <span>Files up to <b>${me.limits.maxFileMB} MB</b>, <b>${me.limits.maxFiles}</b> at a time</span>
    </div>
    ${paid ? '' : `<p class="small" style="margin-top:12px"><a href="#/pricing">Get more with a Day Pass or Pro</a></p>`}
  </div>`;
}

/* ---------------- Files ---------------- */
function wireUpload(main) {
  const dz = main.querySelector('#dz');
  if (!dz) return;
  const input = main.querySelector('#fileInput');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { addFiles(main, [...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragging'); }));
  dz.addEventListener('drop', (e) => addFiles(main, [...e.dataTransfer.files]));
}

function addFiles(main, files) {
  const { tool } = current;
  current.files = tool.multiple ? [...current.files, ...files] : files.slice(0, 1);
  clearResult(main);
  renderFileList(main);
  current.custom?.onFiles?.(current.files);
  if (tool.custom === 'organize' && current.files.length) loadThumbnails(main);
  updateGo(main);
}

function renderFileList(main) {
  const list = main.querySelector('#fileList');
  if (!list) return;
  const maxMB = state.me?.limits?.maxFileMB || Infinity;
  list.innerHTML = current.files.map((f, i) => `
    <li ${current.tool.multiple ? 'draggable="true"' : ''} data-i="${i}">
      <span class="fname">${esc(f.name)}</span>
      <span class="fsize ${f.size > maxMB * 1048576 ? 'over' : ''}">${fmtSize(f.size)}${f.size > maxMB * 1048576 ? ' — over your plan limit' : ''}</span>
      <button type="button" aria-label="Remove ${esc(f.name)}">×</button>
    </li>`).join('');
  list.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => {
    current.files.splice(Number(e.target.closest('li').dataset.i), 1);
    renderFileList(main);
    current.custom?.onFiles?.(current.files);
    updateGo(main);
  }));
  // Drag to reorder (order matters for merge / images to PDF).
  let from = null;
  list.querySelectorAll('li[draggable]').forEach((li) => {
    li.addEventListener('dragstart', () => { from = Number(li.dataset.i); });
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      const to = Number(li.dataset.i);
      if (from === null || from === to) return;
      const [moved] = current.files.splice(from, 1);
      current.files.splice(to, 0, moved);
      renderFileList(main);
    });
  });
}

/* ---------------- Options ---------------- */
function renderFields(main) {
  const { tool } = current;
  const host = main.querySelector('#fields');
  if (!tool.fields) { host.classList.add('hidden'); return; }
  for (const f of tool.fields) if (current.form[f.name] === undefined) current.form[f.name] = f.default ?? '';
  const visible = (f) => !f.showIf || Object.entries(f.showIf).every(([k, v]) => String(current.form[k]) === String(v));
  host.innerHTML = tool.fields.filter(visible).map((f) => {
    const id = `f_${f.name}`;
    const val = esc(current.form[f.name]);
    if (f.type === 'checkbox') return `<div class="field check"><input type="checkbox" id="${id}" data-name="${f.name}" ${current.form[f.name] === true || current.form[f.name] === 'true' ? 'checked' : ''}><label for="${id}">${esc(f.label)}</label></div>`;
    let control;
    if (f.type === 'select') control = `<select id="${id}" data-name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(current.form[f.name]) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') control = `<textarea id="${id}" data-name="${f.name}" rows="4" placeholder="${esc(f.placeholder || '')}">${val}</textarea>`;
    else control = `<input id="${id}" data-name="${f.name}" type="${f.type}" value="${val}" placeholder="${esc(f.placeholder || '')}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step !== undefined ? `step="${f.step}"` : ''}>`;
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>${control}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
  }).join('');
  host.querySelectorAll('[data-name]').forEach((el) => {
    const name = el.dataset.name;
    const rerender = tool.fields.some((x) => x.showIf && name in x.showIf);
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      current.form[name] = el.type === 'checkbox' ? el.checked : el.value;
      if (rerender) renderFields(main);
      updateGo(main);
    });
  });
}

function updateGo(main) {
  const go = main.querySelector('#go');
  if (!go || !current) return;
  const { tool } = current;
  let ok = tool.noUpload || current.files.length >= (tool.minFiles || 1);
  for (const f of tool.fields || []) {
    const shown = !f.showIf || Object.entries(f.showIf).every(([k, v]) => String(current.form[k]) === String(v));
    if (shown && f.required && !String(current.form[f.name] ?? '').trim()) ok = false;
  }
  if (tool.custom === 'organize') ok = !!current.organize?.order?.length;
  if (current.custom?.isReady) ok = ok && current.custom.isReady();
  go.disabled = !ok || current.running;
}

/* ---------------- Organize (thumbnails) ---------------- */
async function loadThumbnails(main) {
  const box = main.querySelector('#organize');
  box.classList.remove('hidden');
  box.innerHTML = '';
  showProgress(main, 'Reading pages…', true);
  const body = new FormData();
  body.set('file', current.files[0]);
  try {
    const res = await fetch('/api/thumbnails', { method: 'POST', body, credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error, res.status, data.code);
    current.organize = { thumbs: data.thumbs, order: data.thumbs.map((t) => t.page) };
    drawThumbs(main);
    setStatus(main, 'Drag pages to reorder. Remove pages with ×.', '');
    main.querySelector('#bar').classList.remove('indeterminate');
  } catch (err) {
    handleError(main, err);
  }
  updateGo(main);
}
function drawThumbs(main) {
  const box = main.querySelector('#organize');
  const { thumbs, order } = current.organize;
  box.innerHTML = order.map((p, i) => `<div class="thumb" draggable="true" data-i="${i}"><img src="${thumbs.find((t) => t.page === p).dataUrl}" alt="Page ${p}"><div class="meta"><span>Page ${p}</span><button type="button" aria-label="Remove page ${p}">×</button></div></div>`).join('');
  let from = null;
  box.querySelectorAll('.thumb').forEach((el) => {
    el.addEventListener('dragstart', () => { from = Number(el.dataset.i); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const [m] = order.splice(from, 1);
      order.splice(Number(el.dataset.i), 0, m);
      drawThumbs(main);
    });
    el.querySelector('button').addEventListener('click', () => { order.splice(Number(el.dataset.i), 1); drawThumbs(main); updateGo(main); });
  });
}

/* ---------------- Run ---------------- */
function buildOptions() {
  const { tool, form } = current;
  if (tool.custom === 'organize') return { order: current.organize.order };
  if (tool.buildOptions) return tool.buildOptions(form);
  const out = {};
  for (const f of tool.fields || []) {
    const shown = !f.showIf || Object.entries(f.showIf).every(([k, v]) => String(form[k]) === String(v));
    if (shown && form[f.name] !== '' && form[f.name] !== undefined) out[f.name] = form[f.name];
  }
  return out;
}

async function run(main) {
  const { tool } = current;
  if (current.custom?.submit) { await current.custom.submit(); return; }
  const go = main.querySelector('#go');
  current.running = true;
  go.disabled = true;
  clearResult(main);
  const fd = new FormData();
  fd.set('tool', tool.id);
  if (current.custom?.buildBody) current.custom.buildBody(fd);
  else fd.set('options', JSON.stringify(buildOptions()));
  for (const f of current.files) fd.append('files', f);
  const inputBytes = current.files.reduce((s, f) => s + f.size, 0);
  const abort = current.abort;

  try {
    showProgress(main, current.files.length ? 'Uploading…' : 'Sending…', false);
    const { id } = await submitJob(fd, (p) => {
      main.querySelector('#bar').style.width = `${Math.round(p * 100)}%`;
      setStatus(main, p < 1 ? `Uploading… ${Math.round(p * 100)}%` : 'Uploaded. Waiting for a free worker…');
    });
    main.querySelector('#bar').classList.add('indeterminate');
    const job = await waitForJob(id, (j) => {
      if (j.status === 'queued') setStatus(main, 'In the queue…');
      if (j.status === 'processing') setStatus(main, slowHint(tool));
    }, { signal: abort.signal });
    if (current?.abort !== abort) return; // user navigated away
    if (job.status !== 'completed') throw new ApiError(job.error || 'This task failed.', 400);
    hideProgress(main);
    showResult(main, job, inputBytes);
  } catch (err) {
    if (err.code === 'cancelled') return;
    handleError(main, err);
  } finally {
    if (current?.abort === abort) { current.running = false; updateGo(main); }
    await refreshMe();
    const block = main.querySelector('#planBlock');
    if (block && current?.abort === abort) block.outerHTML = planBlock();
  }
}

const slowHint = (tool) => (['ocr', 'office-to-pdf', 'pdf-to-word', 'pdf-to-powerpoint', 'remove-background'].includes(tool.id)
  ? 'Working on it — this tool can take up to a minute for large files…'
  : 'Working on it…');

function showResult(main, job, inputBytes) {
  const out = job.files.reduce((s, f) => s + f.size, 0);
  const saved = current.tool.id === 'compress' && inputBytes > 0 && out < inputBytes
    ? `<p class="meta">${fmtSize(inputBytes)} → ${fmtSize(out)} · ${Math.round((1 - out / inputBytes) * 100)}% smaller</p>` : '';
  main.querySelector('#result').innerHTML = `
    <div class="result">
      <h3>${job.files.length > 1 ? `${job.files.length} files ready` : 'Your file is ready'}</h3>
      ${saved}
      <ul>${job.files.map((f) => `<li><a class="btn btn-primary btn-sm" href="${f.url}" download>Download ${esc(f.name)}</a><span class="meta">${fmtSize(f.size)}</span></li>`).join('')}</ul>
      <p class="meta small">Files are deleted from our servers within an hour.</p>
    </div>`;
  main.querySelector('#result a')?.focus();
}

function showLocalDownload(main, blob, name, extra) {
  const url = URL.createObjectURL(blob);
  main.querySelector('#result').innerHTML = `<div class="result"><h3>Ready</h3><ul><li><a class="btn btn-primary btn-sm" href="${url}" download="${esc(name)}">Download ${esc(name)}</a>${extra ? `<span class="meta">${esc(extra)}</span>` : ''}</li></ul></div>`;
}

function handleError(main, err) {
  hideProgress(main, true);
  if (err.status === 402) {
    setStatus(main, err.message, 'error');
    openUpgrade(err.message);
  } else if (err.code === 'auth_required') {
    openAuth('login', { reason: err.message });
  } else if (err.status === 429) {
    setStatus(main, 'You’re going a little fast. Wait a minute and try again.', 'error');
  } else {
    setStatus(main, err.message || 'Something went wrong. Please try again.', 'error');
  }
}

function showProgress(main, text, indeterminate) {
  main.querySelector('#progress').classList.remove('hidden');
  const bar = main.querySelector('#bar');
  bar.style.width = indeterminate ? '' : '0%';
  bar.classList.toggle('indeterminate', !!indeterminate);
  setStatus(main, text);
}
function hideProgress(main, keepStatus) {
  const p = main.querySelector('#progress');
  main.querySelector('#bar').classList.remove('indeterminate');
  if (keepStatus) { p.querySelector('.progress-track').classList.add('hidden'); return; }
  p.classList.add('hidden');
}
function setStatus(main, text, kind = '') {
  const st = main.querySelector('#status');
  if (!st) return;
  main.querySelector('#progress').classList.remove('hidden');
  if (!text) { main.querySelector('#progress').classList.add('hidden'); return; }
  st.className = `status ${kind}`.trim();
  st.textContent = text;
  if (kind) main.querySelector('.progress-track').classList.add('hidden');
  else main.querySelector('.progress-track').classList.remove('hidden');
  if (kind === 'ok') toast(text);
}
function clearResult(main) {
  main.querySelector('#result').innerHTML = '';
}
