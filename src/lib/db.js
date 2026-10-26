import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { initSql, all, get, run } from './sql.js';

/** Data access for the whole app. Async throughout so the same code runs on SQLite (default,
 *  single host) or PostgreSQL (DATABASE_URL — multi-host). See src/lib/sql.js. */

const now = () => new Date().toISOString();

const SCHEMA = (autoId) => `
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    billing_status TEXT NOT NULL DEFAULT 'none'
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    api_key_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    result_files TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_events (
    id ${autoId},
    api_key_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    job_id TEXT NOT NULL,
    bytes_in BIGINT NOT NULL,
    bytes_out BIGINT NOT NULL,
    created_at TEXT NOT NULL,
    stripe_reported INTEGER NOT NULL DEFAULT 0,
    stripe_event_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_api_key ON jobs(api_key_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON jobs(status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_usage_api_key ON usage_events(api_key_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_api_keys_stripe_customer ON api_keys(stripe_customer_id);

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT NOT NULL,
    country TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_order_id TEXT UNIQUE,
    provider_payment_id TEXT,
    plan_id TEXT NOT NULL,
    amount BIGINT NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);
  CREATE TABLE IF NOT EXISTS entitlements (
    id ${autoId},
    user_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    payment_id TEXT UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id, ends_at);
  CREATE TABLE IF NOT EXISTS daily_usage (
    subject TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (subject, day)
  );
`;

