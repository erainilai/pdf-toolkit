import { incrementDailyUsage, decrementDailyUsage, getDailyUsage } from '../lib/db.js';

/** Plan limits for the browser-facing API. Applied after multer has parsed the upload, so it
 *  can check file count and sizes, then atomically takes one task from today's allowance.
 *
 *  Quota subject: signed-in users are counted per account; guests are counted per IP address
 *  (not per cookie — clearing cookies would otherwise reset the limit). Days roll over in
 *  QUOTA_TIMEZONE (default Asia/Kolkata) so "daily" matches what most users expect. */

const TZ = process.env.QUOTA_TIMEZONE || 'Asia/Kolkata';
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const quotaSubject = (req) => (req.user ? `user:${req.user.id}` : `ip:${req.ip}`);

export async function usageToday(req) {
  return getDailyUsage(quotaSubject(req), today());
}

export class QuotaError extends Error {
  constructor(message, code) { super(message); this.status = 402; this.code = code; }
}

/** Checks files against the caller's plan. Throws QuotaError (HTTP 402) with an upgrade hint. */
export function checkFiles(req, files) {
  const { maxFiles, maxFileMB, label } = req.limits;
  if (files.length > maxFiles) {
    throw new QuotaError(`${label} plan allows up to ${maxFiles} files at once. Upgrade for larger batches.`, 'max_files');
  }
  const big = files.find((f) => f.size > maxFileMB * 1024 * 1024);
  if (big) {
    throw new QuotaError(`"${big.originalname}" is larger than the ${maxFileMB} MB limit on the ${label} plan. Upgrade for files up to 100 MB.`, 'file_size');
  }
}

/** Takes one task from today's allowance; returns a release() to give it back if the job
 *  could not be started or failed for reasons that aren't the user's fault. */
export async function takeTask(req) {
  const subject = quotaSubject(req);
  const day = today();
  const used = await incrementDailyUsage(subject, day);
  if (used > req.limits.tasksPerDay) {
    await decrementDailyUsage(subject, day);
    throw new QuotaError(
      req.tier === 'anon'
        ? `You've used today's ${req.limits.tasksPerDay} free tasks. Sign in for more, or get a Day Pass to keep going.`
        : `You've used today's ${req.limits.tasksPerDay} tasks on the ${req.limits.label} plan. Upgrade to keep going today.`,
      'daily_limit');
  }
  return () => decrementDailyUsage(subject, day);
}

/** Express middleware form for the legacy synchronous routes (/api/merge etc.). */
export function enforceQuota({ count = true } = {}) {
  return async (req, res, next) => {
    try {
      const files = req.files || (req.file ? [req.file] : []);
      checkFiles(req, files);
      if (count) await takeTask(req);
      next();
    } catch (err) {
      next(err);
    }
  };
}
