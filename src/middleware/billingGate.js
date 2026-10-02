import { isKeyBillingHealthy } from '../lib/billing.js';

/** Blocks submitting new jobs when a key's subscription is past_due/canceled/unpaid etc.
 *  Deliberately NOT applied to reading already-completed jobs/files, or to the billing
 *  endpoints themselves — a customer in a bad billing state still needs to be able to see
 *  their status and get a checkout/portal link to fix it. */
export function requireHealthyBilling(req, res, next) {
  if (!isKeyBillingHealthy(req.apiKey)) {
    return res.status(402).json({
      error: `Billing issue on this API key (status: ${req.apiKey.billing_status}). Resolve it via GET /api/v1/billing/status.`,
    });
  }
  next();
}
