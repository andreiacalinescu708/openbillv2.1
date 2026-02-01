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

  await q(`
    CREATE TABLE IF NOT EXISTS stock (
      id TEXT PRIMARY KEY,
      gtin TEXT NOT NULL,
      product_name TEXT NOT NULL,
      lot TEXT NOT NULL,
      expires_at DATE NOT NULL,
      qty INT NOT NULL DEFAULT 0,
      location TEXT NOT NULL DEFAULT 'A',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS stock_gtin_idx
    ON stock (gtin)
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      user_json JSONB,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS audit_created_at_idx
    ON audit (created_at DESC)
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      group_name TEXT,
      category TEXT,
      prices JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      gtin TEXT UNIQUE,
      gtins JSONB NOT NULL DEFAULT '[]'::jsonb,
      category TEXT,
      price NUMERIC(12,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}




module.exports = { q, ensureTables, hasDb: () => !!pool };
