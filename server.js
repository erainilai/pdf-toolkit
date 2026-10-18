import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import multer from 'multer';
import apiRouter from './src/routes/api.js';
import v1Router from './src/routes/v1.js';
import stripeWebhookRouter from './src/routes/stripeWebhook.js';
import accountRouter from './src/routes/account.js';
import checkoutRouter, { razorpayWebhook } from './src/routes/checkout.js';
import { sessionContext, sameOriginOnly } from './src/middleware/session.js';
import { initDb } from './src/lib/db.js';
import { queueMode } from './src/lib/queue.js';
import { storageBackend } from './src/lib/storage.js';
import { billingEnabled } from './src/lib/stripe.js';
import { startRetentionSweeper } from './src/lib/retention.js';
import { securityHeaders } from './src/middleware/securityHeaders.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

await initDb();
startRetentionSweeper();
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0)); // set to 1 behind a load balancer so rate limits see real client IPs
app.use(securityHeaders);

app.get('/healthz', (req, res) => res.json({ ok: true, queueMode, storage: storageBackend(), billingEnabled: billingEnabled() }));
app.use(express.static(join(__dirname, 'public')));
// Webhooks: raw bodies for signature checks, no cookies/session, no CSRF origin check.
app.post('/api/webhooks/razorpay', razorpayWebhook);
// Mounted before the authenticated v1 router — Stripe calls this directly, with no API key.
app.use('/api/v1/stripe', stripeWebhookRouter);
app.use('/api/v1', v1Router);

// Browser app API: cookie session → origin check → routes.
app.use('/api', sessionContext, sameOriginOnly);
app.use('/api', accountRouter);
app.use('/api/checkout', checkoutRouter);
app.use('/api', apiRouter);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (${process.env.MAX_UPLOAD_MB || 100} MB limit).` : err.message;
    return res.status(400).json({ error: msg });
  }
  // QuotaError (src/lib/quota.js) carries its own status (402) and an upgrade-hint code.
  if (err.status === 402) return res.status(402).json({ error: err.message, code: err.code || 'upgrade_required' });
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong.' });
});

const PORT = process.env.PORT || 4321;
app.listen(PORT, () => {
  console.log(`\n  PDF Toolkit running → http://localhost:${PORT}\n`);
});
