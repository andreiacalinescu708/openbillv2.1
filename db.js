// db.js
const { Pool } = require("pg");
const crypto = require("crypto");

const connectionString = process.env.DATABASE_URL;

let pool = null;

if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false } // Railway Postgres
  });
}

function hasDb() {
  return !!pool;
}

async function q(text, params) {
  if (!pool) throw new Error("DATABASE_URL lipsă (DB neconfigurat).");
  return pool.query(text, params);
}

async function ensureTables() {
  if (!pool) return;

  // 1) ORDERS
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

  // 2) STOCK
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

  // 3) AUDIT (păstrezi audit la produse aici - e pentru toate entitățile)
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

  // 4) USERS
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

  // MIGRARE safe (dacă tabela exista fără coloana active)
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`);

  // 5) CLIENTS
  await q(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_name TEXT,
      category TEXT,
      prices JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // MIGRARE safe (dacă tabela exista fără prices)
  await q(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS prices JSONB NOT NULL DEFAULT '{}'::jsonb`);

  // 6) PRODUCTS (cu active!)
  await q(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      gtin TEXT UNIQUE,
      gtins JSONB NOT NULL DEFAULT '[]'::jsonb,
      category TEXT,
      price NUMERIC(12,2),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // MIGRARE safe: dacă tabela exista deja fără active
  await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`);
}

// scrie audit in DB (optional de folosit)
async function auditLog({ action, entity, entity_id = null, user = null, details = null }) {
  const id = crypto.randomUUID();
  await q(
    `INSERT INTO audit (id, action, entity, entity_id, user_json, details)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [id, action, entity, entity_id, JSON.stringify(user), JSON.stringify(details)]
  );
  return id;
}

module.exports = { q, ensureTables, hasDb, auditLog };