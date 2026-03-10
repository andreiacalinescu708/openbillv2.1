// seed_second_company.js
// Creează un al doilea client (tenant) pentru testare multi-tenant
// Rulează: node seed_second_company.js

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
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

// Date pentru al doilea client
const SECOND_COMPANY = {
  code: 'CLIENT2',
  name: 'Clientul Doi SRL',
  cui: 'RO12345678',
  address: 'Strada Exemplu nr. 123, București',
  phone: '0722-123-456',
  email: 'contact@client2.ro',
  plan: 'pro', // Starter / Pro / Enterprise
  planPrice: 39.99
};

const SECOND_ADMIN = {
  username: 'admin2',
  password: 'parola123'
};

// Clienți de test pentru compania 2
const TEST_CLIENTS = [
  { name: 'Magazin Central', group: 'Bucuresti', category: 'Sector 1', cui: 'RO11111111' },
  { name: 'Market Unirii', group: 'Bucuresti', category: 'Sector 3', cui: 'RO22222222' },
  { name: 'Shop Pipera', group: 'Bucuresti', category: 'Sector 2', cui: 'RO33333333' },
  { name: 'Mini Market Otopeni', group: 'Ilfov', category: 'Otopeni', cui: 'RO44444444' },
];

// Produse de test pentru compania 2
const TEST_PRODUCTS = [
  { name: 'Laptop Dell XPS 13', gtin: '1234567890123', category: 'Electronice', price: 4500.00 },
  { name: 'Mouse Wireless Logitech', gtin: '1234567890124', category: 'Accesorii', price: 150.00 },
  { name: 'Tastatură Mecanică', gtin: '1234567890125', category: 'Accesorii', price: 450.00 },
  { name: 'Monitor 27\" LG', gtin: '1234567890126', category: 'Electronice', price: 1200.00 },
  { name: 'Webcam HD', gtin: '1234567890127', category: 'Accesorii', price: 280.00 },
];

// Stoc de test pentru compania 2
const TEST_STOCK = [
  { gtin: '1234567890123', productName: 'Laptop Dell XPS 13', lot: 'LOT001', expiresAt: '2026-12-31', qty: 50, location: 'A' },
  { gtin: '1234567890124', productName: 'Mouse Wireless Logitech', lot: 'LOT002', expiresAt: '2026-12-31', qty: 200, location: 'B' },
  { gtin: '1234567890125', productName: 'Tastatură Mecanică', lot: 'LOT003', expiresAt: '2026-12-31', qty: 100, location: 'A' },
  { gtin: '1234567890126', productName: 'Monitor 27\" LG', lot: 'LOT004', expiresAt: '2026-12-31', qty: 30, location: 'C' },
  { gtin: '1234567890127', productName: 'Webcam HD', lot: 'LOT005', expiresAt: '2026-12-31', qty: 150, location: 'B' },
];

