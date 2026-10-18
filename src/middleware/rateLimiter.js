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

let ipLimiterPromise;
/** Per-IP limiter for the unauthenticated browser endpoints (/api/*). Same Redis-or-memory
 *  store choice as above. WEB_RATE_LIMIT_MAX=0 disables it (e.g. single-user local use). */
export function createIpRateLimiter() {
  const max = Number(process.env.WEB_RATE_LIMIT_MAX ?? 30);
  if (!max) return (req, res, next) => next();
  return async (req, res, next) => {
    if (!ipLimiterPromise) {
      ipLimiterPromise = (async () => {
        const redisClient = await getRedisClient();
        let store;
        if (redisClient) {
          const { RedisStore } = await import('rate-limit-redis');
          store = new RedisStore({ prefix: 'rl:web:', sendCommand: (...args) => redisClient.call(...args) });
        }
        return rateLimit({
          windowMs: Number(process.env.WEB_RATE_LIMIT_WINDOW_MS || 60_000),
          max,
          standardHeaders: true,
          legacyHeaders: false,
          store,
          // /api/v1/* (keyed API + Stripe webhook) is also routed through the /api router; it has its own per-key limit.
          skip: (req) => req.method === 'GET' || req.path.startsWith('/v1/'),
          message: { error: 'Too many requests from your network. Please wait a minute and try again.' },
        });
      })();
    }
    (await ipLimiterPromise)(req, res, next);
  };
}

/** Generic limiter factory (Redis-backed when REDIS_URL is set) for sensitive endpoints such
 *  as sign-in and checkout. */
export function createNamedLimiter({ name, windowMs, max, message, keyGenerator }) {
  let p;
  return async (req, res, next) => {
    if (!p) {
      p = (async () => {
        const redisClient = await getRedisClient();
        let store;
        if (redisClient) {
          const { RedisStore } = await import('rate-limit-redis');
          store = new RedisStore({ prefix: `rl:${name}:`, sendCommand: (...args) => redisClient.call(...args) });
        }
        return rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, store, keyGenerator, message: { error: message } });
      })();
    }
    (await p)(req, res, next);
  };
}
