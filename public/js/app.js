import { SUITES, searchTools } from './catalog.js';
import { state, loadConfig, refreshMe, onChange, esc } from './state.js';
import { postJSON } from './api.js';
import { renderHome } from './views/home.js';
import { renderSuite } from './views/suite.js';
import { renderTool, leaveTool } from './views/tool.js';
import { renderPricing } from './views/pricing.js';
import { renderAccount } from './views/account.js';
import { renderLegal, renderDevelopers } from './views/legal.js';
import { renderResetPassword } from './views/resetPassword.js';

const main = document.getElementById('main');

/* ---------------- Toast ---------------- */
let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ---------------- Router ---------------- */
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(query) };
}

export const navigate = (hash) => { location.hash = hash; };

async function route() {
  leaveTool();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const { parts, query } = parseRoute();
  const [head, arg] = parts;
  let title = '';
  main.innerHTML = '';
  if (!head) title = renderHome(main);
  else if (head === 'suite') title = renderSuite(main, arg);
  else if (head === 'tool') title = renderTool(main, arg);
  else if (head === 'pricing') title = renderPricing(main, query);
  else if (head === 'account') title = await renderAccount(main, query);
  else if (head === 'legal') title = renderLegal(main, arg);
  else if (head === 'developers') title = renderDevelopers(main);
  else if (head === 'reset-password') title = renderResetPassword(main, query);
  else title = renderNotFound();
  document.title = title ? `${title} — ${state.config.brand.name}` : `${state.config.brand.name} — PDF, Office, image and Tamil document tools`;
  highlightSuite(head === 'suite' ? arg : head === 'tool' ? main.dataset.suite : null);
  window.scrollTo(0, 0);
  if (head) main.focus({ preventScroll: true });
}

function renderNotFound() {
  main.innerHTML = `<div class="page-head"><h1>That page doesn't exist</h1><p>Try searching for the tool you need, or <a href="#/">go to all tools</a>.</p></div>`;
  return 'Not found';
}

