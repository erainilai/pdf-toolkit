import { PLANS, CURRENCIES } from '../../config.js';
import { getPayment, markPaymentStatus, grantEntitlement } from '../db.js';
import { razorpayEnabled, razorpayPublicKey } from './razorpay.js';
import { stripeEnabled } from './stripeCheckout.js';

/** Provider registry + the one place a successful payment turns into a plan. Adding another
 *  gateway (Cashfree, PayU, Paddle…) = a new adapter file + an entry in CURRENCIES. */

export function enabledProviders() {
  const out = [];
  if (razorpayEnabled()) out.push('razorpay');
  if (stripeEnabled()) out.push('stripe');
  return out;
}
export const razorpayKeyId = () => razorpayPublicKey();

/** Picks the provider for a currency, falling back to any enabled provider that can charge it. */
export function providerFor(currency) {
  const preferred = CURRENCIES[currency]?.provider;
  const enabled = enabledProviders();
  if (preferred && enabled.includes(preferred)) return preferred;
  // Stripe can also charge INR (international cards) if Razorpay isn't configured.
  if (enabled.includes('stripe')) return 'stripe';
  return null;
}

/** Marks a payment paid and grants its plan. Safe to call any number of times, from the
 *  browser confirmation and from webhooks, in any order — the grant happens exactly once.
 *  Passing amount/currency asserts the provider charged exactly what we priced. */
export async function fulfilPayment(paymentId, { providerPaymentId, amount, currency } = {}) {
  const payment = await getPayment(paymentId);
  if (!payment) throw new Error(`Unknown payment ${paymentId}`);
  const plan = PLANS[payment.plan_id];
  if (payment.status === 'paid') return { payment, plan, granted: false }; // already fulfilled
  if (amount !== undefined && (Number(amount) !== Number(payment.amount) || String(currency).toUpperCase() !== payment.currency)) {
    await markPaymentStatus(paymentId, 'amount_mismatch', providerPaymentId);
    throw new Error(`Payment ${paymentId}: amount/currency mismatch`);
  }
  const granted = await grantEntitlement({ userId: payment.user_id, plan: plan.tier, days: plan.days, paymentId });
  await markPaymentStatus(paymentId, 'paid', providerPaymentId);
  return { payment, plan, granted };
}
