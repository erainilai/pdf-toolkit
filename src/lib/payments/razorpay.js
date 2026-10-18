import { createHmac, timingSafeEqual } from 'node:crypto';

/** Razorpay (India: UPI, cards, netbanking, wallets) over its REST API — no SDK needed.
 *  Flow: server creates an Order → browser opens Razorpay Checkout with the order id → on
 *  success the browser posts back {order_id, payment_id, signature}; the server verifies the
 *  signature with the key secret, makes sure the payment is captured, then grants the plan.
 *  The `order.paid` / `payment.captured` webhook does the same grant as a backstop (e.g. the
 *  user closed the tab after paying). */

// RAZORPAY_API_BASE exists for integration tests against a local mock.
const API = process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1';
const keyId = () => process.env.RAZORPAY_KEY_ID;
const keySecret = () => process.env.RAZORPAY_KEY_SECRET;

export const razorpayEnabled = () => Boolean(keyId() && keySecret());
export const razorpayPublicKey = () => (razorpayEnabled() ? keyId() : null);

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.description || `HTTP ${res.status}`;
    throw new Error(`Razorpay: ${msg}`);
  }
  return data;
}

export function createOrder({ amount, currency, receipt, notes }) {
  return call('POST', '/orders', { amount, currency, receipt, notes });
}

const safeEqualHex = (a, b) => {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  return A.length === B.length && timingSafeEqual(A, B);
};

/** Signature returned to Checkout's success handler: HMAC-SHA256("order_id|payment_id", key secret). */
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const expected = createHmac('sha256', keySecret()).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC-SHA256(raw request body, webhook secret) in X-Razorpay-Signature. */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Makes sure a payment is captured (accounts without auto-capture leave payments
 *  "authorized", which are refunded automatically after a few days). Returns the payment. */
export async function ensureCaptured(paymentId, { amount, currency }) {
  let payment = await call('GET', `/payments/${encodeURIComponent(paymentId)}`);
  if (payment.status === 'authorized') {
    payment = await call('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency });
  }
  return payment;
}
