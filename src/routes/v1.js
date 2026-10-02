import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { apiKeyAuth } from '../middleware/auth.js';
import { requireHealthyBilling } from '../middleware/billingGate.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { TOOLS } from '../lib/jobRegistry.js';
import { createJob, getJobForKey, usageSummary } from '../lib/db.js';
import { putObject, getObject, sanitizeKeySegment } from '../lib/storage.js';
import { enqueueJob, queueMode } from '../lib/queue.js';
import { billingEnabled } from '../lib/stripe.js';
import { createCheckoutSessionForKey, getInvoicePreview } from '../lib/billing.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const router = Router();
const asHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const CONTENT_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', zip: 'application/zip', txt: 'text/plain; charset=utf-8' };

router.use(apiKeyAuth, createRateLimiter());

router.get('/tools', (req, res) => {
  res.json({ tools: Object.keys(TOOLS), queueMode });
});

router.get('/billing/status', (req, res) => {
  res.json({
    billingEnabled: billingEnabled(),
    status: req.apiKey.billing_status,
    hasStripeCustomer: Boolean(req.apiKey.stripe_customer_id),
  });
});

router.post('/billing/checkout-session', asHandler(async (req, res) => {
  if (!billingEnabled()) return res.status(501).json({ error: 'Billing is not configured on this server.' });
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const url = await createCheckoutSessionForKey(req.apiKey.id, {
    email: req.body?.email,
    successUrl: req.body?.successUrl || `${appUrl}/billing/success`,
    cancelUrl: req.body?.cancelUrl || `${appUrl}/billing/cancel`,
  });
  res.json({ url });
}));

router.get('/billing/invoice-preview', asHandler(async (req, res) => {
  if (!billingEnabled()) return res.status(501).json({ error: 'Billing is not configured on this server.' });
  const preview = await getInvoicePreview(req.apiKey.id);
  if (!preview) return res.status(404).json({ error: 'No active subscription for this key yet.' });
  res.json({ amountDue: preview.amount_due, currency: preview.currency, periodEnd: preview.period_end, lines: preview.lines.data.map((l) => ({ description: l.description, amount: l.amount, quantity: l.quantity })) });
}));

router.post('/jobs', requireHealthyBilling, upload.array('files', 50), asHandler(async (req, res) => {
  const { tool } = req.body;
  if (!TOOLS[tool]) {
    return res.status(400).json({ error: `Unknown tool "${tool}". See GET /api/v1/tools for the list.` });
  }
  if (!req.files?.length) {
    return res.status(400).json({ error: 'Upload at least one file in the "files" field.' });
  }
  let options = {};
  if (req.body.options) {
    try {
      options = JSON.parse(req.body.options);
    } catch {
      return res.status(400).json({ error: '"options" must be a valid JSON string.' });
    }
  }

  const id = randomUUID();
  const inputKeys = [];
  const originalNames = [];
  const mimetypes = [];
  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const key = `jobs/${id}/input/${i}-${sanitizeKeySegment(file.originalname)}`;
    await putObject(key, file.buffer);
    inputKeys.push(key);
    originalNames.push(file.originalname);
    mimetypes.push(file.mimetype);
  }

  createJob({ id, apiKeyId: req.apiKey.id, tool });
  await enqueueJob({ id, tool, options, inputKeys, originalNames, mimetypes, apiKeyId: req.apiKey.id });

  res.status(202).json({ id, status: 'queued', statusUrl: `/api/v1/jobs/${id}` });
}));

router.get('/jobs/:id', (req, res) => {
  const job = getJobForKey(req.params.id, req.apiKey.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  const result = { id: job.id, tool: job.tool, status: job.status, createdAt: job.created_at, updatedAt: job.updated_at };
  if (job.status === 'failed') result.error = job.error;
  if (job.status === 'completed') {
    result.files = JSON.parse(job.result_files || '[]').map((f) => ({
      name: f.name, size: f.size, url: `/api/v1/jobs/${job.id}/files/${encodeURIComponent(f.name)}`,
    }));
  }
  res.json(result);
});

router.get('/jobs/:id/files/:name', asHandler(async (req, res) => {
  const job = getJobForKey(req.params.id, req.apiKey.id);
  if (!job || job.status !== 'completed') return res.status(404).json({ error: 'File not found.' });

  const files = JSON.parse(job.result_files || '[]');
  const file = files.find((f) => f.name === req.params.name);
  if (!file) return res.status(404).json({ error: 'File not found.' });

  const buffer = await getObject(file.storageKey);
  const ext = file.name.split('.').pop().toLowerCase();
  res.set('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="${file.name}"`);
  res.send(buffer);
}));

router.get('/usage', (req, res) => {
  res.json(usageSummary(req.apiKey.id, Number(req.query.days) || 30));
});

export default router;
