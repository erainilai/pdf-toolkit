import { Router } from 'express';
import multer from 'multer';
import { apiKeyAuth } from '../middleware/auth.js';
import { requireHealthyBilling } from '../middleware/billingGate.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { TOOLS, minFilesFor } from '../lib/jobRegistry.js';
import { getJobForKey, usageSummary } from '../lib/db.js';
import { submitJob, jobView, sendJobFile } from '../lib/jobService.js';
import { queueMode } from '../lib/queue.js';
import { billingEnabled } from '../lib/stripe.js';
import { createCheckoutSessionForKey, getInvoicePreview } from '../lib/billing.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024, files: 50 } });
const router = Router();
const asHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

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
  const min = minFilesFor(tool);
  if ((req.files?.length || 0) < min) {
    return res.status(400).json({ error: `Upload at least ${min} file(s) in the "files" field.` });
  }
  let options = {};
  if (req.body.options) {
    try {
      options = JSON.parse(req.body.options);
    } catch {
      return res.status(400).json({ error: '"options" must be a valid JSON string.' });
    }
  }

  const id = await submitJob({ ownerId: req.apiKey.id, tool, files: req.files || [], options });
  res.status(202).json({ id, status: 'queued', statusUrl: `/api/v1/jobs/${id}` });
}));

router.get('/jobs/:id', asHandler(async (req, res) => {
  const job = await getJobForKey(req.params.id, req.apiKey.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(jobView(job, (j, name) => `/api/v1/jobs/${j.id}/files/${encodeURIComponent(name)}`));
}));

router.get('/jobs/:id/files/:name', asHandler(async (req, res) => {
  await sendJobFile(res, { jobId: req.params.id, ownerId: req.apiKey.id, name: req.params.name });
}));

router.get('/usage', asHandler(async (req, res) => {
  res.json(await usageSummary(req.apiKey.id, Number(req.query.days) || 30));
}));

export default router;
