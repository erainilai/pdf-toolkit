import { randomBytes } from 'node:crypto';
import { parseCookies, setCookie } from '../lib/http.js';
import { getSessionUser, activeEntitlements } from '../lib/db.js';
import { TIERS } from '../config.js';

export const SESSION_COOKIE = 'sid';
const VISITOR_COOKIE = 'vid';

/** Resolves who is calling the browser-facing API:
 *   req.user      — signed-in user row (or null)
 *   req.visitorId — stable random id for anonymous visitors (cookie), used to own their jobs
 *   req.ownerId   — "user:<id>" or "anon:<visitorId>", the owner stored on jobs
 *   req.tier      — 'anon' | 'free' | 'daypass' | 'pro'  (+ req.tierEndsAt for paid tiers)
 *  Stateless across web replicas: everything comes from cookies + the shared database. */
export async function sessionContext(req, res, next) {
  try {
    const cookies = parseCookies(req);
    req.sessionToken = cookies[SESSION_COOKIE] || null;
    req.user = req.sessionToken ? await getSessionUser(req.sessionToken) : null;

    let vid = cookies[VISITOR_COOKIE];
    if (!vid || !/^[A-Za-z0-9_-]{16,64}$/.test(vid)) {
      vid = randomBytes(16).toString('base64url');
      setCookie(res, VISITOR_COOKIE, vid, { maxAgeDays: 365 });
    }
    req.visitorId = vid;
    req.ownerId = req.user ? `user:${req.user.id}` : `anon:${vid}`;

    req.tier = req.user ? 'free' : 'anon';
    req.tierEndsAt = null;
    if (req.user) {
      const ents = await activeEntitlements(req.user.id);
      const pro = ents.find((e) => e.plan === 'pro');
      const pass = ents.find((e) => e.plan === 'daypass');
      const best = pro || pass;
      if (best) { req.tier = best.plan; req.tierEndsAt = best.ends_at; }
    }
    req.limits = TIERS[req.tier];
    next();
  } catch (err) {
    next(err);
  }
}

/** Rejects cross-site state-changing requests. Session cookies are SameSite=Lax already; this
 *  is the belt-and-braces Origin check for POST/PUT/DELETE from browsers. */
export function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser clients (curl, server-to-server)
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch { /* fall through */ }
  const allowed = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return next();
  return res.status(403).json({ error: 'Cross-site request blocked.' });
}
