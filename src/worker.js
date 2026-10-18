import { initDb } from './lib/db.js';
import { getRedisClient } from './lib/redis.js';
import { runJob } from './lib/jobRunner.js';
import { QUEUE_NAMES } from './lib/queue.js';
import { closeSql } from './lib/sql.js';

/** Standalone worker process for horizontal scaling: run `node src/worker.js` (or
 *  `npm run worker`) in as many containers/instances as you need. Only does anything
 *  when REDIS_URL is set — in inline mode the web process runs jobs itself.
 *
 *  WORKER_QUEUES picks what this process consumes: "standard", "heavy" (OCR, Office,
 *  background removal) or both (default). Run heavy workers on bigger machines and scale the
 *  two pools independently. */
async function main() {
  if (!process.env.REDIS_URL) {
    console.log('REDIS_URL is not set — jobs run inline inside the web process. Nothing for this worker to do.');
    return;
  }
  await initDb();
  const { Worker } = await import('bullmq');
  const connection = await getRedisClient();
  const kinds = String(process.env.WORKER_QUEUES || 'standard,heavy').split(',').map((s) => s.trim()).filter((k) => QUEUE_NAMES[k]);
  const workers = kinds.map((kind) => {
    const concurrency = Number(kind === 'heavy' ? process.env.WORKER_HEAVY_CONCURRENCY || 1 : process.env.WORKER_CONCURRENCY || 2);
    const w = new Worker(QUEUE_NAMES[kind], (job) => runJob(job.data), {
      connection, concurrency, lockDuration: kind === 'heavy' ? 300_000 : 60_000,
    });
    w.on('failed', (job, err) => console.error(`[${kind} job ${job?.id}] failed:`, err.message));
    console.log(`Worker consuming "${QUEUE_NAMES[kind]}" (concurrency=${concurrency})`);
    return w;
  });

  // Graceful shutdown: finish in-flight jobs, then exit (orchestrators send SIGTERM first).
  const stop = async (sig) => {
    console.log(`${sig} received — draining workers…`);
    await Promise.all(workers.map((w) => w.close()));
    await closeSql().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
