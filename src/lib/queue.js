import { getRedisClient } from './redis.js';
import { runJob } from './jobRunner.js';

export const queueMode = process.env.REDIS_URL ? 'redis' : 'inline';

/** Tools that hold a CPU core (or a LibreOffice process) for seconds to minutes go to their
 *  own queue, so a burst of OCR or Office conversions can't starve quick merges/rotations.
 *  Run dedicated workers for it with WORKER_QUEUES=heavy (see src/worker.js). */
export const HEAVY_TOOLS = new Set(['ocr', 'office-to-pdf', 'pdf-to-word', 'pdf-to-powerpoint', 'remove-background']);
export const QUEUE_NAMES = { standard: 'pdf-jobs', heavy: 'pdf-jobs-heavy' };
export const queueFor = (tool) => (HEAVY_TOOLS.has(tool) ? 'heavy' : 'standard');

const bullQueues = {};
async function getBullQueue(kind) {
  if (!bullQueues[kind]) {
    const { Queue } = await import('bullmq');
    bullQueues[kind] = new Queue(QUEUE_NAMES[kind], { connection: await getRedisClient() });
  }
  return bullQueues[kind];
}

/* Inline mode: bounded in-process concurrency, so one web process never runs dozens of OCR or
 * LibreOffice jobs at once under load (which would exhaust memory and stall every request). */
const inline = {
  standard: { running: 0, limit: Number(process.env.INLINE_CONCURRENCY || 4), waiting: [] },
  heavy: { running: 0, limit: Number(process.env.INLINE_HEAVY_CONCURRENCY || 1), waiting: [] },
};
function pump(kind) {
  const q = inline[kind];
  while (q.running < q.limit && q.waiting.length) {
    const payload = q.waiting.shift();
    q.running++;
    runJob(payload)
      .catch((err) => console.error(`[job ${payload.id}] failed:`, err.message))
      .finally(() => { q.running--; pump(kind); });
  }
}

/** In 'redis' mode this hands the job to BullMQ so any number of worker processes
 *  (src/worker.js) can pick it up — that's the horizontal-scale path. In 'inline' mode
 *  (no REDIS_URL) it runs in this process through a small bounded queue. Paid plans get
 *  priority in both modes. */
export async function enqueueJob(payload, { priority = false } = {}) {
  const kind = queueFor(payload.tool);
  if (queueMode === 'redis') {
    const queue = await getBullQueue(kind);
    await queue.add('process', payload, {
      jobId: payload.id,
      priority: priority ? 1 : 10, // BullMQ: lower number = higher priority
      // No automatic retry: tool failures are almost always the input (bad/encrypted file),
      // and a crashed worker's job is re-run by BullMQ's stalled-job recovery anyway.
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  } else {
    const q = inline[kind];
    if (priority) q.waiting.unshift(payload); else q.waiting.push(payload);
    setImmediate(() => pump(kind));
  }
}

export function inlineQueueStats() {
  return Object.fromEntries(Object.entries(inline).map(([k, q]) => [k, { running: q.running, waiting: q.waiting.length }]));
}

export async function closeQueues() {
  await Promise.all(Object.values(bullQueues).map((q) => q.close()));
}
