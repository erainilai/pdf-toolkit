import { FONTS, legacyToUnicode, unicodeToLegacy } from '../lib/tamilFonts.js';

/* Tamil font converter — pure browser tool, converts as you type. */

export function mount(container, ctx) {
  const fontOpts = Object.entries(FONTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  container.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Direction</label>
        <select id="tfDir">
          <option value="to-unicode">Legacy font → Unicode</option>
          <option value="to-legacy">Unicode → Legacy font</option>
        </select>
      </div>
      <div class="field"><label>Font</label><select id="tfFont">${fontOpts}</select></div>
    </div>
    <div class="field"><label id="tfInLabel">Paste text typed in Bamini (looks like "jkpo;ehL")</label>
      <textarea id="tfIn" rows="7" placeholder="jkpo;ehL muR"></textarea></div>
    <div class="field"><label>Result</label><textarea id="tfOut" rows="7" readonly></textarea></div>
    <div><button class="secondary-btn" id="tfCopy" type="button">Copy result</button>
      <button class="secondary-btn" id="tfSave" type="button">Download .txt</button></div>
    <div class="hint">Tip: in Word, select the Bamini text and copy it here — the font name doesn't come along, only the letters.</div>`;

  const $ = (id) => container.querySelector(id);
  const run = () => {
    const dir = $('#tfDir').value;
    const font = $('#tfFont').value;
    $('#tfInLabel').textContent = dir === 'to-unicode'
      ? `Paste text typed in ${FONTS[font]} (looks like "jkpo;ehL")`
      : 'Paste Unicode Tamil text (தமிழ்)';
    try {
      $('#tfOut').value = dir === 'to-unicode' ? legacyToUnicode($('#tfIn').value, font) : unicodeToLegacy($('#tfIn').value, font);
    } catch (err) {
      ctx.setStatus(err.message, 'error');
    }
  };
  ['#tfIn', '#tfDir', '#tfFont'].forEach((id) => $(id).addEventListener('input', run));
  $('#tfCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#tfOut').value);
      ctx.setStatus('Copied.', 'ok');
    } catch {
      $('#tfOut').select();
      ctx.setStatus('Press Ctrl+C to copy.', '');
    }
  });
  $('#tfSave').addEventListener('click', () => {
    ctx.showDownload(new Blob(['﻿', $('#tfOut').value], { type: 'text/plain;charset=utf-8' }), 'tamil_converted.txt');
  });
}
