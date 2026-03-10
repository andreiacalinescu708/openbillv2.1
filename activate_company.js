// activate_company.js
// Activează rapid o companie cu abonament plătit
// Exemplu: node activate_company.js FASTMEDICAL fastmedical@email.ro pro 12

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

// CONFIGURARE - modifică aici pentru fiecare client
const CONFIG = {
  // Date firmă
  companyCode: process.argv[2] || 'FASTMEDICAL',    // Cod unic (ex: FASTMEDICAL)
  companyName: 'Fast Medical SRL',                   // Numele firmei
  cui: 'RO12345678',                                 // CUI
  address: 'Str. Exemplu nr. 1, București',
  phone: '0722-123-456',
  email: process.argv[3] || 'contact@fastmedical.ro',
  
  // Abonament
  plan: process.argv[4] || 'pro',                   // starter / pro / enterprise
  months: parseInt(process.argv[5]) || 12,          // perioada în luni
  
  // Utilizatori de creat
  users: [
    { username: 'fastadmin', password: 'Fast2024!', role: 'admin' },
    { username: 'fastuser', password: 'Fast2024!', role: 'user' },
  ]
};

const PLANS = {
  starter: { price: 29.99, maxUsers: 3 },
  pro: { price: 39.99, maxUsers: 10 },
  enterprise: { price: 59.99, maxUsers: 999 }
};

async function activateCompany() {
  console.log('🚀 Activare companie în OpenBill\n');
  console.log('================================\n');

  try {
    // Verificăm dacă codul companiei există deja
    const existingCompany = await q(
      `SELECT id, name FROM companies WHERE code = $1`,
      [CONFIG.companyCode]
    );

    let companyId;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + CONFIG.months);

    if (existingCompany.rows.length > 0) {
      // Actualizăm compania existentă
      companyId = existingCompany.rows[0].id;
      
      await q(
        `UPDATE companies 
         SET name = $1,
             cui = $2,
             address = $3,
             phone = $4,
             email = $5,
             plan = $6,
             plan_price = $7,
             max_users = $8,
             subscription_status = 'active',
             subscription_expires_at = $9,
             updated_at = NOW()
         WHERE id = $10`,
        [
          CONFIG.companyName,
          CONFIG.cui,
          CONFIG.address,
          CONFIG.phone,
          CONFIG.email,
          CONFIG.plan,
          PLANS[CONFIG.plan].price,
          PLANS[CONFIG.plan].maxUsers,
          expiresAt,
          companyId
        ]
      );
      
      console.log(`✅ Companie actualizată: ${CONFIG.companyName}`);
    } else {
      // Creăm companie nouă
      companyId = crypto.randomUUID();
      
      await q(
        `INSERT INTO companies (id, code, name, cui, address, phone, email, plan, plan_price, max_users, subscription_status, subscription_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)`,
        [
          companyId,
          CONFIG.companyCode,
          CONFIG.companyName,
          CONFIG.cui,
          CONFIG.address,
          CONFIG.phone,
          CONFIG.email,
          CONFIG.plan,
          PLANS[CONFIG.plan].price,
          PLANS[CONFIG.plan].maxUsers,
          expiresAt
        ]
      );
      
      console.log(`✅ Companie creată: ${CONFIG.companyName}`);
    }

    // Company settings
    await q(
      `INSERT INTO company_settings (company_id, name, cui, address, smartbill_series)
       VALUES ($1, $2, $3, $4, 'FM')
       ON CONFLICT (company_id) 
       DO UPDATE SET name = EXCLUDED.name, cui = EXCLUDED.cui, address = EXCLUDED.address`,
      [companyId, CONFIG.companyName, CONFIG.cui, CONFIG.address]
    );

    // Creăm utilizatorii
    console.log('\n👤 Creare utilizatori:\n');
    
    for (const user of CONFIG.users) {
      // Verificăm dacă există
      const existingUser = await q(
        `SELECT id FROM users WHERE username = $1`,
        [user.username]
      );

      if (existingUser.rows.length > 0) {
        // Actualizăm company_id și parola
        const passwordHash = await bcrypt.hash(user.password, 10);
        await q(
          `UPDATE users 
           SET company_id = $1, 
               password_hash = $2,
               role = $3,
               active = true,
               is_approved = true
           WHERE username = $4`,
          [companyId, passwordHash, user.role, user.username]
        );
        console.log(`  ✓ ${user.username} (actualizat)`);
      } else {
        // Creăm utilizator nou
        const passwordHash = await bcrypt.hash(user.password, 10);
        await q(
          `INSERT INTO users (company_id, username, password_hash, role, active, is_approved, failed_attempts)
           VALUES ($1, $2, $3, $4, true, true, 0)`,
          [companyId, user.username, passwordHash, user.role]
        );
        console.log(`  ✓ ${user.username} (creat)`);
      }
    }

    // Rezumat
    console.log('\n================================');
    console.log('✅ ACTIVARE COMPLETĂ!');
    console.log('================================\n');
    
    console.log('📋 DATE COMPANIE:');
    console.log(`   Nume: ${CONFIG.companyName}`);
    console.log(`   Cod: ${CONFIG.companyCode}`);
    console.log(`   CUI: ${CONFIG.cui}`);
    console.log(`   Email: ${CONFIG.email}`);
    
    console.log('\n💰 ABONAMENT:');
    console.log(`   Plan: ${CONFIG.plan.toUpperCase()}`);
    console.log(`   Preț: ${PLANS[CONFIG.plan].price}€/lună`);
    console.log(`   Perioada: ${CONFIG.months} luni`);
    console.log(`   Expiră: ${expiresAt.toLocaleDateString('ro-RO')}`);
    console.log(`   Max utilizatori: ${PLANS[CONFIG.plan].maxUsers}`);
    
    console.log('\n🔑 ACCES:');
    CONFIG.users.forEach(u => {
      console.log(`   ${u.role === 'admin' ? '👑 Admin' : '👤 User'}: ${u.username} / ${u.password}`);
    });
    
    console.log('\n📧 TRIMITE CLIENTULUI:');
    console.log('-------------------------------------------');
    console.log(`Bună ziua,`);
    console.log(`\nContul pentru ${CONFIG.companyName} a fost activat.`);
    console.log(`\nLink acces: http://localhost:3000`);
    console.log(`\nDate de autentificare:`);
    console.log(`  Username: ${CONFIG.users[0].username}`);
    console.log(`  Parolă: ${CONFIG.users[0].password}`);
    console.log(`\nAbonament: ${CONFIG.plan.toUpperCase()} - ${CONFIG.months} luni`);
    console.log(`Expiră: ${expiresAt.toLocaleDateString('ro-RO')}`);
    console.log('\n-------------------------------------------');

  } catch (error) {
    console.error('\n❌ Eroare:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

// Dacă rulează direct, execută
if (require.main === module) {
  activateCompany();
}

module.exports = { activateCompany };
