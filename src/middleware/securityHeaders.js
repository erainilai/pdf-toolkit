/** Baseline security headers for the web app (what helmet would set, without the dependency).
 *  The CSP allows Razorpay Checkout's script and iframe; set CSP=off to disable while
 *  debugging, or CSP_EXTRA to append sources (e.g. an analytics domain). */
export function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")');
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (process.env.CSP !== 'off') {
    const extra = process.env.CSP_EXTRA ? ` ${process.env.CSP_EXTRA}` : '';
    res.set('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' https://checkout.razorpay.com${extra}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https://*.razorpay.com",
      `connect-src 'self' https://*.razorpay.com${extra}`,
      'frame-src https://api.razorpay.com https://checkout.razorpay.com',
      "form-action 'self' https://checkout.stripe.com",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '));
  }
  next();
}
