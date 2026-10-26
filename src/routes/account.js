import { Router } from 'express';
import express from 'express';
import {
  createUser, getUserByEmail, createSession, deleteSession, listPayments, usageSummary,
  createPasswordReset, consumePasswordReset, updateUserPassword, deleteUserSessions,
} from '../lib/db.js';
import { hashPassword, verifyPassword, setCookie, clearCookie, visitorCountry, isValidEmail } from '../lib/http.js';
import { sendEmail } from '../lib/email.js';
import { SESSION_COOKIE } from '../middleware/session.js';
import { createNamedLimiter } from '../middleware/rateLimiter.js';
import { BRAND, PLANS, TIERS, CURRENCIES, SESSION_TTL_DAYS, APP_URL } from '../config.js';
import { enabledProviders, razorpayKeyId } from '../lib/payments/index.js';
import { usageToday } from '../lib/quota.js';

const router = Router();
const json = express.json({ limit: '20kb' });
const asHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const authLimiter = createNamedLimiter({
  name: 'auth', windowMs: 15 * 60_000, max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});
const resetLimiter = createNamedLimiter({
  name: 'reset', windowMs: 15 * 60_000, max: 10,
  message: 'Too many reset attempts. Please wait a few minutes and try again.',
});

const DUMMY_HASH = await hashPassword('not-a-real-password');

const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, createdAt: u.created_at, isAdmin: Boolean(u.is_admin) };

async function startSession(res, user) {
  const { token } = await createSession(user.id, SESSION_TTL_DAYS);
  setCookie(res, SESSION_COOKIE, token, { maxAgeDays: SESSION_TTL_DAYS });
}

/** Public configuration the frontend needs: brand, plans with prices per currency, limits,
 *  which payment providers are live, and a suggested currency for this visitor. */
router.get('/config', (req, res) => {
  const country = visitorCountry(req);
  const providers = enabledProviders();
  const currencies = Object.keys(CURRENCIES).filter((c) => providers.includes(CURRENCIES[c].provider));
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    brand: BRAND,
    tiers: TIERS,
    plans: Object.values(PLANS).map(({ id, tier, days, name, blurb, price }) => ({ id, tier, days, name, blurb, price })),
    currencies: Object.fromEntries(currencies.map((c) => [c, CURRENCIES[c]])),
    suggestedCurrency: country ? (country === 'IN' ? 'INR' : 'USD') : null,
    payments: { providers, razorpayKeyId: razorpayKeyId() },
  });
});

router.post('/auth/signup', authLimiter, json, asHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').trim().slice(0, 100);
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
  if (password.length > 200) return res.status(400).json({ error: 'Password is too long.' });
  if (await getUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
  const user = await createUser({ email, name, passwordHash: await hashPassword(password), country: visitorCountry(req) });
  await startSession(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

router.post('/auth/login', authLimiter, json, asHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = await getUserByEmail(email);
  // Hash even when the account doesn't exist, so response time doesn't reveal which emails are registered.
  const ok = await verifyPassword(String(req.body?.password || ''), user?.password_hash || DUMMY_HASH) && Boolean(user);
  if (!ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
  await startSession(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/auth/logout', asHandler(async (req, res) => {
  if (req.sessionToken) await deleteSession(req.sessionToken);
  clearCookie(res, SESSION_COOKIE);
  res.json({ ok: true });
}));

/** Always responds the same way whether or not the email is registered, so the response
 *  can't be used to enumerate accounts. The reset email is only actually sent if it is. */
router.post('/auth/forgot', resetLimiter, json, asHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = await getUserByEmail(email);
  if (user) {
    const token = await createPasswordReset(user.id, 60);
    const base = APP_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/#/reset-password?token=${token}`;
    sendEmail({
      to: user.email,
      subject: `Reset your ${BRAND.name} password`,
      html: `<p>Click the link below to set a new password. It expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    }).catch((err) => console.error('[email] forgot-password send failed:', err.message));
  }
  res.json({ ok: true });
}));

/** Sets a new password from a reset token and signs the user out everywhere else — a
 *  password reset is usually in response to a compromised or forgotten password, so any
 *  session created before the reset shouldn't keep working. */
router.post('/auth/reset', resetLimiter, json, asHandler(async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
  if (password.length > 200) return res.status(400).json({ error: 'Password is too long.' });
  const user = await consumePasswordReset(token);
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
  await updateUserPassword(user.id, await hashPassword(password));
  await deleteUserSessions(user.id);
  res.json({ ok: true });
}));

/** Who am I, what plan am I on, and how much of today's allowance is left. */
router.get('/me', asHandler(async (req, res) => {
  const used = await usageToday(req);
  const body = {
    user: publicUser(req.user),
    tier: req.tier,
    tierEndsAt: req.tierEndsAt,
    limits: req.limits,
    usage: { today: used, remaining: Math.max(0, req.limits.tasksPerDay - used) },
  };
  if (req.user) {
    body.payments = await listPayments(req.user.id);
    body.history = await usageSummary(req.ownerId, 30);
  }
  res.set('Cache-Control', 'no-store');
  res.json(body);
}));

export default router;
