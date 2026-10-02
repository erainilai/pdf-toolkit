import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'app.db');

let db;

export function initDb() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      job_id TEXT NOT NULL,
      bytes_in INTEGER NOT NULL,
      bytes_out INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      stripe_reported INTEGER NOT NULL DEFAULT 0,
      stripe_event_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_api_key ON jobs(api_key_id);
    CREATE INDEX IF NOT EXISTS idx_usage_api_key ON usage_events(api_key_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_stripe_customer ON api_keys(stripe_customer_id);
  `);
  // Idempotent migration for DBs created before billing was added.
  for (const stmt of [
    "ALTER TABLE api_keys ADD COLUMN stripe_customer_id TEXT",
    "ALTER TABLE api_keys ADD COLUMN stripe_subscription_id TEXT",
    "ALTER TABLE api_keys ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'none'",
    "ALTER TABLE usage_events ADD COLUMN stripe_reported INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE usage_events ADD COLUMN stripe_event_id TEXT",
  ]) {
    try { db.exec(stmt); } catch { /* column already exists */ }
  }
  return db;
}

function hashKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function createApiKey(name) {
  const id = randomUUID();
  const rawKey = `pdftk_${randomBytes(24).toString('base64url')}`;
  db.prepare('INSERT INTO api_keys (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, hashKey(rawKey), new Date().toISOString());
  return { id, name, rawKey };
}

export function verifyApiKey(rawKey) {
  const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hashKey(rawKey));
  if (!row || row.revoked_at) return null;
  return row;
}

export function listApiKeys() {
  return db.prepare('SELECT id, name, created_at, revoked_at FROM api_keys ORDER BY created_at DESC').all();
}

export function revokeApiKey(id) {
  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function getApiKeyById(id) {
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
}

export function findApiKeyByStripeCustomer(stripeCustomerId) {
  return db.prepare('SELECT * FROM api_keys WHERE stripe_customer_id = ?').get(stripeCustomerId);
}

export function linkStripeCustomer(apiKeyId, stripeCustomerId) {
  db.prepare("UPDATE api_keys SET stripe_customer_id = ?, billing_status = 'pending' WHERE id = ?")
    .run(stripeCustomerId, apiKeyId);
}

export function setBillingStatus(apiKeyId, status, { stripeSubscriptionId } = {}) {
  if (stripeSubscriptionId !== undefined) {
    db.prepare('UPDATE api_keys SET billing_status = ?, stripe_subscription_id = ? WHERE id = ?')
      .run(status, stripeSubscriptionId, apiKeyId);
  } else {
    db.prepare('UPDATE api_keys SET billing_status = ? WHERE id = ?').run(status, apiKeyId);
  }
}

export function createJob({ id, apiKeyId, tool }) {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO jobs (id, api_key_id, tool, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, apiKeyId, tool, 'queued', now, now);
}

export function updateJobStatus(id, status, { error, resultFiles } = {}) {
  db.prepare('UPDATE jobs SET status = ?, error = ?, result_files = ?, updated_at = ? WHERE id = ?')
    .run(status, error ?? null, resultFiles ? JSON.stringify(resultFiles) : null, new Date().toISOString(), id);
}

export function getJobForKey(id, apiKeyId) {
  return db.prepare('SELECT * FROM jobs WHERE id = ? AND api_key_id = ?').get(id, apiKeyId);
}

export function recordUsage({ apiKeyId, tool, jobId, bytesIn, bytesOut }) {
  const info = db.prepare(
    'INSERT INTO usage_events (api_key_id, tool, job_id, bytes_in, bytes_out, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(apiKeyId, tool, jobId, bytesIn, bytesOut, new Date().toISOString());
  return info.lastInsertRowid;
}

export function markUsageReported(usageEventId, stripeEventId) {
  db.prepare('UPDATE usage_events SET stripe_reported = 1, stripe_event_id = ? WHERE id = ?')
    .run(stripeEventId, usageEventId);
}

export function usageSummary(apiKeyId, sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const byTool = db.prepare(
    `SELECT tool, COUNT(*) as jobs, SUM(bytes_in) as bytesIn, SUM(bytes_out) as bytesOut
     FROM usage_events WHERE api_key_id = ? AND created_at >= ? GROUP BY tool`
  ).all(apiKeyId, since);
  const totals = db.prepare(
    `SELECT COUNT(*) as jobs, COALESCE(SUM(bytes_in),0) as bytesIn, COALESCE(SUM(bytes_out),0) as bytesOut
     FROM usage_events WHERE api_key_id = ? AND created_at >= ?`
  ).get(apiKeyId, since);
  return { sinceDays, totals, byTool };
}
