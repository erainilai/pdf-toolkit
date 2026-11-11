import { mountPositioner } from './pagePositioner.js';

/** Custom tool: draw one or more blackout boxes across any pages, then submit. The server
 *  rasterizes only the redacted pages (true redaction — see src/lib/pdfOps.js redactPages),
 *  everything else stays as normal searchable text. */
let ctx = null;
let positioner = null;

export function mount(host, c) {
  ctx = c;
  host.innerHTML = `
    <p class="muted">Upload a PDF, then click and drag on the page to draw a blackout box. Use "Next page" to redact more pages.</p>
    <div id="positionerHost"></div>`;
  positioner = mountPositioner(host.querySelector('#positionerHost'), { mode: 'multi' });
  positioner.onChange(() => ctx.updateSubmitState());
}

export function onFiles(files) {
  if (files?.[0]) positioner.setFile(files[0]);
}

export function isReady() {
  return (positioner?.getBoxes()?.length || 0) > 0;
}

export function buildBody(fd) {
  const byPage = new Map();
  for (const b of positioner.getBoxes()) {
    if (!byPage.has(b.pageIndex)) byPage.set(b.pageIndex, []);
    byPage.get(b.pageIndex).push({ x: b.x, y: b.y, width: b.width, height: b.height });
  }
  const redactions = [...byPage.entries()].map(([pageIndex, boxes]) => ({ pageIndex, boxes }));
  fd.set('options', JSON.stringify({ redactions }));
}
