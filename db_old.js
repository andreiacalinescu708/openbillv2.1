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

// Context curent pentru RLS (thread-local)
let currentContext = {
  companyId: null,
  userId: null,
  isSuperadmin: false
};

// Setează contextul RLS pentru request-ul curent
function setRLSContext(companyId, userId, isSuperadmin = false) {
  currentContext = {
    companyId: companyId ? String(companyId) : null,
    userId: userId ? String(userId) : null,
    isSuperadmin: Boolean(isSuperadmin)
  };
}

// Resetează contextul RLS
function resetRLSContext() {
  currentContext = {
    companyId: null,
    userId: null,
    isSuperadmin: false
  };
}

// Query cu suport RLS
async function q(text, params) {
  if (!pool) throw new Error("DATABASE_URL lipsă (DB neconfigurat).");
  
  const client = await pool.connect();
  try {
    // Setăm variabilele de sesiune pentru RLS (doar dacă avem context)
    if (currentContext.companyId || currentContext.userId) {
      // Folosim string interpolation pentru SET (valorile sunt controlate de noi din session)
      if (currentContext.companyId) {
        const safeCompanyId = currentContext.companyId.replace(/'/g, "''");
        await client.query(`SET LOCAL app.current_company_id = '${safeCompanyId}'`);
      }
      if (currentContext.userId) {
        const safeUserId = currentContext.userId.replace(/'/g, "''");
        await client.query(`SET LOCAL app.current_user_id = '${safeUserId}'`);
      }
      const safeSuperadmin = currentContext.isSuperadmin ? 'true' : 'false';
      await client.query(`SET LOCAL app.is_superadmin = '${safeSuperadmin}'`);
    }
    
    // Executăm query-ul cerut
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

// Funcție pentru tranzacții - folosește un client dedicat
async function withTransaction(callback) {
  if (!pool) throw new Error("DATABASE_URL lipsă (DB neconfigurat).");
  const client = await pool.connect();
  let callbackError = null;
  let callbackResult = null;
  
  console.log("[DB] Client conectat, încep BEGIN");
  try {
    await client.query('BEGIN');
    console.log("[DB] BEGIN executat");
    
    // Setăm variabilele RLS pentru tranzacție (doar dacă avem context)
    if (currentContext.companyId || currentContext.userId) {
      if (currentContext.companyId) {
        const safeCompanyId = currentContext.companyId.replace(/'/g, "''");
        await client.query(`SET LOCAL app.current_company_id = '${safeCompanyId}'`);
      }
      if (currentContext.userId) {
        const safeUserId = currentContext.userId.replace(/'/g, "''");
        await client.query(`SET LOCAL app.current_user_id = '${safeUserId}'`);
      }
      const safeSuperadmin = currentContext.isSuperadmin ? 'true' : 'false';
      await client.query(`SET LOCAL app.is_superadmin = '${safeSuperadmin}'`);
      console.log("[DB] RLS context setat");
    }
    
    try {
      callbackResult = await callback(client);
      console.log("[DB] Callback complet cu succes");
    } catch (callbackErr) {
      callbackError = callbackErr;
      console.error("[DB] Eroare în callback:", callbackErr.message);
    }
    
    if (callbackError) {
      console.log("[DB] Fac ROLLBACK din cauza erorii în callback");
      await client.query('ROLLBACK');
      throw callbackError;
    } else {
      console.log("[DB] Fac COMMIT");
      await client.query('COMMIT');
      console.log("[DB] COMMIT executat cu succes");
      return callbackResult;
    }
  } catch (e) {
    console.error("[DB] Eroare în tranzacție:", e.message);
    try { await client.query('ROLLBACK'); } catch (rollbackErr) {}
    throw e;
  } finally {
    console.log("[DB] Release client");
    client.release();
  }
}

async function ensureTables() {
  if (!pool) return;

  // ================= COMPANIES (Multi-tenant) =================
  await q(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      cui TEXT,
      address TEXT,
      city TEXT,
      country TEXT DEFAULT 'Romania',
      phone TEXT,
      email TEXT,
      plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'enterprise')),
      plan_price NUMERIC(10,2) NOT NULL DEFAULT 29.99,
      subscription_status TEXT DEFAULT 'active' CHECK (subscription_status IN ('active', 'inactive', 'pending', 'suspended')),
      subscription_expires_at TIMESTAMPTZ,
      max_users INTEGER NOT NULL DEFAULT 3,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Index pe code pentru căutare rapidă
  await q(`CREATE INDEX IF NOT EXISTS idx_companies_code ON companies (code)`);

  // Adaugă coloană status pentru companii (demo, pending, active, suspended)
  try {
    await q(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('demo', 'pending', 'active', 'suspended'))`);
    console.log('✅ Coloană status adăugată la companies');
  } catch (e) {
    console.log('ℹ️ Coloana status există deja');
  }

  // ================= USERS (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      first_name TEXT,
      last_name TEXT,
      position TEXT,
      phone TEXT,
      email TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      is_approved BOOLEAN NOT NULL DEFAULT false,
      failed_attempts INTEGER DEFAULT 0,
      unlock_at TIMESTAMPTZ,
      last_failed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(company_id, username)
    )
  `);

  // Index pe company_id pentru filtrare rapidă
  await q(`CREATE INDEX IF NOT EXISTS idx_users_company ON users (company_id)`);

  // Adaugă coloane noi pentru sistemul DEMO și email verification (migrare)
  try {
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false`);
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT`);
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code TEXT`);
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ`);
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo_user BOOLEAN NOT NULL DEFAULT false`);
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_company_id TEXT`);
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_company_id TEXT`);
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`);
    console.log('✅ Coloane users migrate/adăugate');
  } catch (e) {
    console.log('ℹ️ Migrare coloane users:', e.message);
  }

  // ================= INVITATIONS (invitații utilizatori) =================
  await q(`
    CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      invite_token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      invited_by INTEGER REFERENCES users(id),
      used BOOLEAN NOT NULL DEFAULT false,
      used_by INTEGER REFERENCES users(id),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations (invite_token)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_invitations_company ON invitations (company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations (email)`);

  // ================= PASSWORD_RESETS (resetare parolă) =================
  await q(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reset_token TEXT NOT NULL UNIQUE,
      used BOOLEAN NOT NULL DEFAULT false,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (reset_token)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id)`);

  // ================= ORDERS (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      client JSONB NOT NULL,
      items JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_procesare',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_to_smartbill BOOLEAN NOT NULL DEFAULT false,
      due_date DATE,
      smartbill_series TEXT,
      smartbill_number TEXT,
      smartbill_error TEXT,
      smartbill_response JSONB,
      smartbill_draft_sent BOOLEAN NOT NULL DEFAULT false
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_orders_company ON orders (company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC)`);

  // ================= STOCK (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS stock (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      gtin TEXT NOT NULL,
      product_name TEXT NOT NULL,
      lot TEXT NOT NULL,
      expires_at DATE NOT NULL,
      qty INT NOT NULL DEFAULT 0,
      location TEXT NOT NULL DEFAULT 'A',
      warehouse TEXT NOT NULL DEFAULT 'depozit',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_stock_company ON stock (company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_stock_gtin ON stock (gtin)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_stock_warehouse ON stock (warehouse)`);

  // ================= AUDIT (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      user_json JSONB,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_audit_company ON audit (company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit (created_at DESC)`);

  // ================= CLIENTS (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      group_name TEXT,
      category TEXT,
      cui TEXT,
      payment_terms INTEGER DEFAULT 0,
      prices JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_clients_company ON clients (company_id)`);

  // ================= PRODUCTS (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      gtin TEXT,
      gtins JSONB NOT NULL DEFAULT '[]'::jsonb,
      category TEXT,
      price NUMERIC(12,2),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_products_company ON products (company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_products_name ON products (name)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_products_category ON products (category)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_products_active ON products (active)`);

  // unique gtin per company (parțial)
  await q(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_gtin_company_ux
    ON products (company_id, gtin)
    WHERE gtin IS NOT NULL
  `);

  // ================= DRIVERS (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_drivers_company ON drivers (company_id)`);

  // ================= VEHICLES (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      plate_number TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(company_id, plate_number)
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_vehicles_company ON vehicles (company_id)`);

  // ================= TRIP_SHEETS (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS trip_sheets (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      driver_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      km_start INTEGER NOT NULL,
      km_end INTEGER,
      locations TEXT NOT NULL DEFAULT '',
      trip_number VARCHAR(20) UNIQUE,
      departure_time TEXT,
      arrival_time TEXT,
      purpose TEXT,
      tech_check_departure BOOLEAN DEFAULT false,
      tech_check_arrival BOOLEAN DEFAULT false,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (driver_id) REFERENCES drivers(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_trip_sheets_company ON trip_sheets (company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_trip_sheets_date ON trip_sheets (date DESC)`);

  // ================= FUEL_RECEIPTS (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS fuel_receipts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      trip_sheet_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('diesel', 'adblue')),
      receipt_number TEXT NOT NULL,
      liters NUMERIC(8,2) NOT NULL,
      km_at_refuel INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (trip_sheet_id) REFERENCES trip_sheets(id) ON DELETE CASCADE
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_fuel_receipts_company ON fuel_receipts (company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_fuel_receipts_sheet ON fuel_receipts(trip_sheet_id)`);

  // ================= STOCK_TRANSFERS (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      gtin TEXT NOT NULL,
      product_name TEXT NOT NULL,
      lot TEXT NOT NULL,
      expires_at DATE,
      qty INT NOT NULL,
      from_warehouse TEXT NOT NULL,
      to_warehouse TEXT NOT NULL,
      from_location TEXT,
      to_location TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_stock_transfers_company ON stock_transfers (company_id)`);

  // ================= CLIENT_BALANCES (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS client_balances (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      client_id TEXT REFERENCES clients(id),
      cui TEXT,
      invoice_number TEXT,
      invoice_date DATE,
      due_date DATE,
      currency TEXT,
      total_value NUMERIC(12,2),
      balance_due NUMERIC(12,2),
      days_overdue INTEGER,
      status TEXT,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_balances_company ON client_balances(company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_balances_client ON client_balances(client_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_balances_cui ON client_balances(cui)`);

  // ================= COMPANY_SETTINGS (per company) =================
  await q(`
    CREATE TABLE IF NOT EXISTS company_settings (
      company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'OpenBill',
      cui TEXT NOT NULL DEFAULT 'RO47095864',
      smartbill_token TEXT,
      smartbill_series TEXT DEFAULT 'OB',
      address TEXT,
      city TEXT,
      county TEXT,
      country TEXT DEFAULT 'Romania',
      phone TEXT,
      email TEXT,
      bank_name TEXT,
      bank_iban TEXT,
      registration_number TEXT,
      vat_number TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // ================= SUBSCRIPTION_INVOICES (cu company_id) =================
  await q(`
    CREATE TABLE IF NOT EXISTS subscription_invoices (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      plan TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      payment_method TEXT DEFAULT 'op',
      stripe_invoice_id TEXT,
      stripe_session_id TEXT,
      pdf_url TEXT,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_sub_invoices_company ON subscription_invoices(company_id)`);

  // =========================================================
  // ✅ MIGRĂRI pentru DB vechi - Adaugă company_id unde lipsește
  // =========================================================
  
  // Verificăm dacă există date fără company_id și le atribuim un company default
  // Aceasta se va face în scriptul de migrare separat
}

// ================= AUDIT LOG (DB) =================
async function auditLog({ action, entity, entity_id = null, user = null, details = null, company_id = null }) {
  if (!pool) return;

  const id = crypto.randomUUID();

  await q(
    `INSERT INTO audit (id, company_id, action, entity, entity_id, user_json, details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [
      id,
      company_id,
      String(action),
      String(entity),
      entity_id ? String(entity_id) : null,
      JSON.stringify(user || null),
      JSON.stringify(details || null)
    ]
  );

  return id;
}

module.exports = { 
  q, 
  ensureTables, 
  hasDb, 
  auditLog, 
  withTransaction,
  setRLSContext,
  resetRLSContext
};
