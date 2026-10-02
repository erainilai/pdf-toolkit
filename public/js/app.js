const TOOLS = [
  {
    id: 'merge', icon: '🔗', name: 'Merge PDF', desc: 'Combine multiple PDFs into one file, in the order you add them.',
    accept: '.pdf', multiple: true, minFiles: 2, endpoint: '/api/merge', fileField: 'files',
  },
  {
    id: 'split', icon: '✂️', name: 'Split PDF', desc: 'Split by page ranges, or every N pages.',
    accept: '.pdf', multiple: false, endpoint: '/api/split', fileField: 'file',
    fields: [
      { name: 'mode', label: 'Split by', type: 'select', options: [['ranges', 'Custom ranges'], ['everyN', 'Every N pages']], default: 'ranges' },
      { name: 'ranges', label: 'Ranges (one output file per line, e.g. 1-3)', type: 'textarea', showIf: { mode: 'ranges' }, placeholder: '1-3\n4-6\n7-10' },
      { name: 'everyN', label: 'N pages per file', type: 'number', showIf: { mode: 'everyN' }, default: 1, min: 1 },
    ],
    buildBody(form, body) {
      if (form.mode === 'ranges') {
        const lines = (form.ranges || '').split('\n').map((s) => s.trim()).filter(Boolean);
        body.set('ranges', JSON.stringify(lines));
      } else {
        body.set('everyN', form.everyN || '1');
      }
    },
  },
  {
    id: 'remove-pages', icon: '🗑️', name: 'Remove Pages', desc: 'Delete specific pages from a PDF.',
    accept: '.pdf', multiple: false, endpoint: '/api/remove-pages', fileField: 'file',
    fields: [{ name: 'pages', label: 'Pages to remove (e.g. 2,4-6)', type: 'text', placeholder: '2,4-6', required: true }],
  },
  {
    id: 'extract-pages', icon: '📑', name: 'Extract Pages', desc: 'Pull selected pages out into a new PDF.',
    accept: '.pdf', multiple: false, endpoint: '/api/extract-pages', fileField: 'file',
    fields: [{ name: 'pages', label: 'Pages to keep (e.g. 1-3,7)', type: 'text', placeholder: '1-3,7', required: true }],
  },
  {
    id: 'rotate', icon: '🔄', name: 'Rotate PDF', desc: 'Rotate all or specific pages by 90/180/270°.',
    accept: '.pdf', multiple: false, endpoint: '/api/rotate', fileField: 'file',
    fields: [
      { name: 'angle', label: 'Rotate by', type: 'select', options: [['90', '90° clockwise'], ['180', '180°'], ['270', '270° clockwise']], default: '90' },
      { name: 'pages', label: 'Pages (blank or "all" = every page)', type: 'text', placeholder: 'all', default: 'all' },
    ],
  },
  {
    id: 'organize', icon: '🧩', name: 'Organize Pages', desc: 'Reorder or delete pages visually by dragging thumbnails.',
    accept: '.pdf', multiple: false, endpoint: '/api/organize', fileField: 'file', custom: 'organize',
  },
  {
    id: 'watermark', icon: '💧', name: 'Watermark', desc: 'Stamp text diagonally across every page.',
    accept: '.pdf', multiple: false, endpoint: '/api/watermark', fileField: 'file',
    fields: [
      { name: 'text', label: 'Watermark text', type: 'text', required: true, placeholder: 'CONFIDENTIAL' },
      { name: 'position', label: 'Position', type: 'select', options: [['center', 'Center'], ['top', 'Top'], ['bottom', 'Bottom'], ['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']], default: 'center' },
      { name: 'color', label: 'Color', type: 'color', default: '#ff0000' },
      { name: 'opacity', label: 'Opacity (0-1)', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
      { name: 'rotation', label: 'Rotation (degrees)', type: 'number', default: -45, min: -180, max: 180 },
      { name: 'fontSize', label: 'Font size', type: 'number', default: 48, min: 6, max: 200 },
    ],
  },
  {
    id: 'page-numbers', icon: '🔢', name: 'Page Numbers', desc: 'Add page numbers to every page.',
    accept: '.pdf', multiple: false, endpoint: '/api/page-numbers', fileField: 'file',
    fields: [
      { name: 'position', label: 'Position', type: 'select', options: [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['bottom', 'Bottom center'], ['top-right', 'Top right'], ['top-left', 'Top left'], ['top', 'Top center']], default: 'bottom-right' },
      { name: 'startAt', label: 'Start at', type: 'number', default: 1, min: 1 },
      { name: 'format', label: 'Format ({n} and {total} placeholders)', type: 'text', default: '{n} / {total}' },
    ],
  },
  {
    id: 'images-to-pdf', icon: '🖼️', name: 'Images to PDF', desc: 'Combine JPG/PNG images into a single PDF.',
    accept: '.jpg,.jpeg,.png', multiple: true, minFiles: 1, endpoint: '/api/images-to-pdf', fileField: 'files',
    fields: [{ name: 'pageSize', label: 'Page size', type: 'select', options: [['fit', 'Fit to image'], ['a4', 'A4']], default: 'fit' }],
  },
  {
    id: 'pdf-to-images', icon: '🖨️', name: 'PDF to Images', desc: 'Export each page as a PNG or JPG image.',
    accept: '.pdf', multiple: false, endpoint: '/api/pdf-to-images', fileField: 'file',
    fields: [
      { name: 'format', label: 'Format', type: 'select', options: [['png', 'PNG'], ['jpg', 'JPG']], default: 'png' },
      { name: 'scale', label: 'Scale (quality)', type: 'number', default: 2, min: 1, max: 5, step: 0.5 },
    ],
  },
  {
    id: 'pdf-to-text', icon: '📝', name: 'PDF to Text', desc: 'Extract all text content from a PDF.',
    accept: '.pdf', multiple: false, endpoint: '/api/pdf-to-text', fileField: 'file',
  },
  {
    id: 'compress', icon: '🗜️', name: 'Compress PDF', desc: 'Shrink file size. Stronger compression if Ghostscript is installed.',
    accept: '.pdf', multiple: false, endpoint: '/api/compress', fileField: 'file',
    fields: [{ name: 'quality', label: 'Quality (used if Ghostscript is installed)', type: 'select', options: [['screen', 'Smallest (screen)'], ['ebook', 'Balanced (ebook)'], ['printer', 'High quality (printer)']], default: 'ebook' }],
  },
  {
    id: 'protect', icon: '🔒', name: 'Protect PDF', desc: 'Add a password to encrypt a PDF. Requires qpdf installed.',
    accept: '.pdf', multiple: false, endpoint: '/api/protect', fileField: 'file',
    fields: [{ name: 'password', label: 'Password', type: 'password', required: true }],
  },
  {
    id: 'unlock', icon: '🔓', name: 'Unlock PDF', desc: 'Remove a known password from a PDF. Requires qpdf installed.',
    accept: '.pdf', multiple: false, endpoint: '/api/unlock', fileField: 'file',
    fields: [{ name: 'password', label: 'Current password', type: 'password', required: true }],
  },
];

const homeView = document.getElementById('homeView');
const toolView = document.getElementById('toolView');
const toolGrid = document.getElementById('toolGrid');
const sysNote = document.getElementById('sysNote');
const backBtn = document.getElementById('backBtn');
const homeLink = document.getElementById('homeLink');

const toolTitle = document.getElementById('toolTitle');
const toolDesc = document.getElementById('toolDesc');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileListEl = document.getElementById('fileList');
const optionsArea = document.getElementById('optionsArea');
const organizeArea = document.getElementById('organizeArea');
const submitBtn = document.getElementById('submitBtn');
const statusArea = document.getElementById('statusArea');
const resultArea = document.getElementById('resultArea');

let currentTool = null;
let selectedFiles = [];
let organizeState = null; // { thumbs: [{page, dataUrl}], order: [page,...] }

function renderGrid() {
  toolGrid.innerHTML = '';
  for (const tool of TOOLS) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `<span class="icon">${tool.icon}</span><div class="name">${tool.name}</div><div class="desc">${tool.desc}</div>`;
    card.addEventListener('click', () => openTool(tool));
    toolGrid.appendChild(card);
  }
}

