// db.js
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

let pool = null;

if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false } // Railway Postgres
  });
}

async function q(text, params) {
  if (!pool) throw new Error("DATABASE_URL lipsă (DB neconfigurat).");
  return pool.query(text, params);
}

async function ensureTables() {
  if (!pool) return;

  await q(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client JSONB NOT NULL,
      items JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_procesare',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS orders_created_at_idx
    ON orders (created_at DESC)
  `);
}

module.exports = { q, ensureTables, hasDb: () => !!pool };