/* ---------------- Shell ---------------- */
function renderNav() {
  document.getElementById('suiteNav').innerHTML = SUITES.map((s) => `<a href="#/suite/${s.id}" data-suite="${s.id}">${esc(s.name)}</a>`).join('');
}
function highlightSuite(id) {
  document.querySelectorAll('#suiteNav a').forEach((a) => {
    if (a.dataset.suite === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function renderAccountSlot() {
  const slot = document.getElementById('accountSlot');
  const me = state.me;
  if (me?.user) {
    const initial = (me.user.name || me.user.email).trim()[0].toUpperCase();
    const tier = me.tier === 'pro' || me.tier === 'daypass' ? `<span class="tier">${esc(me.limits.label)}</span>` : '';
    slot.innerHTML = `<a class="account-chip" href="#/account"><span class="avatar">${esc(initial)}</span><span class="name">${esc(me.user.name || 'Account')}</span>${tier}</a>`;
  } else {
    slot.innerHTML = '<button class="btn btn-quiet btn-sm" type="button" id="signInBtn">Sign in</button>';
    slot.querySelector('#signInBtn').addEventListener('click', () => openAuth('login'));
  }
}

function applyBrand() {
  document.querySelectorAll('[data-brand]').forEach((el) => { el.textContent = state.config.brand.name; });
}

/* ---------------- Search ---------------- */
const searchDialog = document.getElementById('searchDialog');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
let selected = 0;

export function openSearch(prefill = '') {
  searchInput.value = prefill;
  renderResults();
  searchDialog.showModal();
  searchInput.focus();
}
function renderResults() {
  const q = searchInput.value.trim();
  const list = q ? searchTools(q).slice(0, 8) : [];
  selected = 0;
  if (!q) {
    searchResults.innerHTML = '<li class="empty">Type what you want to do — for example “compress”, “word to pdf” or “bamini”.</li>';
    return;
  }
  searchResults.innerHTML = list.length
    ? list.map((t, i) => `<li><a href="#/tool/${t.id}" role="option" aria-selected="${i === 0}"><span class="name">${esc(t.name)}</span><span class="stamp">${esc(t.formats)}</span><span class="desc">${esc(t.desc)}</span></a></li>`).join('')
    : `<li class="empty">No tool matches “${esc(q)}”. Try a file type like PDF, JPG or Excel.</li>`;
}
searchInput.addEventListener('input', renderResults);
searchInput.addEventListener('keydown', (e) => {
  // type=search clears its value on Escape instead of letting the dialog close; close it ourselves.
  if (e.key === 'Escape') { e.preventDefault(); searchDialog.close(); return; }
  const links = [...searchResults.querySelectorAll('a')];
  if (!links.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links.forEach((a, i) => a.setAttribute('aria-selected', String(i === selected)));
    links[selected].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    location.hash = links[selected].getAttribute('href');
    searchDialog.close();
  }
});
searchResults.addEventListener('click', (e) => { if (e.target.closest('a')) searchDialog.close(); });
searchDialog.addEventListener('click', (e) => { if (e.target === searchDialog) searchDialog.close(); });
document.getElementById('searchTrigger').addEventListener('click', () => openSearch());
document.addEventListener('keydown', (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    openSearch();
  }
});

/* ---------------- Sign in / sign up ---------------- */
const authDialog = document.getElementById('authDialog');
let afterAuth = null;

export function openAuth(mode = 'login', { then, reason } = {}) {
  afterAuth = then || null;
  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  authDialog.innerHTML = `
    <button class="modal-close" type="button" aria-label="Close">×</button>
    <form class="modal-body" novalidate>
      <h2 id="authTitle">${isForgot ? 'Reset your password' : isSignup ? 'Create your account' : 'Sign in'}</h2>
      ${reason ? `<p class="muted">${esc(reason)}</p>` : ''}
      ${isForgot ? '' : `
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${!isSignup}" data-mode="login">Sign in</button>
        <button type="button" role="tab" aria-selected="${isSignup}" data-mode="signup">Create account</button>
      </div>`}
      ${isForgot ? '<p class="muted">Enter your account email and we’ll send a link to set a new password.</p>' : ''}
      ${isSignup ? '<div class="field"><label for="aName">Name</label><input id="aName" name="name" type="text" autocomplete="name"></div>' : ''}
      <div class="field"><label for="aEmail">Email</label><input id="aEmail" name="email" type="email" autocomplete="email" required></div>
      ${isForgot ? '' : `
      <div class="field"><label for="aPass">Password</label><input id="aPass" name="password" type="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" required minlength="8">
        ${isSignup ? '<span class="hint">At least 8 characters.</span>' : ''}</div>
      ${isSignup ? '<div class="field"><label for="aPassConfirm">Confirm password</label><input id="aPassConfirm" name="passwordConfirm" type="password" autocomplete="new-password" required minlength="8"></div>' : ''}`}
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary" type="submit">${isForgot ? 'Send reset link' : isSignup ? 'Create account' : 'Sign in'}</button>
      ${isForgot
        ? '<p class="small muted"><button type="button" class="btn-text" data-mode="login">Back to sign in</button></p>'
        : isSignup
          ? `<p class="small muted">By creating an account you agree to the <a href="#/legal/terms">terms</a> and <a href="#/legal/privacy">privacy policy</a>.</p>`
          : '<p class="small muted"><button type="button" class="btn-text" data-mode="forgot">Forgot password?</button> · Free accounts get double the daily tasks of guests.</p>'}
    </form>`;
  authDialog.querySelector('.modal-close').addEventListener('click', () => authDialog.close());
  authDialog.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => openAuth(b.dataset.mode, { then: afterAuth, reason })));
  const form = authDialog.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('button[type=submit]');
    err.textContent = '';
    const body = Object.fromEntries(new FormData(form));
    if (isForgot) {
      if (!body.email) { err.textContent = 'Enter your email.'; return; }
      btn.disabled = true;
      try {
        await postJSON('/api/auth/forgot', { email: body.email });
        authDialog.close();
        toast('If that email has an account, a reset link is on its way.');
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
      return;
    }
    if (!body.email || !body.password) { err.textContent = 'Enter your email and password.'; return; }
    if (isSignup && body.password !== body.passwordConfirm) { err.textContent = 'Passwords don’t match.'; return; }
    delete body.passwordConfirm;
    btn.disabled = true;
    try {
      await postJSON(isSignup ? '/api/auth/signup' : '/api/auth/login', body);
      authDialog.close();
      await refreshMe();
      toast(isSignup ? 'Account created. You’re signed in.' : 'Signed in.');
      const fn = afterAuth; afterAuth = null;
      if (fn) fn(); else route();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });
  if (!authDialog.open) authDialog.showModal();
  authDialog.querySelector(isSignup ? '#aName' : '#aEmail').focus();
}

export async function signOut() {
  await postJSON('/api/auth/logout');
  await refreshMe();
  toast('Signed out.');
  navigate('#/');
}

/* ---------------- Upgrade prompt (402 from the API) ---------------- */
const upgradeDialog = document.getElementById('upgradeDialog');
export function openUpgrade(message) {
  const signedIn = !!state.me?.user;
  upgradeDialog.innerHTML = `
    <button class="modal-close" type="button" aria-label="Close">×</button>
    <div class="modal-body">
      <h2 id="upgradeTitle">You've reached a plan limit</h2>
      <p class="muted">${esc(message)}</p>
      <div class="actions">
        <a class="btn btn-gold" href="#/pricing">See plans</a>
        ${signedIn ? '' : '<button class="btn btn-quiet" type="button" id="upSignIn">Sign in</button>'}
      </div>
    </div>`;
  upgradeDialog.querySelector('.modal-close').addEventListener('click', () => upgradeDialog.close());
  upgradeDialog.querySelector('a').addEventListener('click', () => upgradeDialog.close());
  upgradeDialog.querySelector('#upSignIn')?.addEventListener('click', () => { upgradeDialog.close(); openAuth('signup', { then: () => route() }); });
  upgradeDialog.showModal();
}

[authDialog, upgradeDialog].forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

/* ---------------- Boot ---------------- */
async function boot() {
  try {
    await loadConfig();
  } catch {
    main.innerHTML = '<div class="page-head"><h1>We can’t reach the server</h1><p>Check your connection and reload the page.</p></div>';
    return;
  }
  applyBrand();
  renderNav();
  onChange(renderAccountSlot);
  await refreshMe();
  window.addEventListener('hashchange', route);
  route();
}
boot();
