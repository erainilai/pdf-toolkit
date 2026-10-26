import { postJSON } from '../api.js';
import { navigate } from '../app.js';

export function renderResetPassword(main, query) {
  const token = query?.get('token') || '';
  main.innerHTML = `
    <div class="page-head"><h1>Set a new password</h1></div>
    <div class="panel" style="max-width:420px">
      ${token ? `
      <form id="resetForm" novalidate>
        <div class="field"><label for="rNew">New password</label><input id="rNew" name="password" type="password" autocomplete="new-password" required minlength="8">
          <span class="hint">At least 8 characters.</span></div>
        <div class="field"><label for="rConfirm">Confirm new password</label><input id="rConfirm" name="passwordConfirm" type="password" autocomplete="new-password" required minlength="8"></div>
        <p class="form-error" role="alert"></p>
        <button class="btn btn-primary" type="submit">Set password</button>
      </form>` : `<p class="muted">This link is missing its token — use the reset link from your email, or <a href="#/">request a new one</a>.</p>`}
    </div>`;

  const form = main.querySelector('#resetForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('button[type=submit]');
    err.textContent = '';
    const body = Object.fromEntries(new FormData(form));
    if (body.password !== body.passwordConfirm) { err.textContent = 'Passwords don’t match.'; return; }
    btn.disabled = true;
    try {
      await postJSON('/api/auth/reset', { token, password: body.password });
      main.innerHTML = `<div class="page-head"><h1>Password updated</h1><p>You can now sign in with your new password.</p></div>`;
      setTimeout(() => navigate('#/'), 1500);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
  return 'Reset password';
}
