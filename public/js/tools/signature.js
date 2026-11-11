import { mountPositioner } from './pagePositioner.js';

/** Custom tool: create a signature (typed in a cursive font, or drawn freehand), then place
 *  and size it on the target page via the shared pagePositioner overlay. */
const FONTS = [
  ['Caveat', 'Caveat'],
  ['Dancing Script', 'Dancing Script'],
  ['Pacifico', 'Pacifico'],
  ['Sacramento', 'Sacramento'],
  ['Satisfy', 'Satisfy'],
  ['Great Vibes', 'Great Vibes'],
];

let ctx = null;
let positioner = null;
let signatureBlob = null;
let mode = 'type';

export function mount(host, c) {
  ctx = c;
  host.innerHTML = `
    <div class="signature-maker">
      <div class="toggle" role="tablist">
        <button type="button" data-mode="type" aria-pressed="true">Type</button>
        <button type="button" data-mode="draw" aria-pressed="false">Draw</button>
      </div>
      <div class="sig-type">
        <div class="field"><label for="sigText">Your name</label><input id="sigText" type="text" placeholder="Your signature"></div>
        <div class="field"><label for="sigFont">Style</label>
          <select id="sigFont">${FONTS.map(([v, l]) => `<option value="${v}" style="font-family:'${v}',cursive">${l}</option>`).join('')}</select>
        </div>
      </div>
      <div class="sig-draw hidden">
        <canvas id="sigCanvas" width="400" height="140"></canvas>
        <button type="button" class="btn-text" id="sigClear">Clear</button>
      </div>
      <canvas id="sigPreview" width="400" height="140" class="sig-preview"></canvas>
      <div id="positionerHost" class="hidden"></div>
    </div>`;

  const typeBtn = host.querySelector('[data-mode="type"]');
  const drawBtn = host.querySelector('[data-mode="draw"]');
  const typeBox = host.querySelector('.sig-type');
  const drawBox = host.querySelector('.sig-draw');
  const preview = host.querySelector('#sigPreview');
  const drawCanvas = host.querySelector('#sigCanvas');

  typeBtn.addEventListener('click', () => { mode = 'type'; typeBtn.setAttribute('aria-pressed', 'true'); drawBtn.setAttribute('aria-pressed', 'false'); typeBox.classList.remove('hidden'); drawBox.classList.add('hidden'); renderTyped(); });
  drawBtn.addEventListener('click', () => { mode = 'draw'; drawBtn.setAttribute('aria-pressed', 'true'); typeBtn.setAttribute('aria-pressed', 'false'); drawBox.classList.remove('hidden'); typeBox.classList.add('hidden'); updateFromDraw(); });

  host.querySelector('#sigText').addEventListener('input', renderTyped);
  host.querySelector('#sigFont').addEventListener('change', renderTyped);

  wireDrawing(drawCanvas);
  host.querySelector('#sigClear').addEventListener('click', () => {
    const dctx = drawCanvas.getContext('2d');
    dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    updateFromDraw();
  });

  async function renderTyped() {
    const text = host.querySelector('#sigText').value.trim();
    const font = host.querySelector('#sigFont').value;
    const pctx = preview.getContext('2d');
    pctx.clearRect(0, 0, preview.width, preview.height);
    if (!text) { signatureBlob = null; ctx.updateSubmitState(); return; }
    try { await document.fonts.load(`48px "${font}"`); } catch { /* fall back to whatever's available */ }
    pctx.fillStyle = '#1a1a2e';
    pctx.font = `48px "${font}", cursive`;
    pctx.textBaseline = 'middle';
    pctx.fillText(text, 12, preview.height / 2);
    signatureBlob = await new Promise((resolve) => preview.toBlob(resolve, 'image/png'));
    showPositionerIfReady();
  }

  async function updateFromDraw() {
    const pctx = preview.getContext('2d');
    pctx.clearRect(0, 0, preview.width, preview.height);
    pctx.drawImage(drawCanvas, 0, 0);
    const isBlank = !drawCanvas.getContext('2d').getImageData(0, 0, drawCanvas.width, drawCanvas.height).data.some((v, i) => i % 4 === 3 && v !== 0);
    signatureBlob = isBlank ? null : await new Promise((resolve) => preview.toBlob(resolve, 'image/png'));
    ctx.updateSubmitState();
    showPositionerIfReady();
  }

  function wireDrawing(canvas) {
    const dctx = canvas.getContext('2d');
    dctx.strokeStyle = '#1a1a2e';
    dctx.lineWidth = 3;
    dctx.lineCap = 'round';
    let drawing = false;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }; };
    canvas.addEventListener('pointerdown', (e) => { drawing = true; const p = pos(e); dctx.beginPath(); dctx.moveTo(p.x, p.y); });
    canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); dctx.lineTo(p.x, p.y); dctx.stroke(); });
    canvas.addEventListener('pointerup', () => { if (drawing) { drawing = false; updateFromDraw(); } });
    canvas.addEventListener('pointerleave', () => { if (drawing) { drawing = false; updateFromDraw(); } });
  }

  function showPositionerIfReady() {
    const posHost = host.querySelector('#positionerHost');
    if (!signatureBlob) { posHost.classList.add('hidden'); ctx.updateSubmitState(); return; }
    posHost.classList.remove('hidden');
    if (!positioner) positioner = mountPositioner(posHost, { mode: 'single' });
    const files = ctx.getFiles();
    if (files[0]) positioner.setFile(files[0]);
    ctx.updateSubmitState();
  }

  renderTyped();
}

export function onFiles(files) {
  if (files?.[0] && positioner) positioner.setFile(files[0]);
}

export function isReady() {
  return Boolean(signatureBlob) && Boolean(positioner);
}

export function buildBody(fd) {
  const box = positioner.getBoxes()[0];
  fd.set('options', JSON.stringify({ pageIndex: positioner.getPageIndex(), x: box.x, y: box.y, width: box.width, height: box.height }));
  fd.append('files', signatureBlob, 'signature.png');
}
