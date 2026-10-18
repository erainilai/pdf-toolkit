import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Thin async SQL layer over two backends, chosen by environment — the same toggle-by-env
 *  pattern as the Redis queue and S3 storage:
 *
 *    DATABASE_URL=postgres://…   → PostgreSQL via `pg` (pooled). Required once you run more
 *                                  than one web/worker host, since SQLite is a local file.
 *    (unset)                     → SQLite file at DATA_DIR/app.db via node:sqlite. Zero setup.
 *
 *  All SQL in the app is written once with `?` placeholders; they are rewritten to $1..$n for
 *  Postgres. Both engines support RETURNING and ON CONFLICT, which is all the dialect overlap
 *  the app needs. Timestamps are ISO-8601 TEXT in both, so comparisons work identically. */

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

let backend;      // { kind, query(sql, params) → rows, exec(sql) }
let initPromise;

export const dialect = () => backend?.kind || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');

function toPg(sql) {
  let i = 0;
  // Replace ? placeholders outside of single-quoted string literals.
  return sql.replace(/'(?:[^']|'')*'|\?/g, (m) => (m === '?' ? `$${++i}` : m));
}

async function openPostgres() {
  const { default: pg } = await import('pg');
  // Return BIGINT/NUMERIC (COUNT, SUM) as JS numbers — every value we aggregate fits easily.
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => Number(v));
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_STRICT !== 'false' } : undefined,
  });
  return {
    kind: 'postgres',
    pool,
    async query(sql, params = []) { return (await pool.query(toPg(sql), params)).rows; },
    async exec(sql) { await pool.query(sql); },
    async close() { await pool.end(); },
  };
}

async function openSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(DATA_DIR, 'app.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  return {
    kind: 'sqlite',
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      // Statements that return rows (SELECT or …RETURNING) use all(); the rest use run().
      if (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) return stmt.all(...params);
      stmt.run(...params);
      return [];
    },
    async exec(sql) { db.exec(sql); },
    async close() { db.close(); },
  };
}

export function initSql(migrate) {
  if (!initPromise) {
    initPromise = (async () => {
      backend = process.env.DATABASE_URL ? await openPostgres() : await openSqlite();
      // Migrations get the raw backend: going through exec() here would await this very promise.
      if (migrate) await migrate(backend);
      return backend;
    })();
  }
  return initPromise;
}

async function ready() {
  if (!initPromise) throw new Error('Database not initialised — call initDb() first.');
  return initPromise;
}

export async function all(sql, params) { return (await ready()).query(sql, params); }
export async function get(sql, params) { return (await all(sql, params))[0]; }
export async function run(sql, params) { await all(sql, params); }
export async function exec(sql) { return (await ready()).exec(sql); }
export async function closeSql() { if (backend) await backend.close(); }
