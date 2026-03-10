// migrate_multi_tenant.js
// Script pentru migrarea datelor existente la arhitectura multi-tenant

require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL nu este setat în .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function q(text, params) {
  return pool.query(text, params);
}

// Adaugă coloană dacă nu există
async function addColumnIfNotExists(table, column, type, defaultValue = null) {
  try {
    await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
    if (defaultValue !== null) {
      await q(`UPDATE ${table} SET ${column} = ${defaultValue} WHERE ${column} IS NULL`);
    }
    console.log(`   ✅ Coloană ${table}.${column} verificată/adăugată`);
  } catch (e) {
    console.error(`   ❌ Eroare la ${table}.${column}:`, e.message);
  }
}

async function migrate() {
  console.log('🚀 Începem migrarea la multi-tenant...\n');

  try {
    // ========== PAS 0: Adăugăm coloanele lipsă în tabela companies ==========
    console.log('📦 Pas 0: Adăugăm coloanele lipsă în companies...');
    
    await addColumnIfNotExists('companies', 'code', 'TEXT');
    await addColumnIfNotExists('companies', 'plan', 'TEXT', "'starter'");
    await addColumnIfNotExists('companies', 'plan_price', 'NUMERIC(10,2)', '29.99');
    await addColumnIfNotExists('companies', 'max_users', 'INTEGER', '3');
    await addColumnIfNotExists('companies', 'subscription_status', 'TEXT', "'active'");
    await addColumnIfNotExists('companies', 'subscription_expires_at', 'TIMESTAMPTZ', "NOW() + INTERVAL '1 year'");
    await addColumnIfNotExists('companies', 'cui', 'TEXT');
    await addColumnIfNotExists('companies', 'address', 'TEXT');
    await addColumnIfNotExists('companies', 'phone', 'TEXT');
    await addColumnIfNotExists('companies', 'email', 'TEXT');
    await addColumnIfNotExists('companies', 'settings', 'JSONB', "'{}'::jsonb");
    await addColumnIfNotExists('companies', 'updated_at', 'TIMESTAMPTZ', 'NOW()');

    // Verificăm dacă există index pe code
    try {
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_code ON companies (code)`);
      console.log('   ✅ Index pe companies.code creat');
    } catch (e) {
      console.log('   ℹ️ Index pe code există deja sau nu poate fi creat');
    }

    // ========== PAS 1: Creăm compania default pentru datele existente ==========
    console.log('\n📦 Pas 1: Creăm compania DEFAULT...');
    
    const existingCompanies = await q(`SELECT COUNT(*)::int as n FROM companies`);
    
    let companyId;
    
    if (existingCompanies.rows[0].n > 0) {
      // Actualizăm companiile existente să aibă code
      const companiesWithoutCode = await q(`SELECT id FROM companies WHERE code IS NULL`);
      
      for (const row of companiesWithoutCode.rows) {
        const newCode = 'DEFAULT' + Math.floor(Math.random() * 1000);
        await q(`UPDATE companies SET code = $1 WHERE id = $2`, [newCode, row.id]);
        companyId = row.id;
        console.log(`   ✅ Companie existentă actualizată cu code: ${newCode}`);
      }
      
      // Dacă toate au code, luăm prima
      if (!companyId) {
        const firstCompany = await q(`SELECT id, code FROM companies LIMIT 1`);
        companyId = firstCompany.rows[0].id;
        console.log(`   ℹ️ Folosim compania existentă: ${firstCompany.rows[0].code}`);
      }
    } else {
      // Creăm companie nouă
      companyId = crypto.randomUUID();
      
      await q(
        `INSERT INTO companies (id, code, name, plan, plan_price, max_users, subscription_status, subscription_expires_at)
         VALUES ($1, 'DEFAULT', 'Compania Mea', 'enterprise', 59.99, 999, 'active', NOW() + INTERVAL '1 year')`,
        [companyId]
      );
      
      console.log(`   ✅ Companie default creată: ${companyId}`);
    }

    // Company settings
    try {
      await q(
        `INSERT INTO company_settings (company_id, name, cui, smartbill_series)
         VALUES ($1, 'Compania Mea', 'RO47095864', 'OB')
         ON CONFLICT (company_id) DO NOTHING`,
        [companyId]
      );
      console.log('   ✅ Company settings verificate');
    } catch (e) {
      console.log('   ℹ️ Company settings există sau tabela nu există');
    }

    // ========== PAS 2: Adăugăm company_id la toate tabelele ==========
    console.log('\n📦 Pas 2: Adăugăm coloana company_id tabelelor...');
    
    const tables = [
      { name: 'users', hasTable: false },
      { name: 'clients', hasTable: false },
      { name: 'products', hasTable: false },
      { name: 'orders', hasTable: false },
      { name: 'stock', hasTable: false },
      { name: 'drivers', hasTable: false },
      { name: 'vehicles', hasTable: false },
      { name: 'trip_sheets', hasTable: false },
      { name: 'fuel_receipts', hasTable: false },
      { name: 'stock_transfers', hasTable: false },
      { name: 'audit', hasTable: false },
      { name: 'client_balances', hasTable: false },
      { name: 'subscription_invoices', hasTable: false }
    ];

    // Verificăm care tabele există
    for (const table of tables) {
      try {
        await q(`SELECT 1 FROM ${table.name} LIMIT 1`);
        table.hasTable = true;
      } catch (e) {
        table.hasTable = false;
      }
    }

    // Adăugăm company_id și migrăm datele pentru fiecare tabelă existentă
    for (const table of tables) {
      if (!table.hasTable) {
        console.log(`   ⏭️ Tabela ${table.name} nu există, sărim`);
        continue;
      }

      // Adăugăm coloana company_id
      await addColumnIfNotExists(table.name, 'company_id', 'TEXT');

      // Verificăm câte rânduri nu au company_id
      const countRes = await q(
        `SELECT COUNT(*)::int as n FROM ${table.name} WHERE company_id IS NULL`
      );
      
      if (countRes.rows[0].n > 0) {
        // Actualizăm rândurile fără company_id
        await q(
          `UPDATE ${table.name} SET company_id = $1 WHERE company_id IS NULL`,
          [companyId]
        );
        console.log(`   ✅ ${countRes.rows[0].n} rânduri actualizate în ${table.name}`);
      } else {
        console.log(`   ℹ️ Toate rândurile din ${table.name} au deja company_id`);
      }

      // Adăugăm index pentru performanță
      try {
        await q(`CREATE INDEX IF NOT EXISTS idx_${table.name}_company ON ${table.name} (company_id)`);
      } catch (e) {
        // Indexul poate exista deja
      }
    }

    // ========== REZUMAT ==========
    console.log('\n' + '='.repeat(60));
    console.log('✅ Migrare completă!');
    console.log('='.repeat(60));
    console.log(`\n📌 Compania are ID-ul: ${companyId}`);
    console.log('   Toate datele au fost asociate cu această companie.');
    console.log('\n💡 Pentru a crea un nou client (tenant):');
    console.log('   node seed_second_company.js');
    console.log('\n💡 Pentru a activa un client existent:');
    console.log('   node setup_existing_company.js');
    console.log('\n🚀 Acum poți porni serverul:');
    console.log('   node server.js');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Eroare la migrare:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

migrate();
