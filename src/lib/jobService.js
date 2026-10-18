import { randomUUID } from 'node:crypto';
import { createJob, getJobForKey } from './db.js';
import { putObject, getObject, sanitizeKeySegment } from './storage.js';
import { enqueueJob } from './queue.js';

/** One job pipeline for both front doors — the keyed /api/v1 API and the browser app's
 *  /api/jobs. Inputs go to shared storage, the job row to the shared database, and the work
 *  to the queue, so any web replica can accept a job and any worker can run it. */

export const CONTENT_TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', zip: 'application/zip',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export async function submitJob({ ownerId, tool, files = [], options = {}, priority = false, quota }) {
  const id = randomUUID();
  const inputKeys = [];
  const originalNames = [];
  const mimetypes = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const key = `jobs/${id}/input/${i}-${sanitizeKeySegment(f.originalname)}`;
    await putObject(key, f.buffer);
    inputKeys.push(key);
    originalNames.push(f.originalname);
    mimetypes.push(f.mimetype);
  }
  await createJob({ id, apiKeyId: ownerId, tool });
  await enqueueJob({ id, tool, options, inputKeys, originalNames, mimetypes, apiKeyId: ownerId, quota }, { priority });
  return id;
}

/** Public JSON view of a job. `fileUrl(job, name)` builds the download link for the caller. */
export function jobView(job, fileUrl) {
  const out = { id: job.id, tool: job.tool, status: job.status, createdAt: job.created_at, updatedAt: job.updated_at };
  if (job.status === 'failed') out.error = job.error;
  if (job.status === 'expired') out.error = 'Result files were deleted after the retention period.';
  if (job.status === 'completed') {
    out.files = JSON.parse(job.result_files || '[]').map((f) => ({ name: f.name, size: f.size, url: fileUrl(job, f.name) }));
  }
  return out;
}

/** Streams one result file of a completed job owned by `ownerId`. */
export async function sendJobFile(res, { jobId, ownerId, name }) {
  const job = await getJobForKey(jobId, ownerId);
  if (!job || job.status !== 'completed') return res.status(404).json({ error: 'File not found.' });
  const file = JSON.parse(job.result_files || '[]').find((f) => f.name === name);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  const buffer = await getObject(file.storageKey);
  const ext = file.name.split('.').pop().toLowerCase();
  res.set('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.set('Cache-Control', 'private, no-store');
  res.send(buffer);
}