async function loadSystemInfo() {
  try {
    const res = await fetch('/api/system-info');
    const info = await res.json();
    const warnings = [];
    if (!info.qpdf) warnings.push(info.notes.qpdf);
    if (!info.ghostscript) warnings.push(info.notes.ghostscript);
    sysNote.innerHTML = warnings.length
      ? `<span class="warn">Optional tools missing:</span> ${warnings.join(' ')}`
      : 'All optional tools detected — every feature is fully enabled.';
  } catch {
    sysNote.textContent = '';
  }
}

function openTool(tool) {
  currentTool = tool;
  selectedFiles = [];
  organizeState = null;
  homeView.classList.add('hidden');
  toolView.classList.remove('hidden');
  toolTitle.textContent = `${tool.icon} ${tool.name}`;
  toolDesc.textContent = tool.desc;
  fileInput.value = '';
  fileInput.accept = tool.accept;
  fileInput.multiple = !!tool.multiple;
  fileListEl.innerHTML = '';
  statusArea.textContent = '';
  statusArea.className = 'status-area';
  resultArea.innerHTML = '';
  dropzone.classList.remove('hidden');
  organizeArea.classList.add('hidden');
  organizeArea.innerHTML = '';
  renderOptions();
  updateSubmitState();
}

function goHome() {
  toolView.classList.add('hidden');
  homeView.classList.remove('hidden');
}
backBtn.addEventListener('click', goHome);
homeLink.addEventListener('click', goHome);

