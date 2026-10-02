import * as examPhoto from './tools/examPhoto.js';
import * as tamilFont from './tools/tamilFont.js';
import * as gstInvoice from './tools/gstInvoice.js';

const CUSTOM = { 'exam-photo': examPhoto, 'tamil-font': tamilFont, 'gst-invoice': gstInvoice };

const CATEGORIES = [
  ['popular', 'Popular in India'],
  ['pdf', 'Organize & edit PDF'],
  ['convert', 'Convert'],
  ['image', 'Images'],
  ['tamil', 'Tamil'],
  ['data', 'Spreadsheets & business'],
  ['security', 'Security'],
];
const CATEGORY_OF = {
  merge: 'pdf', split: 'pdf', 'remove-pages': 'pdf', 'extract-pages': 'pdf', rotate: 'pdf', organize: 'pdf',
  watermark: 'pdf', 'page-numbers': 'pdf', compress: 'pdf',
  'images-to-pdf': 'convert', 'pdf-to-images': 'convert', 'pdf-to-text': 'convert',
  protect: 'security', unlock: 'security',
};

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
    id: 'images-to-pdf', icon: '🖼️', name: 'Images to PDF', desc: 'Combine JPG, PNG, WebP or iPhone HEIC photos into a single PDF.',
    accept: 'image/*,.heic', multiple: true, minFiles: 1, endpoint: '/api/images-to-pdf', fileField: 'files',
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
    id: 'compress', icon: '🗜️', name: 'Compress PDF', desc: 'Shrink scanned and photo-heavy PDFs by re-compressing their images.',
    accept: '.pdf', multiple: false, endpoint: '/api/compress', fileField: 'file',
    fields: [{ name: 'quality', label: 'Compression level', type: 'select', options: [['screen', 'Smallest (screen)'], ['ebook', 'Balanced (ebook)'], ['printer', 'High quality (printer)']], default: 'ebook' }],
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

  /* ---- Added tools (served by the generic /api/tool/:name route) ---- */
  {
    id: 'exam-photo', category: 'popular', icon: '🪪', name: 'Exam Photo & Signature', desc: 'Resize to exact TNPSC, SSC, IBPS, UPSC or passport size and KB limit. Runs in your browser.',
    accept: 'image/*,.heic', multiple: false, custom: 'exam-photo', submitLabel: 'Get resized photo',
  },
  {
    id: 'ocr', category: 'tamil', icon: '🔍', name: 'Tamil OCR', desc: 'Turn scanned Tamil/English pages or photos into editable text and a searchable PDF.',
    accept: '.pdf,image/*', multiple: true, endpoint: '/api/tool/ocr', fileField: 'files',
    fields: [
      { name: 'lang', label: 'Language', type: 'select', options: [['tam+eng', 'Tamil + English'], ['tam', 'Tamil'], ['eng', 'English']], default: 'tam+eng' },
      { name: 'output', label: 'Output', type: 'select', options: [['both', 'Searchable PDF + text (zip)'], ['pdf', 'Searchable PDF'], ['text', 'Text file']], default: 'both' },
    ],
  },
  {
    id: 'tamil-font', category: 'tamil', icon: 'அ', name: 'Tamil Font Converter', desc: 'Bamini / SunTommy ↔ Unicode. Fix old Tamil documents that show as English letters.',
    custom: 'tamil-font', noUpload: true, noSubmit: true,
  },
  {
    id: 'office-to-pdf', category: 'popular', icon: '📄', name: 'Word / Excel / PPT to PDF', desc: 'Convert DOCX, XLSX, PPTX, ODT and more to PDF.',
    accept: '.doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp', multiple: true, endpoint: '/api/tool/office-to-pdf', fileField: 'files',
  },
  {
    id: 'pdf-to-word', category: 'convert', icon: '📝', name: 'PDF to Word', desc: 'Editable DOCX with layout kept. Best for small text changes.',
    accept: '.pdf', multiple: false, endpoint: '/api/tool/pdf-to-word', fileField: 'files',
  },
  {
    id: 'pdf-to-powerpoint', category: 'convert', icon: '📊', name: 'PDF to PowerPoint', desc: 'Each PDF page becomes a slide.',
    accept: '.pdf', multiple: false, endpoint: '/api/tool/pdf-to-powerpoint', fileField: 'files',
  },
  {
    id: 'remove-background', category: 'image', icon: '✨', name: 'Remove Background', desc: 'Cut out the subject. Transparent PNG, or a white background for ID photos.',
    accept: 'image/*,.heic', multiple: true, endpoint: '/api/tool/remove-background', fileField: 'files',
    fields: [{ name: 'background', label: 'Background', type: 'select', options: [['', 'Transparent (PNG)'], ['#ffffff', 'White (JPG)'], ['#dbe9ff', 'Light blue (JPG)']], default: '' }],
  },
  {
    id: 'convert-image', category: 'image', icon: '🖼️', name: 'Convert & Compress Images', desc: 'JPG, PNG, WebP, AVIF, HEIC (iPhone). Resize and shrink in bulk.',
    accept: 'image/*,.heic', multiple: true, endpoint: '/api/tool/convert-image', fileField: 'files',
    fields: [
      { name: 'format', label: 'Convert to', type: 'select', options: [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF']], default: 'jpg' },
      { name: 'quality', label: 'Quality (1-100)', type: 'number', default: 80, min: 1, max: 100 },
      { name: 'width', label: 'Max width in px (optional)', type: 'number', min: 1 },
      { name: 'height', label: 'Max height in px (optional)', type: 'number', min: 1 },
    ],
  },
  {
    id: 'gst-invoice', category: 'popular', icon: '🧾', name: 'GST Invoice Generator', desc: 'Tax invoice with CGST/SGST or IGST, HSN, amount in words. Tamil supported.',
    custom: 'gst-invoice', noUpload: true, endpoint: '/api/tool/gst-invoice', submitLabel: 'Create invoice PDF',
  },
  {
    id: 'sheet-clean', category: 'data', icon: '🧹', name: 'Clean Excel / CSV', desc: 'Trim spaces, drop empty rows and columns, remove duplicates.',
    accept: '.xlsx,.csv,.json', multiple: false, endpoint: '/api/tool/sheet-clean', fileField: 'files',
    fields: [
      { name: 'trim', label: 'Trim extra spaces', type: 'checkbox', default: true },
      { name: 'removeEmpty', label: 'Remove empty rows and columns', type: 'checkbox', default: true },
      { name: 'dedupe', label: 'Remove duplicate rows', type: 'checkbox', default: true },
      { name: 'dedupeColumns', label: 'Duplicate check on columns (optional, comma-separated headers)', type: 'text', placeholder: 'Name, Phone', showIf: { dedupe: true } },
    ],
  },
  {
    id: 'sheet-convert', category: 'data', icon: '🔁', name: 'Excel ↔ CSV ↔ JSON', desc: 'Convert spreadsheets between XLSX, CSV and JSON. Tamil text kept intact.',
    accept: '.xlsx,.csv,.json', multiple: false, endpoint: '/api/tool/sheet-convert', fileField: 'files',
    fields: [{ name: 'format', label: 'Convert to', type: 'select', options: [['xlsx', 'Excel (XLSX)'], ['csv', 'CSV'], ['json', 'JSON']], default: 'xlsx' }],
  },
  {
    id: 'sheet-merge', category: 'data', icon: '🗂️', name: 'Merge Excel / CSV', desc: 'Combine files into one sheet (columns matched by header) or one workbook.',
    accept: '.xlsx,.csv,.json', multiple: true, minFiles: 2, endpoint: '/api/tool/sheet-merge', fileField: 'files',
    fields: [{ name: 'mode', label: 'Merge into', type: 'select', options: [['rows', 'One sheet (stack rows)'], ['sheets', 'One workbook, one sheet per file']], default: 'rows' }],
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
const customArea = document.getElementById('customArea');
const organizeArea = document.getElementById('organizeArea');
const submitBtn = document.getElementById('submitBtn');
const statusArea = document.getElementById('statusArea');
const resultArea = document.getElementById('resultArea');

let currentTool = null;
let selectedFiles = [];
let organizeState = null; // { thumbs: [{page, dataUrl}], order: [page,...] }
let customModule = null;   // mounted module for tools with their own UI (exam photo, Tamil font, invoice)

function renderGrid() {
  toolGrid.innerHTML = '';
  for (const [cat, title] of CATEGORIES) {
    const tools = TOOLS.filter((t) => (t.category || CATEGORY_OF[t.id]) === cat);
    if (!tools.length) continue;
    const section = document.createElement('section');
    section.className = 'category';
    section.innerHTML = `<h3>${title}</h3><div class="grid"></div>`;
    const grid = section.querySelector('.grid');
    for (const tool of tools) {
      const card = document.createElement('div');
      card.className = 'tool-card';
      card.innerHTML = `<span class="icon">${tool.icon}</span><div class="name">${tool.name}</div><div class="desc">${tool.desc}</div>`;
      card.addEventListener('click', () => openTool(tool));
      grid.appendChild(card);
    }
    toolGrid.appendChild(section);
  }
}

async function loadSystemInfo() {
  try {
    const res = await fetch('/api/system-info');
    const info = await res.json();
    const warnings = [];
    if (!info.qpdf) warnings.push(info.notes.qpdf);
    if (!info.libreoffice) warnings.push(info.notes.libreoffice);
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
  dropzone.classList.toggle('hidden', !!tool.noUpload);
  submitBtn.classList.toggle('hidden', !!tool.noSubmit);
  submitBtn.textContent = tool.submitLabel || 'Process';
  customArea.innerHTML = '';
  customArea.classList.toggle('hidden', !CUSTOM[tool.custom]);
  customModule = CUSTOM[tool.custom] || null;
  customModule?.mount(customArea, {
    setStatus,
    showDownload,
    updateSubmitState,
    getFiles: () => selectedFiles,
  });
  renderOptions();
  updateSubmitState();
}

function setStatus(text, kind = '') {
  statusArea.className = `status-area ${kind}`.trim();
  statusArea.textContent = text;
}

function showDownload(blob, filename, extra) {
  const url = URL.createObjectURL(blob);
  resultArea.innerHTML = '';
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.className = 'download-link';
  link.textContent = `⬇ Download ${filename}`;
  resultArea.appendChild(link);
  if (extra) {
    const info = document.createElement('div');
    info.className = 'hint';
    info.style.marginTop = '8px';
    info.textContent = extra;
    resultArea.appendChild(info);
  }
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
  customModule?.onFiles?.(selectedFiles);
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
      customModule?.onFiles?.(selectedFiles);
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
      } else if (f.type === 'checkbox') {
        wrap.className = 'field check';
        input = document.createElement('input');
        input.type = 'checkbox';
        input.id = `f_${f.name}`;
        input.checked = state[f.name] === true || state[f.name] === 'true';
        label.htmlFor = input.id;
        wrap.prepend(input);
        input.addEventListener('change', () => {
          state[f.name] = input.checked;
          render();
          updateSubmitState();
        });
        optionsArea.appendChild(wrap);
        continue;
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
  if (!currentTool) return;
  let ok = currentTool.noUpload ? true : selectedFiles.length > 0;
  if (currentTool.minFiles) ok = ok && selectedFiles.length >= currentTool.minFiles;
  if (currentTool.fields) {
    for (const f of currentTool.fields) {
      if (f.required && !currentTool._formState?.[f.name]) ok = false;
    }
  }
  if (currentTool.custom === 'organize') ok = !!organizeState;
  if (customModule?.isReady) ok = ok && customModule.isReady();
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
    if (customModule?.submit) {
      await customModule.submit();
      return;
    }
    const body = new FormData();
    if (customModule?.buildBody) {
      customModule.buildBody(body);
    } else if (currentTool.custom === 'organize') {
      body.set('file', selectedFiles[0]);
      body.set('order', JSON.stringify(organizeState.order));
    } else {
      if (currentTool.multiple) {
        for (const f of selectedFiles) body.append(currentTool.fileField, f);
      } else {
        if (selectedFiles[0]) body.set(currentTool.fileField, selectedFiles[0]);
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
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/);
    const match = disposition.match(/filename="(.+?)"/);
    const filename = star ? decodeURIComponent(star[1]) : match ? decodeURIComponent(match[1]) : 'output';
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