async function migrate(b) {
  const { kind } = b;
  const exec = (sql) => b.exec(sql);
  const autoId = kind === 'postgres' ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  if (kind === 'postgres') {
    for (const stmt of SCHEMA(autoId).split(';').map((s) => s.trim()).filter(Boolean)) await exec(stmt);
  } else {
    await exec(SCHEMA(autoId));
  }
  // Idempotent column additions for databases created before billing existed.
  for (const [table, col] of [
    ['api_keys', 'stripe_customer_id TEXT'],
    ['api_keys', 'stripe_subscription_id TEXT'],
    ['api_keys', "billing_status TEXT NOT NULL DEFAULT 'none'"],
    ['usage_events', 'stripe_reported INTEGER NOT NULL DEFAULT 0'],
    ['usage_events', 'stripe_event_id TEXT'],
  ]) {
    if (kind === 'postgres') await exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col}`);
    else { try { await exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* exists */ } }
  }
}

export function initDb() {
  return initSql(migrate);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export async function createApiKey(name) {
  const id = randomUUID();
  const rawKey = `pdftk_${randomBytes(24).toString('base64url')}`;
  await run('INSERT INTO api_keys (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)', [id, name, sha256(rawKey), now()]);
  return { id, name, rawKey };
}

export async function verifyApiKey(rawKey) {
  const row = await get('SELECT * FROM api_keys WHERE key_hash = ?', [sha256(rawKey)]);
  if (!row || row.revoked_at) return null;
  return row;
}

export const listApiKeys = () => all('SELECT id, name, created_at, revoked_at FROM api_keys ORDER BY created_at DESC');
export const revokeApiKey = (id) => run('UPDATE api_keys SET revoked_at = ? WHERE id = ?', [now(), id]);
export const getApiKeyById = (id) => get('SELECT * FROM api_keys WHERE id = ?', [id]);
export const findApiKeyByStripeCustomer = (cid) => get('SELECT * FROM api_keys WHERE stripe_customer_id = ?', [cid]);
export const linkStripeCustomer = (apiKeyId, cid) =>
  run("UPDATE api_keys SET stripe_customer_id = ?, billing_status = 'pending' WHERE id = ?", [cid, apiKeyId]);

export async function setBillingStatus(apiKeyId, status, { stripeSubscriptionId } = {}) {
  if (stripeSubscriptionId !== undefined) {
    await run('UPDATE api_keys SET billing_status = ?, stripe_subscription_id = ? WHERE id = ?', [status, stripeSubscriptionId, apiKeyId]);
  } else {
    await run('UPDATE api_keys SET billing_status = ? WHERE id = ?', [status, apiKeyId]);
  }
}

export async function createJob({ id, apiKeyId, tool }) {
  const t = now();
  await run('INSERT INTO jobs (id, api_key_id, tool, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, apiKeyId, tool, 'queued', t, t]);
}

export const updateJobStatus = (id, status, { error, resultFiles } = {}) =>
  run('UPDATE jobs SET status = ?, error = ?, result_files = ?, updated_at = ? WHERE id = ?',
    [status, error ?? null, resultFiles ? JSON.stringify(resultFiles) : null, now(), id]);

export const getJobForKey = (id, apiKeyId) => get('SELECT * FROM jobs WHERE id = ? AND api_key_id = ?', [id, apiKeyId]);

export async function recordUsage({ apiKeyId, tool, jobId, bytesIn, bytesOut }) {
  const row = await get(
    'INSERT INTO usage_events (api_key_id, tool, job_id, bytes_in, bytes_out, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [apiKeyId, tool, jobId, bytesIn, bytesOut, now()]);
  return row.id;
}

export const markUsageReported = (usageEventId, stripeEventId) =>
  run('UPDATE usage_events SET stripe_reported = 1, stripe_event_id = ? WHERE id = ?', [stripeEventId, usageEventId]);

export async function usageSummary(apiKeyId, sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const byTool = await all(
    `SELECT tool, COUNT(*) AS "jobs", SUM(bytes_in) AS "bytesIn", SUM(bytes_out) AS "bytesOut"
     FROM usage_events WHERE api_key_id = ? AND created_at >= ? GROUP BY tool`, [apiKeyId, since]);
  const totals = await get(
    `SELECT COUNT(*) AS "jobs", COALESCE(SUM(bytes_in),0) AS "bytesIn", COALESCE(SUM(bytes_out),0) AS "bytesOut"
     FROM usage_events WHERE api_key_id = ? AND created_at >= ?`, [apiKeyId, since]);
  return { sinceDays, totals, byTool };
}

/** Finished jobs whose files are past the retention window. */
export const jobsToExpire = (olderThanIso) =>
  all("SELECT id FROM jobs WHERE status IN ('completed','failed') AND updated_at < ? LIMIT 500", [olderThanIso]);

export const markJobExpired = (id) =>
  run("UPDATE jobs SET status = 'expired', result_files = NULL, updated_at = ? WHERE id = ?", [now(), id]);

/* ---------------- Users & sessions ---------------- */

export async function createUser({ email, name, passwordHash, country }) {
  const id = randomUUID();
  await run('INSERT INTO users (id, email, name, password_hash, country, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, email, name || null, passwordHash, country || null, now()]);
  return getUserById(id);
}
export const getUserById = (id) => get('SELECT * FROM users WHERE id = ?', [id]);
export const getUserByEmail = (email) => get('SELECT * FROM users WHERE email = ?', [email]);

export async function createSession(userId, ttlDays) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  await run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [sha256(token), userId, now(), expires]);
  return { token, expires };
}
export async function getSessionUser(token) {
  const row = await get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    [sha256(token), now()]);
  return row || null;
}
export const deleteSession = (token) => run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
export const deleteUserSessions = (userId) => run('DELETE FROM sessions WHERE user_id = ?', [userId]);
export const deleteExpiredSessions = () => run('DELETE FROM sessions WHERE expires_at < ?', [now()]);
export const updateUserPassword = (userId, passwordHash) => run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

/* ---------------- Password resets ---------------- */

export async function createPasswordReset(userId, ttlMinutes = 60) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  await run('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [sha256(token), userId, now(), expires]);
  return token;
}

/** Looks up and immediately deletes the reset token (single-use) if it's valid and unexpired. */
export async function consumePasswordReset(token) {
  const row = await get(
    `SELECT u.* FROM password_resets p JOIN users u ON u.id = p.user_id WHERE p.token_hash = ? AND p.expires_at > ?`,
    [sha256(token), now()]);
  if (!row) return null;
  await run('DELETE FROM password_resets WHERE token_hash = ?', [sha256(token)]);
  return row;
}

export const deleteExpiredPasswordResets = () => run('DELETE FROM password_resets WHERE expires_at < ?', [now()]);

/* ---------------- Payments ---------------- */

export async function createPayment({ userId, provider, providerOrderId, planId, amount, currency }) {
  const id = `pay_${randomBytes(12).toString('hex')}`;
  const t = now();
  await run(
    `INSERT INTO payments (id, user_id, provider, provider_order_id, plan_id, amount, currency, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)`, [id, userId, provider, providerOrderId, planId, amount, currency, t, t]);
  return id;
}
export const setPaymentOrderId = (id, providerOrderId) =>
  run('UPDATE payments SET provider_order_id = ?, updated_at = ? WHERE id = ?', [providerOrderId, now(), id]);
export const getPayment = (id) => get('SELECT * FROM payments WHERE id = ?', [id]);
export const getPaymentByOrder = (provider, orderId) =>
  get('SELECT * FROM payments WHERE provider = ? AND provider_order_id = ?', [provider, orderId]);
export const markPaymentStatus = (id, status, providerPaymentId) =>
  run('UPDATE payments SET status = ?, provider_payment_id = COALESCE(?, provider_payment_id), updated_at = ? WHERE id = ?',
    [status, providerPaymentId ?? null, now(), id]);
export const listPayments = (userId) =>
  all("SELECT id, provider, plan_id, amount, currency, status, created_at FROM payments WHERE user_id = ? AND status <> 'created' ORDER BY created_at DESC LIMIT 50", [userId]);

/* ---------------- Entitlements ---------------- */

/** Grants a plan period for a payment. Idempotent: payment_id is UNIQUE, so a webhook and the
 *  browser confirmation racing each other (or a retried webhook) grant exactly once. New
 *  periods stack on top of any time the user already has left on the same plan. */
export async function grantEntitlement({ userId, plan, days, paymentId }) {
  const existing = await get('SELECT id FROM entitlements WHERE payment_id = ?', [paymentId]);
  if (existing) return false;
  const latest = await get('SELECT MAX(ends_at) AS "endsAt" FROM entitlements WHERE user_id = ? AND plan = ? AND ends_at > ?', [userId, plan, now()]);
  const start = latest?.endsAt ? new Date(latest.endsAt) : new Date();
  const end = new Date(start.getTime() + days * 86_400_000);
  const rows = await all(
    `INSERT INTO entitlements (user_id, plan, starts_at, ends_at, payment_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (payment_id) DO NOTHING RETURNING id`,
    [userId, plan, start.toISOString(), end.toISOString(), paymentId, now()]);
  return rows.length > 0;
}

/** Active plans for a user with the end of each plan's (stacked, back-to-back) periods —
 *  e.g. a yearly renewal bought before the monthly ran out shows the yearly end date. */
export async function activeEntitlements(userId) {
  const t = now();
  return all(
    `SELECT plan, MIN(starts_at) AS starts_at, MAX(ends_at) AS ends_at FROM entitlements
     WHERE user_id = ? AND ends_at > ? GROUP BY plan HAVING MIN(starts_at) <= ? ORDER BY 3 DESC`, [userId, t, t]);
}

/* ---------------- Daily quota counters ---------------- */

/** Atomically increments today's counter for a subject and returns the new value. */
export async function incrementDailyUsage(subject, day) {
  const row = await get(
    `INSERT INTO daily_usage (subject, day, count) VALUES (?, ?, 1)
     ON CONFLICT (subject, day) DO UPDATE SET count = daily_usage.count + 1 RETURNING count`, [subject, day]);
  return Number(row.count);
}
export const decrementDailyUsage = (subject, day) =>
  run('UPDATE daily_usage SET count = count - 1 WHERE subject = ? AND day = ? AND count > 0', [subject, day]);
export async function getDailyUsage(subject, day) {
  const row = await get('SELECT count FROM daily_usage WHERE subject = ? AND day = ?', [subject, day]);
  return Number(row?.count || 0);
}
export const pruneDailyUsage = (beforeDay) => run('DELETE FROM daily_usage WHERE day < ?', [beforeDay]);
