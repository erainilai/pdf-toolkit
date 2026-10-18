import { jobsToExpire, markJobExpired } from './db.js';
import { deletePrefix } from './storage.js';

/** Deletes job files after FILE_RETENTION_MINUTES (default 60) so the "we don't keep your
 *  files" promise is actually true. Inputs are already removed when a job finishes (see
 *  jobRunner.js); this sweeps the outputs. With S3, also add a bucket lifecycle rule on the
 *  "jobs/" prefix as a backstop. */
export function startRetentionSweeper() {
  const minutes = Number(process.env.FILE_RETENTION_MINUTES || 60);
  if (!minutes) return null;
  const sweep = async () => {
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
    try {
      for (const { id } of await jobsToExpire(cutoff)) {
        try {
          await deletePrefix(`jobs/${id}/`);
          await markJobExpired(id);
        } catch (err) {
          console.error(`retention: could not delete files for job ${id}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`retention: sweep failed: ${err.message}`);
    }
  };
  sweep();
  const timer = setInterval(sweep, Math.min(minutes, 10) * 60_000);
  timer.unref();
  return timer;
}
