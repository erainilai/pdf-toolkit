/* Exam photo & signature resizer — runs entirely in the browser (no upload), which keeps it
 * free to operate and lets us promise the photo never leaves the device.
 *
 * Pipeline: decode → crop to the preset's aspect ratio (zoom + vertical position controls)
 * → draw on white at exact pixel size → binary-search JPEG quality for the largest file under
 * maxKB → if still under minKB, pad with a JPEG comment segment (pixels untouched) → stamp the
 * DPI into the JFIF header. */

let presets = [];
let ctx;
let state;

const $ = (sel) => document.querySelector(sel);

export async function mount(container, context) {
  ctx = context;
  state = { img: null, blob: null, zoom: 1, offsetY: 0.35, nameDate: false };
  if (!presets.length) {
    try {
      presets = (await (await fetch('/data/exam-presets.json')).json()).presets;
    } catch { presets = []; }
  }
  const options = presets.map((p) => `<option value="${p.id}">${p.exam} — ${p.doc} (${p.label})</option>`).join('');
  container.innerHTML = `
    <div class="notice">Sizes change between notifications. Always check the limits printed in your exam notification before uploading.</div>
    <div class="field"><label>Preset</label>
      <select id="exPreset">${options}<option value="custom">Custom size…</option></select>
    </div>
    <div class="field-row" id="exCustom" style="display:none">
      <div class="field"><label>Width (px)</label><input type="number" id="exW" min="20" value="300"></div>
      <div class="field"><label>Height (px)</label><input type="number" id="exH" min="20" value="400"></div>
      <div class="field"><label>Min KB</label><input type="number" id="exMin" min="0" value="20"></div>
      <div class="field"><label>Max KB</label><input type="number" id="exMax" min="1" value="50"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Zoom</label><input type="range" id="exZoom" min="1" max="2.5" step="0.05" value="1"></div>
      <div class="field"><label>Vertical position</label><input type="range" id="exOffset" min="0" max="1" step="0.01" value="0.35"></div>
    </div>
    <div class="field check"><input type="checkbox" id="exNameDate"><label for="exNameDate">Print name and date at the bottom (only if your notification asks for it)</label></div>
    <div class="field-row" id="exNameRow" style="display:none">
      <div class="field"><label>Name</label><input type="text" id="exName" placeholder="Your name"></div>
      <div class="field"><label>Date</label><input type="text" id="exDate" value="${new Date().toLocaleDateString('en-GB')}"></div>
    </div>
    <div class="exam-preview">
      <canvas id="exCanvas" width="276" height="354"></canvas>
      <div class="exam-stats" id="exStats">Choose a photo or signature image to start.</div>
    </div>`;
  ctx.updateSubmitState();
  $('#exPreset').addEventListener('change', () => {
    $('#exCustom').style.display = $('#exPreset').value === 'custom' ? 'flex' : 'none';
    render();
  });
  ['#exW', '#exH', '#exMin', '#exMax', '#exName', '#exDate'].forEach((id) => $(id).addEventListener('input', render));
  $('#exZoom').addEventListener('input', (e) => { state.zoom = +e.target.value; render(); });
  $('#exOffset').addEventListener('input', (e) => { state.offsetY = +e.target.value; render(); });
  $('#exNameDate').addEventListener('change', (e) => {
    state.nameDate = e.target.checked;
    $('#exNameRow').style.display = e.target.checked ? 'flex' : 'none';
    render();
  });
}

function spec() {
  const id = $('#exPreset').value;
  if (id === 'custom') {
    return { width: +$('#exW').value, height: +$('#exH').value, minKB: +$('#exMin').value || 0, maxKB: +$('#exMax').value, dpi: 200, id: 'custom' };
  }
  return presets.find((p) => p.id === id);
}