async function seedSecondCompany() {
  console.log('🚀 Creăm al doilea client (tenant) pentru testare...\n');

  try {
    // ========== PAS 1: Creăm compania ==========
    console.log('📦 Pas 1: Creăm compania...');
    
    // Verificăm dacă există deja
    const existingCompany = await q(
      `SELECT id FROM companies WHERE code = $1`,
      [SECOND_COMPANY.code]
    );
    
    let companyId;
    
    if (existingCompany.rows.length > 0) {
      companyId = existingCompany.rows[0].id;
      console.log(`   ℹ️ Compania ${SECOND_COMPANY.code} există deja cu ID: ${companyId}`);
    } else {
      companyId = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 12); // 1 an abonament
      
      await q(
        `INSERT INTO companies (id, code, name, cui, address, phone, email, plan, plan_price, max_users, subscription_status, subscription_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)`,
        [
          companyId,
          SECOND_COMPANY.code,
          SECOND_COMPANY.name,
          SECOND_COMPANY.cui,
          SECOND_COMPANY.address,
          SECOND_COMPANY.phone,
          SECOND_COMPANY.email,
          SECOND_COMPANY.plan,
          SECOND_COMPANY.planPrice,
          10, // max_users pentru plan Pro
          expiresAt
        ]
      );
      
      await q(
        `INSERT INTO company_settings (company_id, name, cui, smartbill_series)
         VALUES ($1, $2, $3, 'C2')`,
        [companyId, SECOND_COMPANY.name, SECOND_COMPANY.cui]
      );
      
      console.log(`   ✅ Companie creată: ${SECOND_COMPANY.name} (${companyId})`);
    }

    // ========== PAS 2: Creăm admin-ul ==========
    console.log('\n👤 Pas 2: Creăm administratorul...');
    
    const existingUser = await q(
      `SELECT id FROM users WHERE username = $1`,
      [SECOND_ADMIN.username]
    );
    
    if (existingUser.rows.length > 0) {
      // Actualizăm company_id dacă există
      await q(
        `UPDATE users SET company_id = $1 WHERE username = $2`,
        [companyId, SECOND_ADMIN.username]
      );
      console.log(`   ℹ️ Utilizatorul ${SECOND_ADMIN.username} actualizat cu company_id`);
    } else {
      const passwordHash = await bcrypt.hash(SECOND_ADMIN.password, 10);
      
      await q(
        `INSERT INTO users (company_id, username, password_hash, role, active, is_approved, failed_attempts)
         VALUES ($1, $2, $3, 'admin', true, true, 0)`,
        [companyId, SECOND_ADMIN.username, passwordHash]
      );
      
      console.log(`   ✅ Administrator creat: ${SECOND_ADMIN.username} / ${SECOND_ADMIN.password}`);
    }

    // ========== PAS 3: Creăm clienții de test ==========
    console.log('\n🏢 Pas 3: Creăm clienții de test...');
    
    for (const client of TEST_CLIENTS) {
      const existingClient = await q(
        `SELECT id FROM clients WHERE company_id = $1 AND name = $2`,
        [companyId, client.name]
      );
      
      if (existingClient.rows.length === 0) {
        const id = crypto.randomUUID();
        await q(
          `INSERT INTO clients (id, company_id, name, group_name, category, cui, prices)
           VALUES ($1, $2, $3, $4, $5, $6, '{}')`,
          [id, companyId, client.name, client.group, client.category, client.cui]
        );
        console.log(`   ✅ Client: ${client.name}`);
      } else {
        console.log(`   ℹ️ Client existent: ${client.name}`);
      }
    }

    // ========== PAS 4: Creăm produsele de test ==========
    console.log('\n📦 Pas 4: Creăm produsele de test...');
    
    for (const product of TEST_PRODUCTS) {
      const existingProduct = await q(
        `SELECT id FROM products WHERE company_id = $1 AND gtin = $2`,
        [companyId, product.gtin]
      );
      
      if (existingProduct.rows.length === 0) {
        const id = crypto.randomUUID();
        await q(
          `INSERT INTO products (id, company_id, name, gtin, gtins, category, price, active)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, true)`,
          [id, companyId, product.name, product.gtin, JSON.stringify([product.gtin]), product.category, product.price]
        );
        console.log(`   ✅ Produs: ${product.name}`);
      } else {
        console.log(`   ℹ️ Produs existent: ${product.name}`);
      }
    }

    // ========== PAS 5: Creăm stocul de test ==========
    console.log('\n📦 Pas 5: Creăm stocul de test...');
    
    for (const item of TEST_STOCK) {
      const existingStock = await q(
        `SELECT id FROM stock WHERE company_id = $1 AND gtin = $2 AND lot = $3`,
        [companyId, item.gtin, item.lot]
      );
      
      if (existingStock.rows.length === 0) {
        const id = crypto.randomUUID();
        await q(
          `INSERT INTO stock (id, company_id, gtin, product_name, lot, expires_at, qty, location, warehouse)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'depozit')`,
          [id, companyId, item.gtin, item.productName, item.lot, item.expiresAt, item.qty, item.location]
        );
        console.log(`   ✅ Stoc: ${item.productName} (${item.qty} buc)`);
      } else {
        console.log(`   ℹ️ Stoc existent: ${item.productName}`);
      }
    }

    // ========== PAS 6: Creăm șoferi și mașini ==========
    console.log('\n🚚 Pas 6: Creăm șoferi și mașini...');
    
    const soferi = ['Ion Popescu', 'Maria Ionescu'];
    for (const nume of soferi) {
      const check = await q(
        `SELECT id FROM drivers WHERE company_id = $1 AND name = $2`,
        [companyId, nume]
      );
      if (check.rows.length === 0) {
        const id = crypto.randomUUID();
        await q(
          `INSERT INTO drivers (id, company_id, name, active) VALUES ($1, $2, $3, true)`,
          [id, companyId, nume]
        );
        console.log(`   ✅ Șofer: ${nume}`);
      }
    }
    
    const masini = ['B-123-XYZ', 'B-456-ABC'];
    for (const numar of masini) {
      const check = await q(
        `SELECT id FROM vehicles WHERE company_id = $1 AND plate_number = $2`,
        [companyId, numar]
      );
      if (check.rows.length === 0) {
        const id = crypto.randomUUID();
        await q(
          `INSERT INTO vehicles (id, company_id, plate_number, active) VALUES ($1, $2, $3, true)`,
          [id, companyId, numar]
        );
        console.log(`   ✅ Mașină: ${numar}`);
      }
    }

    // ========== REZUMAT ==========
    console.log('\n' + '='.repeat(60));
    console.log('✅ Al doilea client a fost creat cu succes!');
    console.log('='.repeat(60));
    console.log(`\n📌 DETALII COMPANIE:`);
    console.log(`   Cod: ${SECOND_COMPANY.code}`);
    console.log(`   Nume: ${SECOND_COMPANY.name}`);
    console.log(`   CUI: ${SECOND_COMPANY.cui}`);
    console.log(`   Plan: ${SECOND_COMPANY.plan.toUpperCase()} (${SECOND_COMPANY.planPrice}€)`);
    console.log(`\n🔑 DETALII AUTENTIFICARE:`);
    console.log(`   Username: ${SECOND_ADMIN.username}`);
    console.log(`   Password: ${SECOND_ADMIN.password}`);
    console.log(`\n💡 PENTRU TESTARE:`);
    console.log(`   1. Loghează-te cu admin/admin (prima companie)`);
    console.log(`   2. Loghează-te cu admin2/parola123 (a doua companie)`);
    console.log(`   3. Verifică că fiecare vede DOAR datele propriei companii`);
    console.log(`\n📊 DATE CREATE:`);
    console.log(`   • ${TEST_CLIENTS.length} clienți`);
    console.log(`   • ${TEST_PRODUCTS.length} produse`);
    console.log(`   • ${TEST_STOCK.length} intrări de stoc`);
    console.log(`   • ${soferi.length} șoferi`);
    console.log(`   • ${masini.length} mașini`);
    console.log('\n' + '='.repeat(60));

  } catch (error) {
    console.error('\n❌ Eroare:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

seedSecondCompany();
