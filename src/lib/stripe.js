let client;

export function billingEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Lazily constructs the Stripe client so the app still boots with zero config when billing
 *  isn't set up — billing-dependent routes just respond 501 until STRIPE_SECRET_KEY is set. */
export async function getStripe() {
  if (!billingEnabled()) return null;
  if (!client) {
    const { default: Stripe } = await import('stripe');
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}