dropzone.addEventListener('click', (e) => {
  if (e.target === fileInput) return;
  fileInput.click();
});
fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));
['dragover', 'dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.toggle('drag', evt === 'dragover');
    if (evt === 'drop') handleFiles([...e.dataTransfer.files]);
  });
});

function handleFiles(files) {
  if (!currentTool) return;
  selectedFiles = currentTool.multiple ? [...selectedFiles, ...files] : files.slice(0, 1);
  renderFileList();
  updateSubmitState();
  if (currentTool.custom === 'organize' && selectedFiles.length) fetchThumbnails();
}

function renderFileList() {
  fileListEl.innerHTML = '';
  selectedFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `<span>${f.name} (${(f.size / 1024).toFixed(0)} KB)</span><span class="rm" data-i="${i}">✕</span>`;
    chip.querySelector('.rm').addEventListener('click', (e) => {
      e.stopPropagation();
      selectedFiles.splice(i, 1);
      renderFileList();
      updateSubmitState();
    });
    fileListEl.appendChild(chip);
  });
}

function renderOptions() {
  optionsArea.innerHTML = '';
  if (!currentTool.fields) return;
  const state = {};
  for (const f of currentTool.fields) state[f.name] = f.default ?? '';

  function render() {
    optionsArea.innerHTML = '';
    for (const f of currentTool.fields) {
      if (f.showIf && !Object.entries(f.showIf).every(([k, v]) => String(state[k]) === String(v))) continue;
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = f.label;
      wrap.appendChild(label);
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        for (const [val, text] of f.options) {
          const opt = document.createElement('option');
          opt.value = val; opt.textContent = text;
          if (val === String(state[f.name])) opt.selected = true;
          input.appendChild(opt);
        }
      } else if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 4;
        input.placeholder = f.placeholder || '';
        input.value = state[f.name] || '';
        input.style = 'background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px;font-size:14px;font-family:inherit;';
      } else {
        input = document.createElement('input');
        input.type = f.type;
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.min !== undefined) input.min = f.min;
        if (f.max !== undefined) input.max = f.max;
        if (f.step !== undefined) input.step = f.step;
        input.value = state[f.name] ?? '';
      }
      input.addEventListener('input', () => {
        state[f.name] = input.value;
        if (f.showIf !== undefined || currentTool.fields.some((x) => x.showIf && f.name in x.showIf)) render();
        updateSubmitState();
      });
      wrap.appendChild(input);
      optionsArea.appendChild(wrap);
    }
  }
  render();
  currentTool._formState = state;
}

function updateSubmitState() {
  let ok = selectedFiles.length > 0;
  if (currentTool.minFiles) ok = ok && selectedFiles.length >= currentTool.minFiles;
  if (currentTool.fields) {
    for (const f of currentTool.fields) {
      if (f.required && !currentTool._formState?.[f.name]) ok = false;
    }
  }
  if (currentTool.custom === 'organize') ok = !!organizeState;
  submitBtn.disabled = !ok;
}

