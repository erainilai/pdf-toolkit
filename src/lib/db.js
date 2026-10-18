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
