import { getStripe, billingEnabled } from '../stripe.js';

/** Stripe Checkout (international cards, Apple/Google Pay) for one-time plan purchases.
 *  Uses inline price_data, so no products/prices need to be created in the dashboard. Shares
 *  STRIPE_SECRET_KEY and the existing webhook endpoint with the API metered billing. */

export const stripeEnabled = () => billingEnabled();

export async function createCheckoutSession({ paymentId, plan, amount, currency, email, successUrl, cancelUrl, brandName }) {
  const stripe = await getStripe();
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    client_reference_id: paymentId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: amount,
        product_data: { name: `${brandName} ${plan.name}`, description: plan.blurb },
      },
    }],
    metadata: { kind: 'web_plan', paymentId, planId: plan.id },
    payment_intent_data: { metadata: { kind: 'web_plan', paymentId, planId: plan.id } },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function retrieveSession(sessionId) {
  const stripe = await getStripe();
  return stripe.checkout.sessions.retrieve(sessionId);
}
