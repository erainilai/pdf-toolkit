import { Router } from 'express';
import express from 'express';
import { PLANS, CURRENCIES, BRAND, APP_URL } from '../config.js';
import { createPayment, setPaymentOrderId, getPayment, getPaymentByOrder, markPaymentStatus } from '../lib/db.js';
import { providerFor, fulfilPayment } from '../lib/payments/index.js';
import * as razorpay from '../lib/payments/razorpay.js';
import * as stripe from '../lib/payments/stripeCheckout.js';
import { createNamedLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const json = express.json({ limit: '20kb' });
const asHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const checkoutLimiter = createNamedLimiter({
  name: 'checkout', windowMs: 10 * 60_000, max: 20, message: 'Too many checkout attempts. Please wait a few minutes.',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Sign in to purchase a plan.', code: 'auth_required' }));
const baseUrl = (req) => APP_URL || `${req.protocol}://${req.get('host')}`;

/** Starts a purchase. INR → Razorpay (UPI/cards/netbanking); USD → Stripe Checkout.
 *  Prices always come from server config — the client only says which plan and currency. */
router.post('/', checkoutLimiter, json, requireUser, asHandler(async (req, res) => {
  const plan = PLANS[req.body?.planId];
  const currency = String(req.body?.currency || 'INR').toUpperCase();
  if (!plan) return res.status(400).json({ error: 'Unknown plan.' });
  if (!CURRENCIES[currency] || !plan.price[currency]) return res.status(400).json({ error: `This plan isn't sold in ${currency}.` });
  const provider = providerFor(currency);
  if (!provider) return res.status(503).json({ error: 'Payments are not configured on this server yet.' });

  const amount = plan.price[currency];
  const paymentId = await createPayment({ userId: req.user.id, provider, providerOrderId: null, planId: plan.id, amount, currency });

  if (provider === 'razorpay') {
    const order = await razorpay.createOrder({
      amount, currency, receipt: paymentId,
      notes: { paymentId, planId: plan.id, userId: req.user.id },
    });
    await setPaymentOrderId(paymentId, order.id);
    return res.json({
      provider, paymentId, keyId: razorpay.razorpayPublicKey(), orderId: order.id, amount, currency,
      name: BRAND.name, description: plan.name, prefill: { email: req.user.email, name: req.user.name || '' },
    });
  }

  const session = await stripe.createCheckoutSession({
    paymentId, plan, amount, currency, email: req.user.email, brandName: BRAND.name,
    successUrl: `${baseUrl(req)}/#/account?checkout=success&provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl(req)}/#/pricing?checkout=cancelled`,
  });
  await setPaymentOrderId(paymentId, session.id);
  res.json({ provider, paymentId, url: session.url });
}));

/** Razorpay Checkout success handler posts here. */
router.post('/razorpay/verify', json, requireUser, asHandler(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: providerPaymentId, razorpay_signature: signature } = req.body || {};
  const payment = await getPaymentByOrder('razorpay', orderId);
  if (!payment || payment.user_id !== req.user.id) return res.status(404).json({ error: 'Payment not found.' });
  if (!razorpay.verifyPaymentSignature({ orderId, paymentId: providerPaymentId, signature })) {
    await markPaymentStatus(payment.id, 'signature_failed', providerPaymentId);
    return res.status(400).json({ error: 'Payment verification failed. If money was deducted, it will be refunded automatically — contact support.' });
  }
  const captured = await razorpay.ensureCaptured(providerPaymentId, { amount: payment.amount, currency: payment.currency });
  if (captured.status !== 'captured') return res.status(402).json({ error: `Payment is ${captured.status}. Please try again.` });
  const { plan } = await fulfilPayment(payment.id, { providerPaymentId, amount: captured.amount, currency: captured.currency });
  res.json({ ok: true, plan: plan.id });
}));

/** Stripe redirects back with ?session_id — confirm immediately instead of waiting for the
 *  webhook (which still runs and is idempotent). */
router.get('/stripe/confirm', requireUser, asHandler(async (req, res) => {
  const session = await stripe.retrieveSession(String(req.query.session_id || ''));
  const paymentId = session?.metadata?.paymentId;
  const payment = paymentId && await getPayment(paymentId);
  if (!payment || payment.user_id !== req.user.id) return res.status(404).json({ error: 'Payment not found.' });
  if (session.payment_status !== 'paid') return res.json({ ok: false, status: session.payment_status });
  const { plan } = await fulfilPayment(paymentId, { providerPaymentId: session.payment_intent, amount: session.amount_total, currency: session.currency });
  res.json({ ok: true, plan: plan.id });
}));

export default router;

/** Razorpay webhook (mounted in server.js with a raw body parser, outside session/CSRF
 *  middleware). Subscribe to: order.paid, payment.captured, payment.failed. */
export const razorpayWebhook = [express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!razorpay.verifyWebhookSignature(req.body, req.header('x-razorpay-signature'))) {
    return res.status(400).json({ error: 'Invalid signature.' });
  }
  try {
    const event = JSON.parse(req.body.toString('utf8'));
    const pay = event.payload?.payment?.entity;
    const orderId = event.payload?.order?.entity?.id || pay?.order_id;
    const payment = orderId && await getPaymentByOrder('razorpay', orderId);
    if (payment) {
      if ((event.event === 'order.paid' || event.event === 'payment.captured') && pay?.status === 'captured') {
        await fulfilPayment(payment.id, { providerPaymentId: pay.id, amount: pay.amount, currency: pay.currency });
      } else if (event.event === 'payment.failed' && payment.status === 'created') {
        await markPaymentStatus(payment.id, 'failed', pay?.id);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[razorpay webhook]', err.message);
    res.status(500).json({ error: 'Webhook handler failed.' });
  }
}];
