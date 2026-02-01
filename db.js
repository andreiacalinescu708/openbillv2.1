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

  // ✅ STOCK
  await q(`
    CREATE TABLE IF NOT EXISTS stock (
      id TEXT PRIMARY KEY,
      gtin TEXT NOT NULL,
      product_name TEXT NOT NULL,
      lot TEXT NOT NULL,
      expires_at DATE NOT NULL,
      qty INTEGER NOT NULL,
      location TEXT NOT NULL DEFAULT 'A',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS stock_gtin_idx
    ON stock (gtin)
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS stock_gtin_lot_idx
    ON stock (gtin, lot)
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS stock_created_at_idx
    ON stock (created_at DESC)
  `);
}



module.exports = { q, ensureTables, hasDb: () => !!pool };
