import { initDb } from './lib/db.js';
import { getRedisClient } from './lib/redis.js';
import { runJob } from './lib/jobRunner.js';

/** Standalone worker process for horizontal scaling: run `node src/worker.js` (or
 *  `npm run worker`) in as many containers/instances as you need. Only does anything
 *  when REDIS_URL is set — in inline mode the web process runs jobs itself. */
async function main() {
  if (!process.env.REDIS_URL) {
    console.log('REDIS_URL is not set — jobs run inline inside the web process. Nothing for this worker to do.');
    return;
  }
  initDb();
  const { Worker } = await import('bullmq');
  const connection = await getRedisClient();
  const concurrency = Number(process.env.WORKER_CONCURRENCY || 2);
  const worker = new Worker('pdf-jobs', (job) => runJob(job.data), { connection, concurrency });

  worker.on('completed', (job) => console.log(`[job ${job.id}] completed`));
  worker.on('failed', (job, err) => console.error(`[job ${job?.id}] failed:`, err.message));
  console.log(`Worker listening on ${process.env.REDIS_URL} (concurrency=${concurrency})`);
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
