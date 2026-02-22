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

  // ================= ORDERS =================
  await q(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client JSONB NOT NULL,
      items JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_procesare',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // ================= STOCK =================
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

  // ================= AUDIT =================
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

  // ================= USERS =================
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

  // ================= CLIENTS =================
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

  // ================= PRODUCTS =================
  await q(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      gtin TEXT,
      gtins JSONB NOT NULL DEFAULT '[]'::jsonb,
      category TEXT,
      price NUMERIC(12,2),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // =========================================================
  // ✅ MIGRĂRI pentru DB vechi (AICI era problema ta)
  // Dacă id-urile au fost create ca INTEGER în trecut, le facem TEXT.
  // =========================================================
  await q(`ALTER TABLE products ALTER COLUMN id TYPE TEXT USING id::text`);
  await q(`ALTER TABLE stock    ALTER COLUMN id TYPE TEXT USING id::text`);
  await q(`ALTER TABLE orders   ALTER COLUMN id TYPE TEXT USING id::text`);
  await q(`ALTER TABLE clients  ALTER COLUMN id TYPE TEXT USING id::text`);
  await q(`ALTER TABLE audit    ALTER COLUMN id TYPE TEXT USING id::text`);

  // coloane lipsă (safe)
  await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS gtin TEXT`);
  await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS gtins JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT`);
  await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price NUMERIC(12,2)`);
  await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`);
  await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await q(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS prices JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await q(`ALTER TABLE users   ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`);

  // indexuri
  await q(`CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS stock_gtin_idx ON stock (gtin)`);
  await q(`CREATE INDEX IF NOT EXISTS audit_created_at_idx ON audit (created_at DESC)`);

  await q(`CREATE INDEX IF NOT EXISTS products_name_idx ON products (name)`);
  await q(`CREATE INDEX IF NOT EXISTS products_category_idx ON products (category)`);
  await q(`CREATE INDEX IF NOT EXISTS products_active_idx ON products (active)`);

  // unique gtin (parțial)
  await q(`
    CREATE UNIQUE INDEX IF NOT EXISTS products_gtin_ux
    ON products (gtin)
    WHERE gtin IS NOT NULL
  `);

  // normalize active null (dacă au existat rânduri fără active)
  await q(`UPDATE products SET active = true WHERE active IS NULL`);
}

// ================= AUDIT LOG (DB) =================
async function auditLog({ action, entity, entity_id = null, user = null, details = null }) {
  if (!pool) return;

  const id = crypto.randomUUID();

  await q(
    `INSERT INTO audit (id, action, entity, entity_id, user_json, details)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [
      id,
      String(action),
      String(entity),
      entity_id ? String(entity_id) : null,
      JSON.stringify(user || null),
      JSON.stringify(details || null)
    ]
  );

  return id;
}

module.exports = { q, ensureTables, hasDb, auditLog };