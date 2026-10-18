import { state, esc, money, fmtDate, fmtSize, refreshMe } from '../state.js';
import { getJSON } from '../api.js';
import { openAuth, signOut, toast } from '../app.js';
import { toolById } from '../catalog.js';

export async function renderAccount(main, query) {
  if (query?.get('checkout') === 'success' && query.get('provider') === 'stripe' && query.get('session_id')) {
    main.innerHTML = '<div class="page-head"><h1>Confirming your payment…</h1></div>';
    try {
      const r = await getJSON(`/api/checkout/stripe/confirm?session_id=${encodeURIComponent(query.get('session_id'))}`);
      toast(r.ok ? 'Payment received. Your plan is active.' : 'Payment is still processing — your plan will activate shortly.');
    } catch (err) { toast(err.message); }
    history.replaceState(null, '', '#/account');
  }
  await refreshMe();
  const me = state.me;
  if (!me?.user) {
    main.innerHTML = `<div class="page-head"><h1>Your account</h1><p>Sign in to see your plan, usage and receipts.</p></div>
      <button class="btn btn-primary" type="button" id="acctSignIn">Sign in</button>`;
    main.querySelector('#acctSignIn').addEventListener('click', () => openAuth('login'));
    return 'Account';
  }
  const paid = me.tier === 'pro' || me.tier === 'daypass';
  const pct = Math.min(100, (me.usage.today / me.limits.tasksPerDay) * 100);
  const byTool = me.history?.byTool || [];
  main.innerHTML = `
    <div class="page-head"><h1>${esc(me.user.name || 'Your account')}</h1><p>${esc(me.user.email)}</p></div>
    <div class="account-grid">
      <section class="panel">
        <h2>Plan</h2>
        <div class="plan-name">${esc(me.limits.label)}</div>
        <p class="muted">${paid ? `Active until ${fmtDate(me.tierEndsAt)}. Buying again adds time on top.` : 'Free forever. Upgrade any time for bigger files and more tasks.'}</p>
        <div>
          <span class="small"><b>${me.usage.remaining}</b> of ${me.limits.tasksPerDay} tasks left today</span>
          <div class="meter ${me.usage.remaining <= 2 ? 'low' : ''}"><i style="width:${pct}%"></i></div>
        </div>
        <div class="actions"><a class="btn ${paid ? 'btn-quiet' : 'btn-gold'} btn-sm" href="#/pricing">${paid ? 'Extend plan' : 'Upgrade'}</a>
          <button class="btn-text" type="button" id="signOut">Sign out</button></div>
      </section>
      <section class="panel">
        <h2>Last 30 days</h2>
        ${byTool.length ? `<table class="table"><thead><tr><th>Tool</th><th>Tasks</th><th>Processed</th></tr></thead><tbody>
          ${byTool.map((r) => `<tr><td>${esc(toolById(r.tool)?.name || r.tool)}</td><td>${r.jobs}</td><td>${fmtSize(Number(r.bytesIn) || 0)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Nothing yet. <a href="#/">Pick a tool</a> to get started.</p>'}
      </section>
      <section class="panel" style="grid-column: 1 / -1">
        <h2>Payments</h2>
        ${me.payments?.length ? `<table class="table"><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>
          ${me.payments.map((p) => `<tr><td>${fmtDate(p.created_at)}</td><td>${esc(planName(p.plan_id))}</td><td>${money(Number(p.amount), p.currency)}</td><td>${p.provider === 'razorpay' ? 'Razorpay' : 'Stripe'}</td><td><span class="pill ${esc(p.status)}">${esc(statusLabel(p.status))}</span></td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No payments yet.</p>'}
      </section>
    </div>`;
  main.querySelector('#signOut').addEventListener('click', signOut);
  return 'Account';
}

const planName = (id) => state.config.plans.find((p) => p.id === id)?.name || id;
const statusLabel = (s) => ({ paid: 'Paid', created: 'Not completed', failed: 'Failed', signature_failed: 'Failed', amount_mismatch: 'Under review' }[s] || s);
