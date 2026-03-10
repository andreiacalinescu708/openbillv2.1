// migrate_local_to_railway.js
// Script pentru migrarea datelor din DB local în Railway

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// Configurare DB locală (de unde copiem)
const LOCAL_DB_CONFIG = {
  host: process.env.LOCAL_DB_HOST || 'localhost',
  port: process.env.LOCAL_DB_PORT || 5432,
  database: process.env.LOCAL_DB_NAME || 'openbill',
  user: process.env.LOCAL_DB_USER || 'postgres',
  password: process.env.LOCAL_DB_PASS || 'postgres',
  ssl: false
};

// Configurare DB Railway (unde copiem)
const RAILWAY_DB_URL = process.env.DATABASE_URL;

async function migrate() {
  console.log('🚀 Începem migrarea datelor...\n');
  
  const localPool = new Pool(LOCAL_DB_CONFIG);
  const railwayPool = new Pool({
    connectionString: RAILWAY_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    // 1. Găsim compania Fast Medical din DB locală
    console.log('📋 Căutăm compania Fast Medical în DB locală...');
    const localCompanyRes = await localPool.query(
      `SELECT * FROM companies WHERE LOWER(name) LIKE '%fast%' OR LOWER(name) LIKE '%medical%' LIMIT 1`
    );
    
    if (localCompanyRes.rows.length === 0) {
      console.log('⚠️ Nu am găsit compania Fast Medical în DB locală');
      console.log('   Companii disponibile în DB local:');
      const allCompanies = await localPool.query(`SELECT id, name, code FROM companies`);
      allCompanies.rows.forEach(c => console.log(`   - ${c.name} (cod: ${c.code})`));
      return;
    }
    
    const localCompany = localCompanyRes.rows[0];
    console.log(`✅ Companie găsită: ${localCompany.name} (${localCompany.code})\n`);
    
    // 2. Găsim utilizatorul alex1
    console.log('👤 Căutăm utilizatorul alex1...');
    const localUserRes = await localPool.query(
      `SELECT * FROM users WHERE username = 'alex1' OR LOWER(email) = 'alex1' LIMIT 1`
    );
    
    if (localUserRes.rows.length === 0) {
      console.log('⚠️ Nu am găsit utilizatorul alex1');
      console.log('   Utilizatori disponibili:');
      const allUsers = await localPool.query(`SELECT id, username, email, role FROM users LIMIT 10`);
      allUsers.rows.forEach(u => console.log(`   - ${u.username} (${u.email}) - ${u.role}`));
      return;
    }
    
    const localUser = localUserRes.rows[0];
    console.log(`✅ Utilizator găsit: ${localUser.username} (${localUser.email})\n`);
    
    // 3. Creăm compania în Railway Master DB
    console.log('🏢 Creăm compania în Railway...');
    const companyId = require('crypto').randomUUID();
    const subdomain = 'fastmedical'; // sau generează automat
    
    await railwayPool.query(`
      INSERT INTO companies (id, code, name, cui, address, phone, email, 
                           plan, plan_price, max_users, subscription_status, 
                           subscription_expires_at, subdomain, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'enterprise', 59.99, 999, 'active',
              NOW() + INTERVAL '1 year', $8, 'active', NOW())
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        status = 'active'
      RETURNING id
    `, [
      companyId,
      localCompany.code || 'FMD',
      localCompany.name,
      localCompany.cui || null,
      localCompany.address || null,
      localCompany.phone || null,
      localCompany.email || null,
      subdomain
    ]);
    console.log(`✅ Companie creată în Railway cu ID: ${companyId}`);
    console.log(`   Subdomeniu: ${subdomain}.openbillv21-production.up.railway.app\n`);
    
    // 4. Creăm DB-ul pentru companie
    console.log('🗄️ Creăm baza de date pentru companie...');
    const masterUrl = new URL(RAILWAY_DB_URL);
    const companyDbName = `${masterUrl.pathname.replace('/', '')}_${subdomain}`;
    
    const adminPool = new Pool({
      connectionString: RAILWAY_DB_URL.replace(/\/[^/]+$/, '/postgres'),
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await adminPool.query(`CREATE DATABASE "${companyDbName}"`);
      console.log(`✅ Bază de date creată: ${companyDbName}`);
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log(`ℹ️ Baza de date ${companyDbName} există deja`);
      } else {
        throw e;
      }
    }
    await adminPool.end();
    
    // 5. Creăm tabelele în noua DB
    console.log('📊 Creăm tabelele...');
    const companyPool = new Pool({
      connectionString: RAILWAY_DB_URL.replace(/\/[^/]+$/, `/${companyDbName}`),
      ssl: { rejectUnauthorized: false }
    });
    
    // Importăm funcția ensureCompanyTables din db.js
    const db = require('./db');
    await db.ensureCompanyTables(companyPool);
    console.log('✅ Tabele create\n');
    
    // 6. Copiem utilizatorul
    console.log('👤 Copiem utilizatorul alex1...');
    await companyPool.query(`
      INSERT INTO users (id, username, password_hash, email, first_name, last_name,
                        role, position, active, is_approved, email_verified, 
                        failed_attempts, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'superadmin', 'Administrator', true, true, true, 0, NOW())
      ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role = 'superadmin'
    `, [
      localUser.id,
      localUser.username || localUser.email,
      localUser.password_hash, // Păstrăm hash-ul existent
      localUser.email || localUser.username,
      localUser.first_name || 'Alex',
      localUser.last_name || 'Admin'
    ]);
    console.log('✅ Utilizator copiat\n');
    
    // 7. Copiem clienții
    console.log('📋 Copiem clienții...');
    const clientsRes = await localPool.query(`SELECT * FROM clients`);
    for (const client of clientsRes.rows) {
      try {
        await companyPool.query(`
          INSERT INTO clients (id, name, cui, group_name, category, address, city, county,
                             phone, email, payment_terms, prices, is_active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (id) DO NOTHING
        `, [
          client.id, client.name, client.cui, client.group_name, client.category,
          client.address, client.city, client.county, client.phone, client.email,
          client.payment_terms || 0, client.prices || '{}', client.is_active !== false, 
          client.created_at || new Date()
        ]);
      } catch (e) {
        console.log(`   ⚠️ Eroare client ${client.name}: ${e.message}`);
      }
    }
    console.log(`✅ ${clientsRes.rows.length} clienți copiați\n`);
    
    // 8. Copiem produsele
    console.log('📦 Copiem produsele...');
    const productsRes = await localPool.query(`SELECT * FROM products WHERE active = true`);
    for (const prod of productsRes.rows) {
      try {
        await companyPool.query(`
          INSERT INTO products (id, name, gtin, gtins, category, price, stock, active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO NOTHING
        `, [
          prod.id, prod.name, prod.gtin, prod.gtins || JSON.stringify([prod.gtin]),
          prod.category, prod.price, prod.stock || 0, true, prod.created_at || new Date()
        ]);
      } catch (e) {
        console.log(`   ⚠️ Eroare produs ${prod.name}: ${e.message}`);
      }
    }
    console.log(`✅ ${productsRes.rows.length} produse copiate\n`);
    
    // 9. Copiem stocul
    console.log('📦 Copiem stocul...');
    const stockRes = await localPool.query(`SELECT * FROM stock`);
    for (const item of stockRes.rows) {
      try {
        await companyPool.query(`
          INSERT INTO stock (id, gtin, product_name, lot, expires_at, qty, location, warehouse, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO NOTHING
        `, [
          item.id, item.gtin, item.product_name, item.lot, item.expires_at,
          item.qty, item.location || 'A', item.warehouse || 'depozit', item.created_at || new Date()
        ]);
      } catch (e) {
        // Ignorăm erori de stoc
      }
    }
    console.log(`✅ ${stockRes.rows.length} intrări de stoc copiate\n`);
    
    // 10. Copiem comenzile
    console.log('📋 Copiem comenzile...');
    const ordersRes = await localPool.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 1000`);
    for (const order of ordersRes.rows) {
      try {
        await companyPool.query(`
          INSERT INTO orders (id, client_id, items, total, status, due_date, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO NOTHING
        `, [
          order.id, order.client_id, order.items, order.total, 
          order.status || 'pending', order.due_date, order.created_at || new Date()
        ]);
      } catch (e) {
        // Ignorăm erori de comenzi
      }
    }
    console.log(`✅ ${ordersRes.rows.length} comenzi copiate\n`);
    
    await companyPool.end();
    
    console.log('🎉 Migrare completă!');
    console.log('\n📍 Accesează aplicația la:');
    console.log(`   https://${subdomain}.openbillv21-production.up.railway.app`);
    console.log('\n🔑 Login cu:');
    console.log(`   Email: ${localUser.email || localUser.username}`);
    console.log(`   Parola: (aceeași ca în local)`);
    
  } catch (error) {
    console.error('\n❌ Eroare la migrare:', error.message);
    console.error(error.stack);
  } finally {
    await localPool.end();
    await railwayPool.end();
  }
}

// Verificăm dacă avem configurația necesară
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL nu este setat în .env');
  process.exit(1);
}

migrate();
