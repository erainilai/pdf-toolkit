import { state, esc, money, fmtSize, fmtDate } from '../state.js';
import { getJSON, postJSON } from '../api.js';
import { toast } from '../app.js';

export async function renderAdmin(main) {
  if (!state.me?.user?.isAdmin) {
    main.innerHTML = '<div class="page-head"><h1>Not authorized</h1><p>This page is for admins only. <a href="#/">Back home</a>.</p></div>';
    return 'Not authorized';
  }

  main.innerHTML = '<div class="page-head"><h1>Admin</h1></div><div id="adminBody">Loading…</div>';
  await loadAndRender(main);
  return 'Admin';
}

async function loadAndRender(main) {
  const [usersRes, activityRes, revenueRes] = await Promise.all([
    getJSON('/api/admin/users'), getJSON('/api/admin/activity'), getJSON('/api/admin/revenue'),
  ]);
  const body = main.querySelector('#adminBody');
  const plans = state.config.plans;

  body.innerHTML = `
    <div class="account-grid">
      <section class="panel">
        <h2>Create user</h2>
        <form id="createUserForm" novalidate>
          <div class="field"><label for="auEmail">Email</label><input id="auEmail" name="email" type="email" required></div>
          <div class="field"><label for="auName">Name (optional)</label><input id="auName" name="name" type="text"></div>
          <p class="form-error" role="alert"></p>
          <button class="btn btn-primary btn-sm" type="submit">Create</button>
        </form>
        <div id="createUserResult"></div>
      </section>
      <section class="panel">
        <h2>Revenue</h2>
        ${revenueRes.summary.length
          ? revenueRes.summary.map((r) => `<p><b>${money(Number(r.total), r.currency)}</b> <span class="muted">(${r.count} payments, ${esc(r.provider)}, ${esc(r.currency)})</span></p>`).join('')
          : '<p class="muted">No revenue yet.</p>'}
        <h3 style="margin-top:16px">Recent payments</h3>
        ${revenueRes.recent.length ? `<table class="table"><thead><tr><th>Date</th><th>User</th><th>Plan</th><th>Amount</th><th>Provider</th></tr></thead><tbody>
          ${revenueRes.recent.map((p) => `<tr><td>${fmtDate(p.created_at)}</td><td>${esc(p.userEmail || '—')}</td><td>${esc(p.planId)}</td><td>${money(Number(p.amount), p.currency)}</td><td>${esc(p.provider)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No payments yet.</p>'}
      </section>
      <section class="panel" style="grid-column: 1 / -1">
        <h2>Users</h2>
        <table class="table"><thead><tr><th>Email</th><th>Name</th><th>Tier</th><th>Jobs</th><th>Joined</th><th>Grant a plan</th></tr></thead><tbody>
          ${usersRes.users.map((u) => `<tr data-user="${u.id}">
            <td>${esc(u.email)}${u.isAdmin ? ' <span class="pill">admin</span>' : ''}</td>
            <td>${esc(u.name || '—')}</td>
            <td><span class="pill ${u.tier === 'pro' || u.tier === 'daypass' ? 'paid' : ''}">${esc(u.tier)}</span></td>
            <td>${u.jobCount}</td>
            <td>${fmtDate(u.createdAt)}</td>
            <td>
              <select class="grantPlan">${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
              <button type="button" class="btn-text grantBtn">Grant</button>
            </td>
          </tr>`).join('')}
        </tbody></table>
      </section>
      <section class="panel" style="grid-column: 1 / -1">
        <h2>Recent activity</h2>
        ${activityRes.jobs.length ? `<table class="table"><thead><tr><th>Date</th><th>User</th><th>Tool</th><th>Status</th></tr></thead><tbody>
          ${activityRes.jobs.map((j) => `<tr><td>${fmtDate(j.created_at)}</td><td>${esc(j.userEmail || 'Guest / API')}</td><td>${esc(j.tool)}</td><td><span class="pill ${j.status === 'completed' ? 'paid' : j.status === 'failed' ? 'failed' : ''}">${esc(j.status)}</span></td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No activity yet.</p>'}
      </section>
    </div>`;

  body.querySelector('#createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('button[type=submit]');
    err.textContent = '';
    const payload = Object.fromEntries(new FormData(form));
    btn.disabled = true;
    try {
      const { user, password } = await postJSON('/api/admin/users', payload);
      body.querySelector('#createUserResult').innerHTML =
        `<div class="notice">Created <b>${esc(user.email)}</b>. Password (shown once — copy it now):<br><code>${esc(password)}</code></div>`;
      form.reset();
      await loadAndRender(main);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  body.querySelectorAll('.grantBtn').forEach((btn) => btn.addEventListener('click', async () => {
    const row = btn.closest('tr');
    const userId = row.dataset.user;
    const planId = row.querySelector('.grantPlan').value;
    btn.disabled = true;
    try {
      await postJSON(`/api/admin/users/${userId}/grant-plan`, { planId });
      toast('Plan granted.');
      await loadAndRender(main);
    } catch (ex) {
      toast(ex.message);
    } finally {
      btn.disabled = false;
    }
  }));
}
