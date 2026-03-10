// migrate_to_subdomain.js - Migrează Fast Medical Distribution în DB separat
require('dotenv').config();
const { Pool } = require('pg');

// Configurare
const MASTER_DB_URL = process.env.DATABASE_URL;
const COMPANY_SUBDOMAIN = 'fmd'; // Subdomeniu pentru Fast Medical Distribution
const COMPANY_CODE = 'DEFAULT553'; // Code-ul existent

async function migrate() {
  console.log('🚀 Încep migrarea Fast Medical Distribution...\n');
  
  if (!MASTER_DB_URL) {
    console.error('❌ DATABASE_URL lipsă!');
    process.exit(1);
  }

  const masterPool = new Pool({
    connectionString: MASTER_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // 1. Găsim compania în baza de date master
    console.log('📋 1. Caut compania Fast Medical Distribution...');
    const companyRes = await masterPool.query(
      'SELECT * FROM companies WHERE code = $1',
      [COMPANY_CODE]
    );
    
    if (companyRes.rows.length === 0) {
      console.error('❌ Compania cu code', COMPANY_CODE, 'nu a fost găsită!');
      process.exit(1);
    }
    
    const company = companyRes.rows[0];
    console.log('✅ Companie găsită:', company.name, '| ID:', company.id);

    // 2. Adăugăm coloana subdomain în tabela companies dacă nu există
    console.log('\n📋 2. Verific/adaug coloana subdomain...');
    try {
      await masterPool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subdomain TEXT UNIQUE`);
      console.log('✅ Coloană subdomain adăugată/verificată');
    } catch (e) {
      console.log('ℹ️', e.message);
    }

    // 3. Setăm subdomeniul pentru companie
    console.log('\n📋 3. Setez subdomeniul', COMPANY_SUBDOMAIN, 'pentru companie...');
    await masterPool.query(
      `UPDATE companies SET subdomain = $1 WHERE id = $2`,
      [COMPANY_SUBDOMAIN, company.id]
    );
    console.log('✅ Subdomeniu setat');

    // 4. Creăm baza de date separată pentru companie
    console.log('\n📋 4. Creez baza de date separată...');
    const masterUrl = new URL(MASTER_DB_URL);
    const originalDbName = masterUrl.pathname.replace('/', '');
    const companyDbName = `${originalDbName}_${COMPANY_SUBDOMAIN}`;
    
    // Conectăm la postgres pentru a crea noua bază
    masterUrl.pathname = '/postgres';
    const adminPool = new Pool({
      connectionString: masterUrl.toString(),
      ssl: { rejectUnauthorized: false }
    });

    try {
      await adminPool.query(`CREATE DATABASE "${companyDbName}"`);
      console.log('✅ Bază de date creată:', companyDbName);
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('ℹ️ Baza de date există deja:', companyDbName);
      } else {
        throw e;
      }
    } finally {
      await adminPool.end();
    }

    // 5. Conectăm la noua bază de date și creăm tabelele
    console.log('\n📋 5. Creez tabelele în noua bază de date...');
    masterUrl.pathname = `/${companyDbName}`;
    const companyPool = new Pool({
      connectionString: masterUrl.toString(),
      ssl: { rejectUnauthorized: false }
    });

    await createCompanyTables(companyPool);
    console.log('✅ Tabele create');

    // 6. Migrăm datele din baza veche în cea nouă
    console.log('\n📋 6. Migrez datele...');
    await migrateData(masterPool, companyPool, company.id);
    console.log('✅ Date migrate cu succes');

    // 7. Actualizăm userii în baza nouă
    console.log('\n📋 7. Migrez utilizatorii...');
    await migrateUsers(masterPool, companyPool, company.id);
    console.log('✅ Utilizatori migrați');

    await companyPool.end();
    await masterPool.end();

    console.log('\n🎉 MIGRARE COMPLETĂ!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Compania Fast Medical Distribution este acum configurată pentru:');
    console.log('  Subdomeniu:', COMPANY_SUBDOMAIN);
    console.log('  Bază de date:', companyDbName);
    console.log('  URL acces:', `http://${COMPANY_SUBDOMAIN}.localhost:3000`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (e) {
    console.error('\n❌ EROARE:', e);
    await masterPool.end();
    process.exit(1);
  }
}

async function createCompanyTables(pool) {
  // USERS
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // CLIENTS
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

  // PRODUCTS
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

  // STOCK
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

  // ORDERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client JSONB NOT NULL,
      items JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_procesare',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_to_smartbill BOOLEAN NOT NULL DEFAULT false,
      due_date DATE,
      payment_terms INTEGER DEFAULT 0,
      smartbill_series TEXT,
      smartbill_number TEXT,
      smartbill_error TEXT,
      smartbill_response JSONB,
      smartbill_draft_sent BOOLEAN NOT NULL DEFAULT false
    )
  `);

  // DRIVERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // VEHICLES
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      plate_number TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // TRIP_SHEETS
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

  // FUEL_RECEIPTS
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

  // COMPANY_SETTINGS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'Fast Medical Distribution',
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

  // COMPANY_CATEGORIES
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      emoji VARCHAR(10) DEFAULT '📍',
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // AUDIT
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
}

async function migrateData(masterPool, companyPool, companyId) {
  // Migrăm clienții
  console.log('   - Migrăm clienții...');
  const clients = await masterPool.query(
    'SELECT * FROM clients WHERE company_id = $1',
    [companyId]
  );
  for (const client of clients.rows) {
    await companyPool.query(
      `INSERT INTO clients (id, name, group_name, category, cui, address, city, county, phone, email, payment_terms, prices, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO NOTHING`,
      [client.id, client.name, client.group_name, client.category, client.cui, client.address, 
       client.city, client.county, client.phone, client.email, client.payment_terms, 
       client.prices, client.is_active, client.created_at]
    );
  }
  console.log(`     ✅ ${clients.rows.length} clienți migrați`);

  // Migrăm produsele
  console.log('   - Migrăm produsele...');
  const products = await masterPool.query(
    'SELECT * FROM products WHERE company_id = $1',
    [companyId]
  );
  for (const product of products.rows) {
    // Tratăm coloana gtins - poate fi JSON array sau text[]
    let gtins = product.gtins;
    if (!gtins) {
      gtins = '[]';
    } else if (typeof gtins === 'string') {
      // Deja e string, folosim ca atare
      gtins = gtins;
    } else if (Array.isArray(gtins)) {
      // E array JavaScript, convertim la JSON
      gtins = JSON.stringify(gtins);
    } else {
      // Obiect sau altceva, convertim la JSON
      gtins = JSON.stringify(gtins);
    }
    
    await companyPool.query(
      `INSERT INTO products (id, name, gtin, gtins, category, price, stock, active, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [product.id, product.name, product.gtin, gtins, product.category, 
       product.price, product.stock || 0, product.active, product.created_at]
    );
  }
  console.log(`     ✅ ${products.rows.length} produse migrate`);

  // Migrăm stocul
  console.log('   - Migrăm stocul...');
  const stock = await masterPool.query(
    'SELECT * FROM stock WHERE company_id = $1',
    [companyId]
  );
  for (const item of stock.rows) {
    await companyPool.query(
      `INSERT INTO stock (id, gtin, product_name, lot, expires_at, qty, location, warehouse, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [item.id, item.gtin, item.product_name, item.lot, item.expires_at, item.qty, 
       item.location, item.warehouse, item.created_at]
    );
  }
  console.log(`     ✅ ${stock.rows.length} înregistrări stoc migrate`);

  // Migrăm comenzile
  console.log('   - Migrăm comenzile...');
  const orders = await masterPool.query(
    'SELECT * FROM orders WHERE company_id = $1',
    [companyId]
  );
  for (const order of orders.rows) {
    // Convertim câmpurile JSON la string
    const client = typeof order.client === 'string' ? order.client : JSON.stringify(order.client);
    const items = typeof order.items === 'string' ? order.items : JSON.stringify(order.items);
    const smartbillResponse = order.smartbill_response ? 
      (typeof order.smartbill_response === 'string' ? order.smartbill_response : JSON.stringify(order.smartbill_response))
      : null;
    
    await companyPool.query(
      `INSERT INTO orders (id, client, items, status, created_at, sent_to_smartbill, due_date, 
       payment_terms, smartbill_series, smartbill_number, smartbill_error, smartbill_response, smartbill_draft_sent)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       ON CONFLICT (id) DO NOTHING`,
      [order.id, client, items, order.status, order.created_at, 
       order.sent_to_smartbill, order.due_date, order.payment_terms, order.smartbill_series, order.smartbill_number,
       order.smartbill_error, smartbillResponse, order.smartbill_draft_sent]
    );
  }
  console.log(`     ✅ ${orders.rows.length} comenzi migrate`);

  // Migrăm șoferii
  console.log('   - Migrăm șoferii...');
  const drivers = await masterPool.query(
    'SELECT * FROM drivers WHERE company_id = $1',
    [companyId]
  );
  for (const driver of drivers.rows) {
    await companyPool.query(
      `INSERT INTO drivers (id, name, active, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [driver.id, driver.name, driver.active, driver.created_at]
    );
  }
  console.log(`     ✅ ${drivers.rows.length} șoferi migrați`);

  // Migrăm vehiculele
  console.log('   - Migrăm vehiculele...');
  const vehicles = await masterPool.query(
    'SELECT * FROM vehicles WHERE company_id = $1',
    [companyId]
  );
  for (const vehicle of vehicles.rows) {
    await companyPool.query(
      `INSERT INTO vehicles (id, plate_number, active, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [vehicle.id, vehicle.plate_number, vehicle.active, vehicle.created_at]
    );
  }
  console.log(`     ✅ ${vehicles.rows.length} vehicule migrate`);

  // Migrăm foile de parcurs
  console.log('   - Migrăm foile de parcurs...');
  const tripSheets = await masterPool.query(
    'SELECT * FROM trip_sheets WHERE company_id = $1',
    [companyId]
  );
  for (const sheet of tripSheets.rows) {
    await companyPool.query(
      `INSERT INTO trip_sheets (id, date, driver_id, vehicle_id, km_start, km_end, locations, 
       trip_number, departure_time, arrival_time, purpose, tech_check_departure, tech_check_arrival,
       created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO NOTHING`,
      [sheet.id, sheet.date, sheet.driver_id, sheet.vehicle_id, sheet.km_start, sheet.km_end,
       sheet.locations, sheet.trip_number, sheet.departure_time, sheet.arrival_time, 
       sheet.purpose, sheet.tech_check_departure, sheet.tech_check_arrival, 
       sheet.created_by, sheet.created_at]
    );
  }
  console.log(`     ✅ ${tripSheets.rows.length} foi de parcurs migrate`);

  // Migrăm setările companiei
  console.log('   - Migrăm setările companiei...');
  const settings = await masterPool.query(
    'SELECT * FROM company_settings WHERE company_id = $1',
    [companyId]
  );
  if (settings.rows.length > 0) {
    const s = settings.rows[0];
    await companyPool.query(
      `INSERT INTO company_settings (id, name, cui, smartbill_token, smartbill_series, address, 
       city, county, country, phone, email, bank_name, bank_iban, registration_number, vat_number)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, cui = EXCLUDED.cui, smartbill_token = EXCLUDED.smartbill_token,
       smartbill_series = EXCLUDED.smartbill_series, address = EXCLUDED.address,
       city = EXCLUDED.city, county = EXCLUDED.county, country = EXCLUDED.country,
       phone = EXCLUDED.phone, email = EXCLUDED.email, bank_name = EXCLUDED.bank_name,
       bank_iban = EXCLUDED.bank_iban, registration_number = EXCLUDED.registration_number,
       vat_number = EXCLUDED.vat_number, updated_at = now()`,
      [s.name, s.cui, s.smartbill_token, s.smartbill_series, s.address, s.city, 
       s.county, s.country, s.phone, s.email, s.bank_name, s.bank_iban, 
       s.registration_number, s.vat_number]
    );
    console.log('     ✅ Setări migrate');
  }

  // Migrăm categoriile
  console.log('   - Migrăm categoriile...');
  const categories = await masterPool.query(
    'SELECT * FROM company_categories WHERE company_id = $1',
    [companyId]
  );
  for (const cat of categories.rows) {
    await companyPool.query(
      `INSERT INTO company_categories (id, name, emoji, sort_order, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [cat.id, cat.name, cat.emoji, cat.sort_order, cat.is_active, cat.created_at]
    );
  }
  console.log(`     ✅ ${categories.rows.length} categorii migrate`);
}

async function migrateUsers(masterPool, companyPool, companyId) {
  const users = await masterPool.query(
    `SELECT * FROM users WHERE company_id = $1 OR pending_company_id = $1`,
    [companyId]
  );

  for (const user of users.rows) {
    // Mapăm rolurile - superadmin rămâne, restul devin admin/user
    let role = user.role;
    if (role === 'superadmin') {
      role = 'admin'; // În noua structură, fiecare companie are doar admin
    }

    await companyPool.query(
      `INSERT INTO users (id, username, password_hash, role, first_name, last_name, position, 
       phone, email, active, is_approved, failed_attempts, email_verified, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO NOTHING`,
      [user.id, user.username, user.password_hash, role, user.first_name, user.last_name,
       user.position, user.phone, user.email, user.active, user.is_approved, 
       user.failed_attempts || 0, user.email_verified || false, user.created_at]
    );
  }
  console.log(`     ✅ ${users.rows.length} utilizatori migrați`);
}

migrate();
