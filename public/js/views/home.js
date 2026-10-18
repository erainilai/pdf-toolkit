import { SUITES, TOOLS, toolsForFile } from '../catalog.js';
import { state, esc } from '../state.js';
import { openSearch } from '../app.js';
import { stashFiles } from './tool.js';

const SEARCH_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="m13.5 13.5 4 4"/></svg>';

export function toolLink(t) {
  const local = t.browserOnly ? '<span class="tag tag-local">In your browser</span>' : '';
  return `<li><a class="tool-link" href="#/tool/${t.id}"><span class="name">${esc(t.name)}${local}</span><span class="stamp">${esc(t.formats)}</span><span class="desc">${esc(t.desc)}</span></a></li>`;
}

export function renderHome(main) {
  const popular = TOOLS.filter((t) => t.popular);
  main.innerHTML = `
    <section class="finder">
      <div>
        <h1>${esc(state.config.brand.tagline)}</h1>
        <p class="lede">PDF, Word, Excel and photos — plus exam photo sizes, Tamil OCR and GST invoices. No software to install.</p>
        <div class="finder-search">
          ${SEARCH_ICON}
          <input type="search" id="homeSearch" placeholder="What do you need to do?" aria-label="Find a tool" autocomplete="off">
        </div>
        <div class="quick" aria-label="Popular tools">
          ${popular.map((t) => `<a href="#/tool/${t.id}">${esc(t.name)}</a>`).join('')}
        </div>
      </div>
      <div class="drop-desk" id="desk">
        <h2>Drop a file here</h2>
        <p>We'll show the tools that work with it. Nothing is uploaded until you pick one.</p>
        <button class="btn btn-quiet" type="button" id="deskPick">Choose a file</button>
        <input type="file" id="deskInput" hidden>
        <div class="suggest" id="suggest" aria-live="polite"></div>
      </div>
    </section>
    ${SUITES.map((s) => `
      <section class="suite" aria-labelledby="s-${s.id}">
        <div class="suite-head"><h2 id="s-${s.id}"><a href="#/suite/${s.id}">${esc(s.name)}</a></h2><p>${esc(s.blurb)}</p></div>
        <ul class="tool-list">${TOOLS.filter((t) => t.suite === s.id).map(toolLink).join('')}</ul>
      </section>`).join('')}`;

  const search = main.querySelector('#homeSearch');
  search.addEventListener('keydown', (e) => {
    if (e.key.length === 1 || e.key === 'Enter') { e.preventDefault(); openSearch(e.key.length === 1 ? search.value + e.key : search.value); }
  });
  search.addEventListener('focus', () => { if (window.matchMedia('(pointer: coarse)').matches) { search.blur(); openSearch(); } });

  const desk = main.querySelector('#desk');
  const input = main.querySelector('#deskInput');
  main.querySelector('#deskPick').addEventListener('click', () => input.click());
  input.addEventListener('change', () => suggest([...input.files]));
  ['dragenter', 'dragover'].forEach((ev) => desk.addEventListener(ev, (e) => { e.preventDefault(); desk.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((ev) => desk.addEventListener(ev, (e) => { e.preventDefault(); desk.classList.remove('dragging'); }));
  desk.addEventListener('drop', (e) => suggest([...e.dataTransfer.files]));

  function suggest(files) {
    const out = main.querySelector('#suggest');
    if (!files.length) return;
    const tools = toolsForFile(files[0]);
    const label = files.length > 1 ? `${files.length} files` : files[0].name;
    out.innerHTML = tools.length
      ? `<p class="suggest-file">${esc(label)}</p><ul>${tools.slice(0, 5).map((t) => `<li><a href="#/tool/${t.id}" data-tool="${t.id}"><span>${esc(t.name)}</span><span class="stamp">${esc(t.formats)}</span></a></li>`).join('')}</ul>`
      : `<p class="suggest-file">${esc(label)}</p><p>We don't have a tool for this file type yet. Try PDF, Word, Excel or an image.</p>`;
    out.querySelectorAll('a[data-tool]').forEach((a) => a.addEventListener('click', () => stashFiles(files)));
  }
  return '';
}
