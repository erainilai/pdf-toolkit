import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import multer from 'multer';
import apiRouter from './src/routes/api.js';
import v1Router from './src/routes/v1.js';
import stripeWebhookRouter from './src/routes/stripeWebhook.js';
import accountRouter from './src/routes/account.js';
import checkoutRouter, { razorpayWebhook } from './src/routes/checkout.js';
import webJobsRouter from './src/routes/webJobs.js';
import { sessionContext, sameOriginOnly } from './src/middleware/session.js';
import { initDb, deleteExpiredSessions, pruneDailyUsage } from './src/lib/db.js';
import { get as sqlGet, dialect, closeSql } from './src/lib/sql.js';
import { queueMode, inlineQueueStats, closeQueues } from './src/lib/queue.js';
import { getRedisClient } from './src/lib/redis.js';
import { storageBackend } from './src/lib/storage.js';
import { billingEnabled } from './src/lib/stripe.js';
import { enabledProviders } from './src/lib/payments/index.js';
import { startRetentionSweeper } from './src/lib/retention.js';
import { securityHeaders } from './src/middleware/securityHeaders.js';
import { BRAND } from './src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');

await initDb();
startRetentionSweeper();
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0)); // set to 1 behind a load balancer so rate limits see real client IPs

// Housekeeping that is safe to run on every replica (idempotent deletes).
const housekeeping = setInterval(() => {
  deleteExpiredSessions().catch(() => {});
  pruneDailyUsage(new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10)).catch(() => {});
}, 60 * 60_000);
housekeeping.unref();

app.use(securityHeaders);

/* Liveness: the process is up. Readiness: it can reach its dependencies (load balancers should
 * route traffic only to ready replicas). */
app.get('/healthz', (req, res) => res.json({
  ok: true, queueMode, storage: storageBackend(), database: dialect(),
  billingEnabled: billingEnabled(), payments: enabledProviders(),
  ...(queueMode === 'inline' ? { inlineQueue: inlineQueueStats() } : {}),
}));
let shuttingDown = false;
app.get('/readyz', async (req, res) => {
  if (shuttingDown) return res.status(503).json({ ready: false, reason: 'shutting down' });
  try {
    await sqlGet('SELECT 1 AS ok');
    const redis = await getRedisClient();
    if (redis) await redis.ping();
    res.json({ ready: true });
  } catch (err) {
    res.status(503).json({ ready: false, reason: err.message });
  }
});

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
app.use('/api/jobs', webJobsRouter);
app.use('/api', apiRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (${process.env.MAX_UPLOAD_MB || 100} MB limit).` : err.message;
    return res.status(400).json({ error: msg });
  }
  // QuotaError (src/lib/quota.js) carries its own status (402) and an upgrade-hint code.
  if (err.status === 402) return res.status(402).json({ error: err.message, code: err.code || 'upgrade_required' });
  console.error(`[${req.method} ${req.originalUrl}]`, err.message);
  // Tool errors are user-facing messages (bad page range, wrong password…). Infrastructure
  // errors are not — hide those details in production.
  const infra = /ECONN|ETIMEDOUT|SQLITE|relation |database|Razorpay|Stripe|socket/i.test(err.message || '');
  res.status(err.status && err.status < 500 ? err.status : infra ? 500 : 400).json({
    error: infra && process.env.NODE_ENV === 'production' ? 'Something went wrong on our side. Please try again.' : (err.message || 'Something went wrong.'),
  });
});

const PORT = process.env.PORT || 4321;
const server = app.listen(PORT, () => {
  console.log(`\n  ${BRAND.name} running → http://localhost:${PORT}  (db: ${dialect()}, queue: ${queueMode})\n`);
});
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 300_000);
server.keepAliveTimeout = 65_000; // longer than typical load balancer idle timeouts (60 s)

// Graceful shutdown: stop taking traffic (readyz → 503), finish in-flight requests, close pools.
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down gracefully…`);
  const force = setTimeout(() => process.exit(1), Number(process.env.SHUTDOWN_TIMEOUT_MS || 25_000));
  force.unref();
  server.close(async () => {
    await closeQueues().catch(() => {});
    await closeSql().catch(() => {});
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
