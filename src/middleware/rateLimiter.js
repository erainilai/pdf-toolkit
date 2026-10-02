import rateLimit from 'express-rate-limit';
import { getRedisClient } from '../lib/redis.js';

let limiterPromise;

/** Per-API-key rate limiting. Uses a Redis-backed store when REDIS_URL is set, so the
 *  limit is enforced correctly across every web replica — not just per-process — which is
 *  what makes this safe to run behind a load balancer with multiple instances. Falls back
 *  to an in-memory store (per-process only) when there's no Redis. */
async function buildLimiter() {
  const windowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000);
  const max = Number(process.env.API_RATE_LIMIT_MAX || 60);
  const redisClient = await getRedisClient();

  let store;
  if (redisClient) {
    const { RedisStore } = await import('rate-limit-redis');
    store = new RedisStore({
      prefix: 'rl:pdf-toolkit:',
      sendCommand: (...args) => redisClient.call(...args),
    });
  }

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator: (req) => req.apiKey?.id || req.ip,
    message: { error: 'Rate limit exceeded. Slow down and try again shortly.' },
  });
}

export function createRateLimiter() {
  return async (req, res, next) => {
    if (!limiterPromise) limiterPromise = buildLimiter();
    const limiter = await limiterPromise;
    limiter(req, res, next);
  };
}
