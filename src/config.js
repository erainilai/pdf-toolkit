/** Commercial configuration in one place: brand, plans, prices and limits. Everything can be
 *  overridden with environment variables, so a rebrand or price change is a deploy-time
 *  setting rather than a code change. Prices are in the currency's minor unit (paise, cents). */

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const int = (k, d) => Number.parseInt(env(k, d), 10);

export const BRAND = {
  name: env('BRAND_NAME', 'PDF Toolkit'),
  tagline: env('BRAND_TAGLINE', 'Every document tool you need, in one place'),
  supportEmail: env('SUPPORT_EMAIL', 'support@example.com'),
  // Shown on the legal pages and checkout. Razorpay asks for these during account activation.
  legalName: env('LEGAL_NAME', 'Your Company Name'),
  address: env('LEGAL_ADDRESS', 'Your registered address, Tamil Nadu, India'),
  gstin: env('BUSINESS_GSTIN', ''),
};

/** Usage limits per tier. "anon" = not signed in, "free" = signed in without a paid plan. */
export const TIERS = {
  anon: { label: 'Guest', tasksPerDay: int('LIMIT_ANON_TASKS', 10), maxFileMB: int('LIMIT_ANON_FILE_MB', 20), maxFiles: int('LIMIT_ANON_FILES', 5), ocrPages: 3, priority: false },
  free: { label: 'Free', tasksPerDay: int('LIMIT_FREE_TASKS', 20), maxFileMB: int('LIMIT_FREE_FILE_MB', 25), maxFiles: int('LIMIT_FREE_FILES', 10), ocrPages: 5, priority: false },
  daypass: { label: 'Day Pass', tasksPerDay: int('LIMIT_PAID_TASKS', 500), maxFileMB: int('LIMIT_PAID_FILE_MB', 100), maxFiles: 50, ocrPages: 50, priority: true },
  pro: { label: 'Pro', tasksPerDay: int('LIMIT_PAID_TASKS', 500), maxFileMB: int('LIMIT_PAID_FILE_MB', 100), maxFiles: 50, ocrPages: 50, priority: true },
};

/** Purchasable products. Each grants `days` of a tier. Pro is sold as prepaid periods (works
 *  with UPI, which can't do card-style auto-renewal without a mandate); recurring billing can
 *  be added later on top of the same entitlement table. */
export const PLANS = {
  daypass: {
    id: 'daypass', tier: 'daypass', days: 1, name: 'Day Pass',
    blurb: 'Everything unlocked for 24 hours. Perfect for exam season or a one-off project.',
    price: { INR: int('PRICE_DAYPASS_INR', 4900), USD: int('PRICE_DAYPASS_USD', 299) },
  },
  pro_monthly: {
    id: 'pro_monthly', tier: 'pro', days: 30, name: 'Pro — Monthly',
    blurb: 'For regular work: bigger files, batch processing and priority processing.',
    price: { INR: int('PRICE_PRO_MONTHLY_INR', 19900), USD: int('PRICE_PRO_MONTHLY_USD', 699) },
  },
  pro_yearly: {
    id: 'pro_yearly', tier: 'pro', days: 365, name: 'Pro — Yearly',
    blurb: 'Best value — about 4 months free compared with monthly.',
    price: { INR: int('PRICE_PRO_YEARLY_INR', 149900), USD: int('PRICE_PRO_YEARLY_USD', 4999) },
  },
};

export const CURRENCIES = {
  INR: { symbol: '₹', provider: 'razorpay', note: 'Inclusive of GST' },
  USD: { symbol: '$', provider: 'stripe', note: 'Taxes may apply' },
};

export const SESSION_TTL_DAYS = int('SESSION_TTL_DAYS', 30);
export const APP_URL = env('APP_URL', '');
