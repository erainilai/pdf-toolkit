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
      revoked_at TEXT
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
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_api_key ON jobs(api_key_id);
    CREATE INDEX IF NOT EXISTS idx_usage_api_key ON usage_events(api_key_id, created_at);
  `);
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
  db.prepare(
    'INSERT INTO usage_events (api_key_id, tool, job_id, bytes_in, bytes_out, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(apiKeyId, tool, jobId, bytesIn, bytesOut, new Date().toISOString());
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
