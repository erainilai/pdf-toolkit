import { getStripe, billingEnabled } from './stripe.js';
import { getApiKeyById, linkStripeCustomer, setBillingStatus, findApiKeyByStripeCustomer, markUsageReported } from './db.js';

const METER_EVENT_NAME = process.env.STRIPE_METER_EVENT_NAME || 'pdf_toolkit_jobs';
const METER_UNIT = process.env.STRIPE_METER_UNIT === 'bytes_out' ? 'bytes_out' : 'jobs';

// Keys in these statuses may keep using the API. 'none' = billing never set up for this key
// (unmetered/internal use); 'pending' = customer created but checkout not completed yet.
// Everything else (past_due, canceled, unpaid, incomplete_expired, paused, ...) is blocked.
const HEALTHY_STATUSES = new Set(['none', 'pending', 'active', 'trialing']);

export function isKeyBillingHealthy(apiKeyRow) {
  if (!billingEnabled()) return true;
  return HEALTHY_STATUSES.has(apiKeyRow.billing_status);
}

/** Creates (if needed) a Stripe customer for this key and returns a hosted Checkout Session
 *  URL for a metered subscription. Safe to call repeatedly — reuses the stored customer. */
export async function createCheckoutSessionForKey(apiKeyId, { email, successUrl, cancelUrl }) {
  const stripe = await getStripe();
  if (!stripe) throw new Error('Billing is not configured on this server.');
  if (!process.env.STRIPE_METERED_PRICE_ID) throw new Error('STRIPE_METERED_PRICE_ID is not set.');

  let apiKey = getApiKeyById(apiKeyId);
  if (!apiKey.stripe_customer_id) {
    const customer = await stripe.customers.create({ name: apiKey.name, email, metadata: { apiKeyId } });
    linkStripeCustomer(apiKeyId, customer.id);
    apiKey = getApiKeyById(apiKeyId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: apiKey.stripe_customer_id,
    line_items: [{ price: process.env.STRIPE_METERED_PRICE_ID }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { apiKeyId },
  });
  return session.url;
}

export async function getInvoicePreview(apiKeyId) {
  const stripe = await getStripe();
  if (!stripe) return null;
  const apiKey = getApiKeyById(apiKeyId);
  if (!apiKey.stripe_subscription_id) return null;
  return stripe.invoices.createPreview({ subscription: apiKey.stripe_subscription_id });
}

/** Reports one usage_events row to Stripe as a meter event. Never throws — a Stripe outage
 *  or misconfiguration must not fail the PDF job that already completed successfully. The
 *  usage_events row id is used as the Stripe idempotency identifier, so retries (e.g. a
 *  crashed worker re-running this) can't double-bill the same job. */
export async function reportJobUsage({ apiKeyId, usageEventId, bytesOut }) {
  if (!billingEnabled()) return;
  try {
    const stripe = await getStripe();
    const apiKey = getApiKeyById(apiKeyId);
    if (!apiKey?.stripe_customer_id) return;

    const value = METER_UNIT === 'bytes_out' ? bytesOut : 1;
    const identifier = `usage_${usageEventId}`;
    await stripe.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      identifier,
      payload: { stripe_customer_id: apiKey.stripe_customer_id, value: String(value) },
    });
    markUsageReported(usageEventId, identifier);
  } catch (err) {
    console.error(`[billing] failed to report usage event ${usageEventId}:`, err.message);
  }
}

/** Keeps api_keys.billing_status / stripe_subscription_id in sync with Stripe. Called from
 *  the webhook route (src/routes/stripeWebhook.js) for every relevant event type. */
export function applyWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const apiKeyId = session.metadata?.apiKeyId;
      if (apiKeyId) setBillingStatus(apiKeyId, 'active', { stripeSubscriptionId: session.subscription });
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const apiKey = findApiKeyByStripeCustomer(subscription.customer);
      if (apiKey) setBillingStatus(apiKey.id, subscription.status, { stripeSubscriptionId: subscription.id });
      break;
    }
    default:
      break;
  }
}
