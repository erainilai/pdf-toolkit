import rateLimit from 'express-rate-limit';
import { getRedisClient } from '../lib/redis.js';

/** Builds an express-rate-limit instance. Uses a Redis-backed store when REDIS_URL is set,
 *  so the limit is enforced correctly across every web replica — not just per-process —
 *  which is what makes this safe to run behind a load balancer with multiple instances.
 *  Falls back to an in-memory store (per-process only) when there's no Redis. */
async function buildLimiter({ windowMs, max, prefix, keyGenerator, skip, message }) {
  const redisClient = await getRedisClient();

  let store;
  if (redisClient) {
    const { RedisStore } = await import('rate-limit-redis');
    store = new RedisStore({
      prefix,
      sendCommand: (...args) => redisClient.call(...args),
    });
  }

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator,
    skip,
    message: { error: message },
    // Built lazily on the first request (the Redis store needs an async connection), but
    // only once — so the "created in a request handler" check is a false positive here.
    validate: { creationStack: false },
  });
}

/** Wraps a lazily-built limiter as ordinary Express middleware. */
function lazy(options) {
  let limiterPromise;
  return (req, res, next) => {
    if (options.skip?.(req)) return next();
    if (!limiterPromise) limiterPromise = buildLimiter(options);
    limiterPromise.then((limiter) => limiter(req, res, next), next);
  };
}

/** Per-API-key rate limiting for /api/v1/*. */
export function createRateLimiter() {
  return lazy({
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.API_RATE_LIMIT_MAX || 60),
    prefix: 'rl:pdf-toolkit:',
    keyGenerator: (req) => req.apiKey?.id || req.ip,
    message: 'Rate limit exceeded. Slow down and try again shortly.',
  });
}

/** Per-visitor (IP address) rate limiting for the browser UI's unauthenticated /api/* tools,
 *  so one visitor can't monopolise a publicly hosted instance. Only counts POSTs (actual PDF
 *  processing) — page loads and /api/system-info are free. Set PUBLIC_RATE_LIMIT_MAX=0 to
 *  turn it off. Behind a reverse proxy (Render, etc.) also set TRUST_PROXY so req.ip is the
 *  real visitor rather than the proxy. */
export function createPublicRateLimiter() {
  const max = Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 60);
  const windowMs = Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS || 15 * 60_000);
  if (!max) return (req, res, next) => next();

  const minutes = Math.round(windowMs / 60_000);
  return lazy({
    windowMs,
    max,
    prefix: 'rl:pdf-toolkit:public:',
    keyGenerator: (req) => req.ip,
    // The /api mount also sees /api/v1/* requests, which have their own per-key limiter.
    skip: (req) => req.method !== 'POST' || req.path === '/v1' || req.path.startsWith('/v1/'),
    message: `Too many requests from your connection — the limit is ${max} operations every ${minutes} minutes. Please wait a few minutes and try again.`,
  });
}