export async function onFiles(files) {
  state.img = null;
  state.blob = null;
  if (!files[0]) { render(); return; }
  try {
    state.img = await decode(files[0]);
    ctx.setStatus('');
  } catch {
    ctx.setStatus('Could not read this image. iPhone HEIC photos: use "Convert & Compress Images" to make a JPG first.', 'error');
  }
  render();
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

let renderToken = 0;
async function render() {
  const s = spec();
  const canvas = $('#exCanvas');
  if (!s || !canvas) return;
  canvas.width = s.width;
  canvas.height = s.height;
  canvas.style.width = `${Math.min(s.width, 320)}px`;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, s.width, s.height);
  state.blob = null;
  ctx.updateSubmitState();
  if (!state.img) return;

  // Cover-crop to the target aspect ratio, then apply zoom and the vertical position slider.
  const iw = state.img.width, ih = state.img.height;
  const scale = Math.max(s.width / iw, s.height / ih) * state.zoom;
  const dw = iw * scale, dh = ih * scale;
  const dx = (s.width - dw) / 2;
  const dy = (s.height - dh) * state.offsetY;
  c.imageSmoothingQuality = 'high';
  c.drawImage(state.img, dx, dy, dw, dh);

  if (state.nameDate) {
    const band = Math.round(s.height * 0.16);
    c.fillStyle = '#fff';
    c.fillRect(0, s.height - band, s.width, band);
    c.fillStyle = '#000';
    c.textAlign = 'center';
    const fs = Math.max(9, Math.round(band * 0.36));
    c.font = `600 ${fs}px sans-serif`;
    c.fillText($('#exName').value || '', s.width / 2, s.height - band + fs + 2, s.width - 8);
    c.font = `${fs}px sans-serif`;
    c.fillText($('#exDate').value || '', s.width / 2, s.height - 6, s.width - 8);
  }

  const token = ++renderToken;
  const result = await fitToKB(canvas, s);
  if (token !== renderToken) return; // a newer render started while we were encoding
  state.blob = result.blob;
  const kb = (result.blob.size / 1024).toFixed(1);
  const okSize = result.blob.size <= s.maxKB * 1024 && result.blob.size >= (s.minKB || 0) * 1024;
  $('#exStats').innerHTML = `
    Size: <strong>${s.width} × ${s.height} px</strong> at ${s.dpi || 200} DPI<br>
    File: <strong>${kb} KB</strong> <span class="${okSize ? 'ok-text' : 'err-text'}">(${s.minKB || 0}–${s.maxKB} KB required)</span><br>
    JPEG quality: ${Math.round(result.quality * 100)}%${result.padded ? ' · padded up to the minimum size' : ''}`;
  ctx.updateSubmitState();
}

const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));

async function fitToKB(canvas, s) {
  const max = s.maxKB * 1024;
  let lo = 0.05, hi = 1, best = null;
  for (let i = 0; i < 9; i++) {
    const q = (lo + hi) / 2;
    const b = await toBlob(canvas, q);
    if (b.size <= max) { best = { blob: b, quality: q }; lo = q; } else { hi = q; }
  }
  if (!best) best = { blob: await toBlob(canvas, 0.05), quality: 0.05 };
  let bytes = new Uint8Array(await best.blob.arrayBuffer());
  bytes = setJfifDpi(bytes, s.dpi || 200);
  let padded = false;
  const min = (s.minKB || 0) * 1024;
  if (bytes.length < min) { bytes = padJpeg(bytes, min + 256); padded = true; }
  return { blob: new Blob([bytes], { type: 'image/jpeg' }), quality: best.quality, padded };
}

/** Sets JFIF density (units = dots per inch) when the encoder wrote a JFIF APP0 segment. */
function setJfifDpi(b, dpi) {
  if (b[2] === 0xff && b[3] === 0xe0 && String.fromCharCode(b[6], b[7], b[8], b[9]) === 'JFIF') {
    b = b.slice();
    b[13] = 1;
    b[14] = dpi >> 8; b[15] = dpi & 0xff;
    b[16] = dpi >> 8; b[17] = dpi & 0xff;
  }
  return b;
}

/** Inserts JPEG comment (COM) segments right after SOI to reach a minimum file size. */
function padJpeg(b, target) {
  const parts = [b.slice(0, 2)];
  let need = target - b.length;
  while (need > 0) {
    const len = Math.min(65533, Math.max(1, need - 4));
    const seg = new Uint8Array(len + 4).fill(0x20);
    seg[0] = 0xff; seg[1] = 0xfe; seg[2] = (len + 2) >> 8; seg[3] = (len + 2) & 0xff;
    parts.push(seg);
    need -= seg.length;
  }
  parts.push(b.slice(2));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function isReady() {
  return !!state?.blob;
}

export async function submit() {
  const s = spec();
  const name = `${(s.id || 'photo').replace(/[^a-z0-9-]/gi, '_')}_${s.width}x${s.height}.jpg`;
  ctx.showDownload(state.blob, name, `${(state.blob.size / 1024).toFixed(1)} KB · ${s.width}×${s.height} px`);
  ctx.setStatus('Ready — this file was made on your device and was not uploaded.', 'ok');
}
