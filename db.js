// db.js - Noua arhitectură cu subdomenii și DB separate per companie
const { Pool } = require("pg");

// ============================================================
// CONFIGURAȚIE BAZĂ DE DATE MASTER
// ============================================================
// Baza de date master conține lista companiilor și conexiunile la DB-urile lor
const MASTER_DB_URL = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;

// ============================================================
// MANAGEMENT CONEXIUNI
// ============================================================
let masterPool = null;
const companyPools = new Map(); // Cache pentru pool-uri per companie

// Inițializează conexiunea la baza de date master
function initMasterPool() {
  if (!MASTER_DB_URL) {
    console.error("❌ MASTER_DATABASE_URL sau DATABASE_URL lipsă!");
    return null;
  }
  
  // DEBUG: Afișăm URL-ul (fără parolă)
  const urlObj = new URL(MASTER_DB_URL);
  console.log(`🔗 Conectare la: ${urlObj.protocol}//${urlObj.username}:****@${urlObj.host}${urlObj.pathname}`);
  
  if (!masterPool) {
    masterPool = new Pool({
      connectionString: MASTER_DB_URL,
      ssl: { rejectUnauthorized: false }
    });
    console.log("✅ Master DB Pool inițializat");
  }
  return masterPool;
}

// Obține conexiunea la baza de date master
function getMasterPool() {
  return initMasterPool();
}

// Query pe baza de date master
async function masterQuery(text, params) {
  const pool = getMasterPool();
  if (!pool) throw new Error("Master DB neconfigurat");
  const result = await pool.query(text, params);
  return result;
}

// ============================================================
// GESTIONARE COMPANII ȘI SUBDOMENII
// ============================================================

// Obține compania după subdomeniu
async function getCompanyBySubdomain(subdomain) {
  try {
    const result = await masterQuery(
      `SELECT * FROM companies WHERE subdomain = $1 AND status = 'active'`,
      [subdomain.toLowerCase()]
    );
    return result.rows[0] || null;
  } catch (e) {
    console.error("Eroare getCompanyBySubdomain:", e.message);
    return null;
  }
}

// Obține sau creează pool pentru o companie
async function getCompanyPool(company) {
  if (companyPools.has(company.id)) {
    return companyPools.get(company.id);
  }

  // Construim connection string pentru DB-ul companiei
  // Format: postgresql://user:pass@host:port/dbname_company_subdomain
  const companyDbUrl = buildCompanyDbUrl(company);
  
  const pool = new Pool({
    connectionString: companyDbUrl,
    ssl: { rejectUnauthorized: false }
  });

  // Testăm conexiunea
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log(`✅ Pool creat pentru compania ${company.name} (${company.subdomain})`);
  } catch (e) {
    console.error(`❌ Eroare conectare la DB pentru ${company.subdomain}:`, e.message);
    throw e;
  }

  companyPools.set(company.id, pool);
  return pool;
}

// Construiește URL-ul pentru DB-ul companiei
function buildCompanyDbUrl(company) {
  // Extragem componentele din MASTER_DB_URL
  const masterUrl = new URL(MASTER_DB_URL);
  
  // Creăm numele bazei de date: original_dbname_subdomain
  const originalDbName = masterUrl.pathname.replace('/', '');
  const companyDbName = `${originalDbName}_${company.subdomain}`;
  
  // Construim noul URL
  masterUrl.pathname = `/${companyDbName}`;
  return masterUrl.toString();
}

// ============================================================
// QUERY PENTRU COMPANIE (DB SEPARAT)
// ============================================================

// Context curent pentru request
let currentCompanyContext = null;

// Setează compania curentă pentru request
function setCompanyContext(company) {
  currentCompanyContext = company;
}

// Resetează contextul
function resetCompanyContext() {
  currentCompanyContext = null;
}

// Query pe baza de date a companiei curente
async function q(text, params) {
  if (!currentCompanyContext) {
    throw new Error("Nicio companie selectată. Folosește middleware-ul de subdomeniu.");
  }

  const pool = await getCompanyPool(currentCompanyContext);
  const result = await pool.query(text, params);
  return result;
}

// Query cu client dedicat (pentru tranzacții)
async function withClient(callback) {
  if (!currentCompanyContext) {
    throw new Error("Nicio companie selectată. Folosește middleware-ul de subdomeniu.");
  }

  const pool = await getCompanyPool(currentCompanyContext);
  const client = await pool.connect();
  
  try {
    const result = await callback(client);
    return result;
  } finally {
    client.release();
  }
}

// Tranzacții
async function withTransaction(callback) {
  if (!currentCompanyContext) {
    throw new Error("Nicio companie selectată. Folosește middleware-ul de subdomeniu.");
  }

  const pool = await getCompanyPool(currentCompanyContext);
  const client = await pool.connect();
  
  console.log("[DB] Încep tranzacție");
  try {
    await client.query('BEGIN');
    let result;
    try {
      result = await callback(client);
      await client.query('COMMIT');
      console.log("[DB] COMMIT efectuat");
    } catch (e) {
      await client.query('ROLLBACK');
      console.log("[DB] ROLLBACK efectuat");
      throw e;
    }
    return result;
  } finally {
    client.release();
    console.log("[DB] Client eliberat");
  }
}

