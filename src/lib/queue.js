import { getRedisClient } from './redis.js';
import { runJob } from './jobRunner.js';

export const queueMode = process.env.REDIS_URL ? 'redis' : 'inline';

let bullQueue;
async function getBullQueue() {
  if (!bullQueue) {
    const { Queue } = await import('bullmq');
    bullQueue = new Queue('pdf-jobs', { connection: await getRedisClient() });
  }
  return bullQueue;
}

/** In 'redis' mode this hands the job to BullMQ so any number of worker processes
 *  (src/worker.js) can pick it up — that's the horizontal-scale path. In 'inline' mode
 *  (no REDIS_URL) it just runs the job in this process on the next tick, so the app keeps
 *  working with zero extra infrastructure for local/single-user use. */
export async function enqueueJob(payload) {
  if (queueMode === 'redis') {
    const queue = await getBullQueue();
    await queue.add('process', payload, { jobId: payload.id, removeOnComplete: 500, removeOnFail: 500 });
  } else {
    setImmediate(() => {
      runJob(payload).catch((err) => console.error(`[job ${payload.id}] failed:`, err.message));
    });
  }
}