async function fetchThumbnails() {
  statusArea.className = 'status-area';
  statusArea.textContent = 'Rendering page thumbnails…';
  organizeArea.classList.remove('hidden');
  organizeArea.innerHTML = '';
  dropzone.classList.add('hidden');
  const body = new FormData();
  body.set('file', selectedFiles[0]);
  try {
    const res = await fetch('/api/thumbnails', { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to render thumbnails');
    organizeState = { thumbs: data.thumbs, order: data.thumbs.map((t) => t.page) };
    renderOrganizeGrid();
    statusArea.textContent = 'Drag to reorder, click ✕ to remove a page.';
  } catch (err) {
    statusArea.className = 'status-area error';
    statusArea.textContent = err.message;
  }
  updateSubmitState();
}

function renderOrganizeGrid() {
  organizeArea.innerHTML = '';
  organizeState.order.forEach((pageNum, idx) => {
    const thumb = organizeState.thumbs.find((t) => t.page === pageNum);
    const card = document.createElement('div');
    card.className = 'thumb-card';
    card.draggable = true;
    card.dataset.idx = idx;
    card.innerHTML = `<img src="${thumb.dataUrl}" alt="page ${pageNum}"><div class="meta"><span>Page ${pageNum}</span><span class="del">✕</span></div>`;
    card.querySelector('.del').addEventListener('click', () => {
      organizeState.order.splice(idx, 1);
      renderOrganizeGrid();
      updateSubmitState();
    });
    card.addEventListener('dragstart', () => card.classList.add('dragging'));
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (e) => e.preventDefault());
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = parseInt(organizeArea.querySelector('.dragging').dataset.idx, 10);
      const toIdx = idx;
      const [moved] = organizeState.order.splice(fromIdx, 1);
      organizeState.order.splice(toIdx, 0, moved);
      renderOrganizeGrid();
    });
    organizeArea.appendChild(card);
  });
  updateSubmitState();
}

submitBtn.addEventListener('click', async () => {
  submitBtn.disabled = true;
  statusArea.className = 'status-area';
  statusArea.textContent = 'Processing…';
  resultArea.innerHTML = '';
  try {
    const body = new FormData();
    if (currentTool.custom === 'organize') {
      body.set('file', selectedFiles[0]);
      body.set('order', JSON.stringify(organizeState.order));
    } else {
      if (currentTool.multiple) {
        for (const f of selectedFiles) body.append(currentTool.fileField, f);
      } else {
        body.set(currentTool.fileField, selectedFiles[0]);
      }
      const form = currentTool._formState || {};
      if (currentTool.buildBody) {
        currentTool.buildBody(form, body);
      } else if (currentTool.fields) {
        for (const f of currentTool.fields) {
          if (form[f.name] !== undefined && form[f.name] !== '') body.set(f.name, form[f.name]);
        }
      }
    }
    const res = await fetch(currentTool.endpoint, { method: 'POST', body });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(data.error || 'Request failed');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+?)"/);
    const filename = match ? match[1] : 'output';
    const url = URL.createObjectURL(blob);
    resultArea.innerHTML = '';
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.className = 'download-link';
    link.textContent = `⬇ Download ${filename}`;
    resultArea.appendChild(link);

    const origSize = res.headers.get('X-Original-Size');
    const compSize = res.headers.get('X-Compressed-Size');
    if (origSize && compSize) {
      const pct = (100 * (1 - compSize / origSize)).toFixed(1);
      const info = document.createElement('div');
      info.className = 'hint';
      info.style.marginTop = '8px';
      info.textContent = `${(origSize / 1024).toFixed(0)} KB → ${(compSize / 1024).toFixed(0)} KB (${pct}% smaller)`;
      resultArea.appendChild(info);
    }

    statusArea.className = 'status-area ok';
    statusArea.textContent = 'Done.';
  } catch (err) {
    statusArea.className = 'status-area error';
    statusArea.textContent = err.message;
  } finally {
    updateSubmitState();
  }
});

renderGrid();
loadSystemInfo();
