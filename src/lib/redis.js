let client;

/** Returns a shared ioredis connection, or null when REDIS_URL isn't set (single-process,
 *  no-infra mode). Both the queue and the per-key rate limiter reuse this one connection. */
export async function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!client) {
    const { default: IORedis } = await import('ioredis');
    client = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return client;
}
