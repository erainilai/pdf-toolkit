import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import multer from 'multer';
import apiRouter from './src/routes/api.js';
import v1Router from './src/routes/v1.js';
import stripeWebhookRouter from './src/routes/stripeWebhook.js';
import { initDb } from './src/lib/db.js';
import { queueMode } from './src/lib/queue.js';
import { storageBackend } from './src/lib/storage.js';
import { billingEnabled } from './src/lib/stripe.js';
import { createPublicRateLimiter } from './src/middleware/rateLimiter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Behind a reverse proxy (Render, a load balancer, ...) set TRUST_PROXY to the number of proxy
// hops so req.ip — and therefore per-visitor rate limiting — sees the real client
// address instead of the proxy's. Leave unset when running locally.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
}

initDb();

app.get('/healthz', (req, res) => res.json({ ok: true, queueMode, storage: storageBackend(), billingEnabled: billingEnabled() }));
// Shows the requester only their own address as the app sees it — use it after deploying to
// check TRUST_PROXY is right: `ip` should be your real public IP, not a proxy's.
app.get('/healthz/ip', (req, res) => res.json({ ip: req.ip, ips: req.ips, xForwardedFor: req.get('x-forwarded-for') || null }));
app.use(express.static(join(__dirname, 'public')));
app.use('/api', createPublicRateLimiter(), apiRouter);
// Mounted before the authenticated v1 router — Stripe calls this directly, with no API key.
app.use('/api/v1/stripe', stripeWebhookRouter);
app.use('/api/v1', v1Router);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (200MB limit).' : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong.' });
});

const PORT = process.env.PORT || 4321;
app.listen(PORT, () => {
  console.log(`\n  PDF Toolkit running → http://localhost:${PORT}\n`);
});
