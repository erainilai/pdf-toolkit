import { Router } from 'express';
import express from 'express';
import { getStripe, billingEnabled } from '../lib/stripe.js';
import { applyWebhookEvent } from '../lib/billing.js';

const router = Router();

// Signature verification needs the raw request bytes, so this route uses express.raw()
// instead of the multer/JSON parsing the rest of the API uses — and is mounted directly on
// the app (server.js), not inside the apiKeyAuth-protected v1 router, since Stripe
// authenticates this request via signature, not an API key.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!billingEnabled()) return res.status(501).json({ error: 'Billing is not configured on this server.' });
  if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(501).json({ error: 'STRIPE_WEBHOOK_SECRET is not set.' });

  const stripe = await getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.header('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  try {
    applyWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe webhook] handler error:', err);
    res.status(500).json({ error: 'Webhook handler failed.' });
  }
});

export default router;
