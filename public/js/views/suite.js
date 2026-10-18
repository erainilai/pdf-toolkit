import { TOOLS, suiteById } from '../catalog.js';
import { esc } from '../state.js';
import { toolLink } from './home.js';

export function renderSuite(main, id) {
  const suite = suiteById(id);
  if (!suite) { main.innerHTML = '<div class="page-head"><h1>Suite not found</h1><p><a href="#/">See all tools</a></p></div>'; return 'Not found'; }
  main.innerHTML = `
    <div class="page-head"><div class="crumbs"><a href="#/">All tools</a> / ${esc(suite.name)}</div>
      <h1>${esc(suite.name)}</h1><p>${esc(suite.blurb)}</p></div>
    <ul class="tool-list">${TOOLS.filter((t) => t.suite === id).map(toolLink).join('')}</ul>`;
  return suite.name;
}
