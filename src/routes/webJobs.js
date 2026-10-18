import { Router } from 'express';
import multer from 'multer';
import { TOOLS, minFilesFor } from '../lib/jobRegistry.js';
import { getJobForKey } from '../lib/db.js';
import { submitJob, jobView, sendJobFile } from '../lib/jobService.js';
import { checkFiles, takeTask, quotaSubject, today } from '../lib/quota.js';

/** Asynchronous job API for the browser app: submit → poll → download.
 *  Long OCR/Office conversions never hold an HTTP request open (load balancers typically cut
 *  those at 30–60 s), and the work runs on whichever worker is free. Jobs belong to the caller
 *  ("user:<id>" or "anon:<visitor cookie>"), so nobody can read anyone else's results. */

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024, files: 50 } });
const router = Router();
const asHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.post('/', upload.array('files', 50), asHandler(async (req, res) => {
  const tool = req.body.tool;
  if (!TOOLS[tool]) return res.status(400).json({ error: `Unknown tool "${tool}".` });
  const files = req.files || [];
  const min = minFilesFor(tool);
  if (files.length < min) return res.status(400).json({ error: min > 1 ? `Add at least ${min} files.` : 'Add a file first.' });

  let options = {};
  if (req.body.options) {
    try { options = JSON.parse(req.body.options); } catch { return res.status(400).json({ error: '"options" must be valid JSON.' }); }
  }
  if (tool === 'ocr') options.maxPages = req.limits.ocrPages; // plan-dependent, never client-controlled

  checkFiles(req, files);
  const release = await takeTask(req);
  try {
    const id = await submitJob({
      ownerId: req.ownerId, tool, files, options,
      priority: req.limits.priority,
      quota: { subject: quotaSubject(req), day: today() },
    });
    res.status(202).json({ id, status: 'queued' });
  } catch (err) {
    await release();
    throw err;
  }
}));

router.get('/:id', asHandler(async (req, res) => {
  const job = await getJobForKey(req.params.id, req.ownerId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.set('Cache-Control', 'no-store');
  res.json(jobView(job, (j, name) => `/api/jobs/${j.id}/files/${encodeURIComponent(name)}`));
}));

router.get('/:id/files/:name', asHandler(async (req, res) => {
  await sendJobFile(res, { jobId: req.params.id, ownerId: req.ownerId, name: req.params.name });
}));

export default router;
