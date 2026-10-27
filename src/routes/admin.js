import { Router } from 'express';
import express from 'express';
import { randomBytes } from 'node:crypto';
import {
  adminListUsers, adminRecentJobs, adminRevenueSummary, adminRecentPayments,
  createUser, getUserByEmail, getUserById, activeEntitlements,
} from '../lib/db.js';
import { hashPassword, isValidEmail } from '../lib/http.js';
import { requireAdmin } from '../middleware/admin.js';
import { bestEntitlement } from '../middleware/session.js';
import { grantPlanManually } from '../lib/payments/index.js';
import { PLANS } from '../config.js';

const router = Router();
const json = express.json({ limit: '20kb' });
const asHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.use(requireAdmin);

router.get('/users', asHandler(async (req, res) => {
  const users = await adminListUsers();
  const withTier = await Promise.all(users.map(async (u) => {
    const best = bestEntitlement(await activeEntitlements(u.id));
    return {
      id: u.id, email: u.email, name: u.name, isAdmin: Boolean(u.is_admin), createdAt: u.created_at,
      jobCount: Number(u.jobCount) || 0,
      tier: best ? best.plan : 'free', tierEndsAt: best ? best.ends_at : null,
    };
  }));
  res.json({ users: withTier });
}));

router.post('/users', json, asHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 100);
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (await getUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
  const password = String(req.body?.password || '') || randomBytes(9).toString('base64url');
  const user = await createUser({ email, name, passwordHash: await hashPassword(password), country: null });
  res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at }, password });
}));

router.post('/users/:id/grant-plan', json, asHandler(async (req, res) => {
  const planId = String(req.body?.planId || '');
  if (!PLANS[planId]) return res.status(400).json({ error: `Unknown plan "${planId}".` });
  if (!(await getUserById(req.params.id))) return res.status(404).json({ error: 'User not found.' });
  const { plan, granted } = await grantPlanManually({ userId: req.params.id, planId, adminId: req.user.id });
  res.json({ ok: true, plan: plan.id, granted });
}));

router.get('/activity', asHandler(async (req, res) => {
  res.json({ jobs: await adminRecentJobs() });
}));

router.get('/revenue', asHandler(async (req, res) => {
  const [summary, recent] = await Promise.all([adminRevenueSummary(), adminRecentPayments()]);
  res.json({ summary, recent });
}));

export default router;
