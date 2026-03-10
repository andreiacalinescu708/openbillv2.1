// import_backup_to_railway.js
// Importă datele din backup-data.json în Railway

const { Pool } = require('pg');
const fs = require('fs');
const crypto = require('crypto');

const RAILWAY_DB_URL = process.env.DATABASE_URL;

async function importBackup() {
  console.log('🚀 Începem importul din backup...\n');
  
  if (!RAILWAY_DB_URL) {
    console.error('❌ DATABASE_URL nu este setat!');
    process.exit(1);
  }
  
  // Citim backup-ul
  const backupData = JSON.parse(fs.readFileSync('backup-data.json', 'utf8'));
  const data = backupData.data;
  
  console.log(`📦 Backup exportat la: ${backupData.exported_at}`);
  console.log(`📊 Conține:`);
  console.log(`   - ${data.companies?.length || 0} companii`);
  console.log(`   - ${data.users?.length || 0} utilizatori`);
  console.log(`   - ${data.clients?.length || 0} clienți`);
  console.log(`   - ${data.products?.length || 0} produse`);
  console.log(`   - ${data.stock?.length || 0} intrări stoc`);
  console.log(`   - ${data.orders?.length || 0} comenzi\n`);
  
  // Găsim compania Fast Medical
  const fastMedicalCompany = data.companies.find(c => 
    c.name.toLowerCase().includes('fast') && c.name.toLowerCase().includes('medical')
  );
  
  if (!fastMedicalCompany) {
    console.error('❌ Compania Fast Medical nu a fost găsită în backup!');
    console.log('Companii disponibile:');
    data.companies.forEach(c => console.log(`   - ${c.name}`));
    return;
  }
  
  console.log(`✅ Companie găsită: ${fastMedicalCompany.name} (${fastMedicalCompany.code})\n`);
  
  // Conectare la Railway
  const railwayPool = new Pool({
    connectionString: RAILWAY_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    // 1. Creăm compania în Master DB
    console.log('🏢 Creăm compania în Railway Master DB...');
    const newCompanyId = crypto.randomUUID();
    const subdomain = 'fastmedical';
    
    await railwayPool.query(`
      INSERT INTO companies (id, code, name, cui, address, phone, email,
                           plan, plan_price, max_users, subscription_status,
                           subscription_expires_at, subdomain, status, settings, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (subdomain) DO UPDATE SET
        name = EXCLUDED.name,
        status = 'active'
      RETURNING id
    `, [
      newCompanyId,
      fastMedicalCompany.code || 'FMD',
      fastMedicalCompany.name,
      fastMedicalCompany.cui,
      fastMedicalCompany.address,
      fastMedicalCompany.phone,
      fastMedicalCompany.email,
      'enterprise',
      59.99,
      999,
      'active',
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 an
      subdomain,
      'active',
      JSON.stringify(fastMedicalCompany.settings || {}),
      fastMedicalCompany.created_at || new Date()
    ]);
    console.log(`✅ Companie creată cu ID: ${newCompanyId}`);
    console.log(`   Subdomeniu: ${subdomain}.openbillv21-production.up.railway.app\n`);
    
    // 2. Creăm baza de date pentru companie
    console.log('🗄️ Creăm baza de date...');
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
        console.log(`ℹ️ Baza de date există deja`);
      } else {
        throw e;
      }
    }
    await adminPool.end();
    
    // 3. Creăm tabelele
    console.log('📊 Creăm tabelele...');
    const db = require('./db');
    const companyPool = new Pool({
      connectionString: RAILWAY_DB_URL.replace(/\/[^/]+$/, `/${companyDbName}`),
      ssl: { rejectUnauthorized: false }
    });
    
    await db.ensureCompanyTables(companyPool);
    console.log('✅ Tabele create\n');
    
    // 4. Importăm utilizatorii companiei
    console.log('👤 Importăm utilizatorii...');
    const companyUsers = data.users.filter(u => 
      u.company_id === fastMedicalCompany.id || 
      u.email?.toLowerCase().includes('fastmedical')
    );
    
    // Dacă nu găsim utilizatori specifici, luăm toți utilizatorii
    const usersToImport = companyUsers.length > 0 ? companyUsers : data.users.slice(0, 5);
    
    let importedUsers = 0;
    for (const user of usersToImport) {
      try {
        await companyPool.query(`
          INSERT INTO users (id, username, password_hash, email, first_name, last_name,
                            position, phone, role, active, is_approved, email_verified,
                            failed_attempts, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (username) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role
        `, [
          user.id || crypto.randomUUID(),
          user.username || user.email,
          user.password_hash, // Păstrăm parola originală!
          user.email || user.username,
          user.first_name || 'Admin',
          user.last_name || 'FastMedical',
          user.position || 'Administrator',
          user.phone,
          user.role === 'superadmin' ? 'superadmin' : 'admin',
          user.active !== false,
          user.is_approved !== false,
          user.email_verified === true,
          user.failed_attempts || 0,
          user.created_at || new Date()
        ]);
        importedUsers++;
        console.log(`   ✅ ${user.username} (${user.role})`);
      } catch (e) {
        console.log(`   ⚠️ Eroare ${user.username}: ${e.message}`);
      }
    }
    console.log(`✅ ${importedUsers} utilizatori importați\n`);
    
    // 5. Importăm clienții
    console.log('📋 Importăm clienții...');
    const companyClients = data.clients?.filter(c => 
      c.company_id === fastMedicalCompany.id
    ) || [];
    
    let importedClients = 0;
    for (const client of companyClients) {
      try {
        await companyPool.query(`
          INSERT INTO clients (id, name, cui, group_name, category, address, city, county,
                             phone, email, payment_terms, prices, is_active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (id) DO NOTHING
        `, [
          client.id || crypto.randomUUID(),
          client.name,
          client.cui,
          client.group_name,
          client.category,
          client.address,
          client.city,
          client.county,
          client.phone,
          client.email,
          client.payment_terms || 0,
          typeof client.prices === 'string' ? client.prices : JSON.stringify(client.prices || {}),
          client.is_active !== false,
          client.created_at || new Date()
        ]);
        importedClients++;
      } catch (e) {
        // Ignorăm erori individuale
      }
    }
    console.log(`✅ ${importedClients} clienți importați\n`);
    
    // 6. Importăm produsele
    console.log('📦 Importăm produsele...');
    const companyProducts = data.products?.filter(p => 
      p.company_id === fastMedicalCompany.id || p.active !== false
    ) || [];
    
    let importedProducts = 0;
    for (const prod of companyProducts) {
      try {
        await companyPool.query(`
          INSERT INTO products (id, name, gtin, gtins, category, price, stock, active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO NOTHING
        `, [
          prod.id || crypto.randomUUID(),
          prod.name,
          prod.gtin,
          Array.isArray(prod.gtins) ? JSON.stringify(prod.gtins) : JSON.stringify([prod.gtin]),
          prod.category,
          prod.price || 0,
          prod.stock || 0,
          prod.active !== false,
          prod.created_at || new Date()
        ]);
        importedProducts++;
      } catch (e) {
        // Ignorăm erori
      }
    }
    console.log(`✅ ${importedProducts} produse importate\n`);
    
    // 7. Importăm stocul
    console.log('📦 Importăm stocul...');
    const companyStock = data.stock?.filter(s => 
      s.company_id === fastMedicalCompany.id
    ) || [];
    
    let importedStock = 0;
    for (const item of companyStock) {
      try {
        await companyPool.query(`
          INSERT INTO stock (id, gtin, product_name, lot, expires_at, qty, location, warehouse, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO NOTHING
        `, [
          item.id || crypto.randomUUID(),
          item.gtin,
          item.product_name,
          item.lot || 'N/A',
          item.expires_at ? new Date(item.expires_at) : new Date('2025-12-31'),
          item.qty || 0,
          item.location || 'A',
          item.warehouse || 'depozit',
          item.created_at || new Date()
        ]);
        importedStock++;
      } catch (e) {
        // Ignorăm erori
      }
    }
    console.log(`✅ ${importedStock} intrări de stoc importate\n`);
    
    // 8. Importăm comenzile
    console.log('📋 Importăm comenzile...');
    const companyOrders = data.orders?.filter(o => 
      o.company_id === fastMedicalCompany.id
    ) || [];
    
    let importedOrders = 0;
    for (const order of companyOrders.slice(0, 1000)) { // Limităm la 1000 comenzi
      try {
        await companyPool.query(`
          INSERT INTO orders (id, client_id, items, total, status, due_date, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO NOTHING
        `, [
          order.id || crypto.randomUUID(),
          order.client_id,
          typeof order.items === 'string' ? order.items : JSON.stringify(order.items || []),
          order.total || 0,
          order.status || 'completed',
          order.due_date ? new Date(order.due_date) : new Date(),
          order.created_at ? new Date(order.created_at) : new Date()
        ]);
        importedOrders++;
      } catch (e) {
        // Ignorăm erori
      }
    }
    console.log(`✅ ${importedOrders} comenzi importate\n`);
    
    // 9. Importăm șoferii și vehiculele
    console.log('🚚 Importăm șoferii și vehiculele...');
    const drivers = data.drivers?.filter(d => d.company_id === fastMedicalCompany.id) || [];
    const vehicles = data.vehicles?.filter(v => v.company_id === fastMedicalCompany.id) || [];
    
    for (const driver of drivers) {
      try {
        await companyPool.query(`
          INSERT INTO drivers (id, name, active, created_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO NOTHING
        `, [driver.id || crypto.randomUUID(), driver.name, driver.active !== false, driver.created_at || new Date()]);
      } catch (e) {}
    }
    
    for (const vehicle of vehicles) {
      try {
        await companyPool.query(`
          INSERT INTO vehicles (id, plate_number, active, created_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO NOTHING
        `, [vehicle.id || crypto.randomUUID(), vehicle.plate_number, vehicle.active !== false, vehicle.created_at || new Date()]);
      } catch (e) {}
    }
    console.log(`✅ ${drivers.length} șoferi, ${vehicles.length} vehicule\n`);
    
    await companyPool.end();
    await railwayPool.end();
    
    console.log('🎉 IMPORT COMPLET!');
    console.log('\n📍 Accesează aplicația la:');
    console.log(`   https://${subdomain}.openbillv21-production.up.railway.app`);
    console.log('\n🔑 Login cu:');
    console.log(`   Username: alex1 (sau email-ul tău)`);
    console.log(`   Parola: (aceeași ca în aplicația locală)`);
    
  } catch (error) {
    console.error('\n❌ Eroare la import:', error.message);
    console.error(error.stack);
  }
}

importBackup();
