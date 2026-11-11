/** Shared page-preview + box-positioning overlay, used by Sign (one draggable, slider-resized
 *  box) and Redact (multiple boxes drawn by click-drag). Boxes are exposed as fractions (0-1,
 *  top-left origin) of the preview image's own pixel size, so the server just multiplies by
 *  the real PDF page size in points — independent of whatever resolution we rendered at. */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function mountPositioner(container, { mode = 'single' } = {}) {
  let file = null;
  let pageIndex = 0;
  let boxes = mode === 'single' ? [{ x: 0.3, y: 0.4, width: 0.3, height: 0.1 }] : [];
  let onBoxesChange = () => {};

  container.innerHTML = `
    <div class="positioner">
      <div class="positioner-toolbar">
        <button type="button" class="btn-text pp-prev">‹ Prev page</button>
        <span class="pp-page">Page 1</span>
        <button type="button" class="btn-text pp-next">Next page ›</button>
        ${mode === 'multi' ? '<button type="button" class="btn-text pp-clear">Clear boxes</button>' : ''}
      </div>
      <div class="positioner-stage" id="ppStage"><p class="muted">Upload a file to preview the page.</p></div>
      ${mode === 'single' ? '<div class="field"><label>Signature size</label><input type="range" class="pp-size" min="0.1" max="0.6" step="0.01" value="0.3"></div>' : ''}
    </div>`;

  const stage = container.querySelector('#ppStage');
  const pageLabel = container.querySelector('.pp-page');

  async function loadPreview() {
    if (!file) return;
    stage.innerHTML = '<p class="muted">Rendering page…</p>';
    const fd = new FormData();
    fd.set('file', file);
    fd.set('pageIndex', String(pageIndex));
    const res = await fetch('/api/page-preview', { method: 'POST', credentials: 'same-origin', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { stage.innerHTML = `<p class="muted">${data.error || 'Could not render this page.'}</p>`; return; }
    pageLabel.textContent = `Page ${pageIndex + 1}`;
    stage.innerHTML = `<div class="pp-frame"><img class="pp-img" src="${data.dataUrl}" alt="Page ${pageIndex + 1}"><div class="pp-overlay"></div></div>`;
    wireOverlay();
    drawBoxes();
  }

  function wireOverlay() {
    const overlay = stage.querySelector('.pp-overlay');
    if (!overlay) return;
    if (mode === 'single') {
      let dragging = false, start = null;
      overlay.addEventListener('pointerdown', (e) => {
        dragging = true;
        const rect = overlay.getBoundingClientRect();
        start = { x: (e.clientX - rect.left) / rect.width - boxes[0].x, y: (e.clientY - rect.top) / rect.height - boxes[0].y };
      });
      overlay.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = overlay.getBoundingClientRect();
        boxes[0].x = clamp((e.clientX - rect.left) / rect.width - start.x, 0, 1 - boxes[0].width);
        boxes[0].y = clamp((e.clientY - rect.top) / rect.height - start.y, 0, 1 - boxes[0].height);
        drawBoxes();
        onBoxesChange();
      });
      window.addEventListener('pointerup', () => { dragging = false; });
    } else {
      let drawing = false, startFrac = null;
      overlay.addEventListener('pointerdown', (e) => {
        drawing = true;
        const rect = overlay.getBoundingClientRect();
        startFrac = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
        boxes.push({ pageIndex, x: startFrac.x, y: startFrac.y, width: 0, height: 0 });
        drawBoxes();
      });
      overlay.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const rect = overlay.getBoundingClientRect();
        const cur = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
        const b = boxes[boxes.length - 1];
        b.x = Math.min(startFrac.x, cur.x); b.y = Math.min(startFrac.y, cur.y);
        b.width = Math.abs(cur.x - startFrac.x); b.height = Math.abs(cur.y - startFrac.y);
        drawBoxes();
      });
      window.addEventListener('pointerup', () => {
        if (!drawing) return;
        drawing = false;
        const b = boxes[boxes.length - 1];
        if (b.width < 0.01 || b.height < 0.01) boxes.pop(); // discard accidental clicks
        onBoxesChange();
      });
    }
  }

  function drawBoxes() {
    const overlay = stage.querySelector('.pp-overlay');
    if (!overlay) return;
    const visible = mode === 'single' ? boxes : boxes.filter((b) => b.pageIndex === pageIndex);
    overlay.innerHTML = visible.map((b, i) => `
      <div class="pp-box" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.width * 100}%;height:${b.height * 100}%" data-i="${i}">
        ${mode === 'multi' ? '<button type="button" class="pp-box-remove" aria-label="Remove box">×</button>' : ''}
      </div>`).join('');
    if (mode === 'multi') {
      overlay.querySelectorAll('.pp-box-remove').forEach((btn) => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const realIndex = boxes.indexOf(visible[Number(btn.closest('.pp-box').dataset.i)]);
        boxes.splice(realIndex, 1);
        drawBoxes();
        onBoxesChange();
      }));
    }
  }

  container.querySelector('.pp-prev').addEventListener('click', () => { if (pageIndex > 0) { pageIndex--; loadPreview(); } });
  container.querySelector('.pp-next').addEventListener('click', () => { pageIndex++; loadPreview(); });
  container.querySelector('.pp-clear')?.addEventListener('click', () => { boxes = []; drawBoxes(); onBoxesChange(); });
  container.querySelector('.pp-size')?.addEventListener('input', (e) => {
    const size = parseFloat(e.target.value);
    boxes[0].width = size; boxes[0].height = size * 0.35; // roughly a signature's aspect ratio
    drawBoxes();
    onBoxesChange();
  });

  return {
    setFile(f) { file = f; pageIndex = 0; loadPreview(); },
    onChange(fn) { onBoxesChange = fn; },
    getBoxes() { return boxes; },
    getPageIndex() { return pageIndex; },
  };
}