// ============================================================
// CREARE ȘI MIGRARE BAZE DE DATE
// ============================================================

// Inițializează tabelele în baza de date master (companies, etc.)
async function initMasterDatabase() {
  console.log("========================================");
  console.log("🚀 initMasterDatabase() A FOST APELATA!");
  console.log("========================================");
  
  const pool = getMasterPool();
  if (!pool) {
    console.error("❌ Pool nu e disponibil!");
    return false;
  }
  
  try {
    // DEBUG: Verificăm ce baza de date și schema suntem
    const dbInfo = await pool.query(`SELECT current_database(), current_schema()`);
    console.log("📍 Baza de date:", dbInfo.rows[0].current_database);
    console.log("📍 Schema curentă:", dbInfo.rows[0].current_schema);
    if (!pool) {
      console.error("❌ Nu pot inițializa master DB - conexiunea lipsește");
      return false;
    }
    
    console.log("🔄 Executăm SQL direct...");
    
    // Creăm tabelele direct, fără IF NOT EXISTS (vedem dacă dă eroare)
    await pool.query(`
      CREATE TABLE companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        cui TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        plan TEXT NOT NULL DEFAULT 'starter',
        plan_price NUMERIC(10,2) DEFAULT 29.99,
        max_users INTEGER DEFAULT 3,
        subscription_status TEXT DEFAULT 'trial',
        subscription_expires_at TIMESTAMPTZ,
        subdomain TEXT UNIQUE,
        status TEXT DEFAULT 'active',
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log("✅ Tabela companies creată");
    
    await pool.query(`
      CREATE TABLE company_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT DEFAULT 'OpenBill',
        cui TEXT,
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
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log("✅ Tabela company_settings creată");
    
    // Creăm indexuri
    await pool.query(`CREATE INDEX idx_companies_subdomain ON companies(subdomain)`);
    await pool.query(`CREATE INDEX idx_companies_code ON companies(code)`);
    await pool.query(`CREATE INDEX idx_companies_status ON companies(status)`);
    console.log("✅ Indexuri create");
    
    // Inserăm compania demo
    await pool.query(`
      INSERT INTO companies (id, code, name, plan, plan_price, max_users, subscription_status, subscription_expires_at, subdomain, status)
      VALUES (
        gen_random_uuid(), 
        'DEMO', 
        'Demo Company', 
        'enterprise', 
        59.99, 
        999, 
        'active', 
        NOW() + INTERVAL '1 year',
        'demo',
        'active'
      )
      ON CONFLICT (code) DO NOTHING
    `);
    console.log("✅ Compania demo inserată");
    
    console.log("✅✅✅ Master DB inițializat complet!");
    
    // DEBUG: Verificăm ce tabele există în TOATE schemenile
    const allTables = await pool.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_type = 'BASE TABLE' 
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `);
    console.log("📋 Toate tabelele găsite:");
    allTables.rows.forEach(row => {
      console.log(`   - ${row.table_schema}.${row.table_name}`);
    });
    
    return true;
    
  } catch (e) {
    // Dacă tabelele există deja, e ok
    if (e.message.includes('already exists')) {
      console.log("ℹ️ Tabelele există deja (eroare așteptată)");
      
      // DEBUG: Verificăm ce tabele există în TOATE schemenile
      try {
        const allTables = await pool.query(`
          SELECT table_schema, table_name 
          FROM information_schema.tables 
          WHERE table_type = 'BASE TABLE' 
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
          ORDER BY table_schema, table_name
        `);
        console.log("📋 Toate tabelele găsite:");
        allTables.rows.forEach(row => {
          console.log(`   - ${row.table_schema}.${row.table_name}`);
        });
      } catch (e2) {
        console.log("⚠️ Nu am putut verifica tabelele:", e2.message);
      }
      
      return true;
    }
    console.error("❌ Eroare inițializare Master DB:", e.message);
    return false;
  }
}

// Creează baza de date pentru o companie nouă
async function createCompanyDatabase(company) {
  const masterUrl = new URL(MASTER_DB_URL);
  const originalDbName = masterUrl.pathname.replace('/', '');
  const companyDbName = `${originalDbName}_${company.subdomain}`;
  
  // Conectăm la postgres (baza default) pentru a crea noua bază de date
  masterUrl.pathname = '/postgres';
  const adminPool = new Pool({
    connectionString: masterUrl.toString(),
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Creăm baza de date
    await adminPool.query(`CREATE DATABASE "${companyDbName}"`);
    console.log(`✅ Bază de date creată: ${companyDbName}`);
    
    // Conectăm la noua bază de date și creăm tabelele
    masterUrl.pathname = `/${companyDbName}`;
    const companyPool = new Pool({
      connectionString: masterUrl.toString(),
      ssl: { rejectUnauthorized: false }
    });
    
    await ensureCompanyTables(companyPool);
    await companyPool.end();
    
    return true;
  } catch (e) {
    console.error("Eroare creare bază de date companie:", e.message);
    // Dacă baza de date există deja, continuăm
    if (e.message.includes('already exists')) {
      return true;
    }
    throw e;
  } finally {
    await adminPool.end();
  }
}

// Crează tabelele pentru o companie (fără company_id!)
async function ensureCompanyTables(pool) {
  // USERS - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
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
      email_verified BOOLEAN NOT NULL DEFAULT false,
      email_verification_token TEXT,
      email_verification_code TEXT,
      email_verification_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // INVITATIONS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
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

  // PASSWORD_RESETS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reset_token TEXT NOT NULL UNIQUE,
      used BOOLEAN NOT NULL DEFAULT false,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // CLIENTS - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_name TEXT,
      category TEXT,
      cui TEXT,
      address TEXT,
      city TEXT,
      county TEXT,
      phone TEXT,
      email TEXT,
      payment_terms INTEGER DEFAULT 0,
      prices JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // PRODUCTS - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      gtin TEXT,
      gtins JSONB NOT NULL DEFAULT '[]'::jsonb,
      category TEXT,
      price NUMERIC(12,2),
      stock INTEGER DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_gtin_ux ON products (gtin) WHERE gtin IS NOT NULL
  `);

  // STOCK - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock (
      id TEXT PRIMARY KEY,
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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_gtin ON stock (gtin)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_warehouse ON stock (warehouse)`);

  // ORDERS - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC)`);

  // DRIVERS - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // VEHICLES - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      plate_number TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // TRIP_SHEETS - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_sheets (
      id TEXT PRIMARY KEY,
      date DATE NOT NULL,
      driver_id TEXT NOT NULL REFERENCES drivers(id),
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_trip_sheets_date ON trip_sheets (date DESC)`);

  // FUEL_RECEIPTS - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fuel_receipts (
      id TEXT PRIMARY KEY,
      trip_sheet_id TEXT NOT NULL REFERENCES trip_sheets(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('diesel', 'adblue')),
      receipt_number TEXT NOT NULL,
      liters NUMERIC(8,2) NOT NULL,
      km_at_refuel INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // STOCK_TRANSFERS - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id TEXT PRIMARY KEY,
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

  // CLIENT_BALANCES - fără company_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_balances (
      id SERIAL PRIMARY KEY,
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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_balances_client ON client_balances(client_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_balances_cui ON client_balances(cui)`);

  // COMPANY_SETTINGS - setări specifice companiei (un singur rând)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'OpenBill',
      cui TEXT,
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

  // COMPANY_CATEGORIES - categorii clienți
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      emoji VARCHAR(10) DEFAULT '📍',
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(name)
    )
  `);

  // AUDIT - fără company_id
  await pool.query(`
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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit (created_at DESC)`);

  console.log("✅ Tabele companie create/verificate");
}

// Închide toate conexiunile
async function closeAllPools() {
  if (masterPool) {
    await masterPool.end();
    masterPool = null;
  }
  for (const [id, pool] of companyPools) {
    await pool.end();
  }
  companyPools.clear();
}

// Verificare disponibilitate
function hasDb() {
  if (!masterPool) {
    initMasterPool();
  }
  return !!masterPool;
}

// ============================================================
// COMPATIBILITATE CU CODUL VECHI (Multi-tenant)
// ============================================================

// setRLSContext și resetRLSContext sunt păstrate pentru compatibilitate
// dar nu mai fac nimic în noua arhitectură (fiecare companie are DB separat)
function setRLSContext(companyId, userId, isSuperadmin = false) {
  // Păstrat pentru compatibilitate - nu mai e necesar cu DB separate
}

function resetRLSContext() {
  // Păstrat pentru compatibilitate
}

// Query pe baza de date master (pentru operațiuni administrative)
async function masterQ(text, params) {
  return masterQuery(text, params);
}

// Compatibilitate: ensureTables nu mai e necesar cu DB separate
// Fiecare companie își creează tabelele la migrare
async function ensureTables() {
  // Nu mai facem nimic aici - tabelele sunt create în DB-ul fiecărei companii separat
  console.log("ℹ️ ensureTables() - DB separate per companie, nu mai e necesar");
}

module.exports = {
  // Master DB
  getMasterPool,
  masterQuery,
  masterQ,
  
  // Company DB
  getCompanyBySubdomain,
  getCompanyPool,
  setCompanyContext,
  resetCompanyContext,
  q,
  withClient,
  withTransaction,
  
  // Creare companie
  createCompanyDatabase,
  ensureCompanyTables,
  buildCompanyDbUrl,
  initMasterDatabase,
  
  // Compatibilitate cu codul vechi
  setRLSContext,
  resetRLSContext,
  ensureTables,
  
  // Utilitare
  hasDb,
  closeAllPools
};
