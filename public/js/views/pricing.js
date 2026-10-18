import { state, setCurrency, money, esc, refreshMe } from '../state.js';
import { postJSON, ApiError } from '../api.js';
import { openAuth, toast, navigate } from '../app.js';

let cycle = 'pro_yearly';

export function renderPricing(main, query) {
  if (query?.get('checkout') === 'cancelled') setTimeout(() => toast('Checkout cancelled — you weren’t charged.'), 50);
  draw(main);
  return 'Pricing';
}

function draw(main) {
  const { config, currency, me } = state;
  const plans = Object.fromEntries(config.plans.map((p) => [p.id, p]));
  const tiers = config.tiers;
  const currencies = Object.keys(config.currencies);
  const payable = currencies.length > 0;
  const price = (id) => (payable ? money(plans[id].price[currency], currency) : '—');
  const pro = plans[cycle];
  const monthly = plans.pro_yearly.price[currency] / 12;
  const perMonth = cycle === 'pro_yearly' && payable ? money(currency === 'INR' ? Math.round(monthly / 100) * 100 : Math.round(monthly), currency) : null;
  const tierNow = me?.tier;

  main.innerHTML = `
    <div class="pricing-head">
      <div><h1>Simple plans</h1><p>Use every tool free each day. Pay only when you need bigger files, batches or more tasks — no auto-renewal surprises.</p></div>
      ${currencies.length > 1 ? `<div class="toggle" role="group" aria-label="Currency">${currencies.map((c) => `<button type="button" data-cur="${c}" aria-pressed="${c === currency}">${c === 'INR' ? '₹ India' : '$ International'}</button>`).join('')}</div>` : ''}
    </div>
    ${payable ? '' : '<p class="notice">Payments aren’t switched on for this site yet. Add Razorpay and/or Stripe keys to enable checkout.</p>'}
    <div class="plans">
      <article class="plan">
        <h2>Free</h2>
        <div class="price">${payable ? money(0, currency) : 'Free'}</div>
        <p class="blurb">Every tool, every day. Sign in to double your daily tasks.</p>
        <ul>
          <li>${tiers.free.tasksPerDay} tasks a day (${tiers.anon.tasksPerDay} without an account)</li>
          <li>Files up to ${tiers.free.maxFileMB} MB</li>
          <li>Up to ${tiers.free.maxFiles} files at once</li>
          <li>OCR up to ${tiers.free.ocrPages} pages</li>
        </ul>
        ${me?.user ? `<span class="btn btn-quiet" aria-disabled="true">${tierNow === 'free' ? 'Your current plan' : 'Included'}</span>` : '<button class="btn btn-quiet" type="button" data-signup>Create free account</button>'}
      </article>
      <article class="plan">
        <h2>Day Pass</h2>
        <div class="price">${price('daypass')}<small> / 24 hours</small></div>
        <p class="blurb">${esc(plans.daypass.blurb)}</p>
        <ul>
          <li>${tiers.daypass.tasksPerDay} tasks in 24 hours</li>
          <li>Files up to ${tiers.daypass.maxFileMB} MB</li>
          <li>Up to ${tiers.daypass.maxFiles} files at once</li>
          <li>OCR up to ${tiers.daypass.ocrPages} pages, priority queue</li>
        </ul>
        <button class="btn btn-quiet" type="button" data-buy="daypass" ${payable ? '' : 'disabled'}>Buy Day Pass</button>
        <p class="fine">One-time payment</p>
      </article>
      <article class="plan featured">
        <span class="badge">Best for regular work</span>
        <h2>Pro</h2>
        <div class="cycle" role="group" aria-label="Billing period">
          <button type="button" data-cycle="pro_monthly" aria-pressed="${cycle === 'pro_monthly'}">Monthly</button>
          <button type="button" data-cycle="pro_yearly" aria-pressed="${cycle === 'pro_yearly'}">Yearly</button>
        </div>
        <div class="price">${price(cycle)}<small> / ${cycle === 'pro_yearly' ? 'year' : 'month'}</small></div>
        <p class="blurb">${perMonth ? `That’s ${perMonth} a month. ` : ''}${esc(pro.blurb)}</p>
        <ul>
          <li>${tiers.pro.tasksPerDay} tasks a day</li>
          <li>Files up to ${tiers.pro.maxFileMB} MB, ${tiers.pro.maxFiles} at once</li>
          <li>OCR up to ${tiers.pro.ocrPages} pages per task</li>
          <li>Priority processing</li>
        </ul>
        <button class="btn btn-primary" type="button" data-buy="${cycle}" ${payable ? '' : 'disabled'}>Get Pro</button>
        <p class="fine">Prepaid for ${pro.days} days · renew whenever you like</p>
      </article>
    </div>
    <p class="pay-methods">${currency === 'INR' ? 'Pay with UPI, cards, netbanking or wallets. Prices include GST.' : 'Pay with any major card, Apple Pay or Google Pay. Taxes may apply.'}
      Questions? See <a href="#/legal/refunds">refunds &amp; cancellation</a>.</p>`;

  main.querySelectorAll('[data-cur]').forEach((b) => b.addEventListener('click', () => { setCurrency(b.dataset.cur); draw(main); }));
  main.querySelectorAll('[data-cycle]').forEach((b) => b.addEventListener('click', () => { cycle = b.dataset.cycle; draw(main); }));
  main.querySelector('[data-signup]')?.addEventListener('click', () => openAuth('signup', { then: () => navigate('#/account') }));
  main.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buy(b.dataset.buy, b)));
}

async function buy(planId, btn) {
  if (!state.me?.user) {
    openAuth('signup', { reason: 'Create an account (or sign in) so your plan is saved to it.', then: () => buy(planId) });
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const order = await postJSON('/api/checkout', { planId, currency: state.currency });
    if (order.provider === 'stripe') { window.location.href = order.url; return; }
    await payWithRazorpay(order);
  } catch (err) {
    toast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new ApiError('Couldn’t load the payment window. Check your connection or disable blockers for this site.'));
    document.head.appendChild(s);
  });
}

async function payWithRazorpay(order) {
  await loadRazorpay();
  await new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: order.name,
      description: order.description,
      prefill: order.prefill,
      theme: { color: '#5865f2' },
      handler: async (resp) => {
        try {
          await postJSON('/api/checkout/razorpay/verify', resp);
          await refreshMe();
          toast('Payment received. Your plan is active.');
          navigate('#/account');
        } catch (err) {
          toast(err.message);
        }
        resolve();
      },
      modal: { ondismiss: resolve },
    });
    rzp.on('payment.failed', (r) => toast(r.error?.description || 'Payment failed. You weren’t charged.'));
    rzp.open();
  });
}
