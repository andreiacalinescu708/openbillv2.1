// setup_existing_company.js
// Configurează o companie existentă (ex: Fast Medical) cu abonament plătit
// Rulează: node setup_existing_company.js

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const readline = require('readline');

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function setupExistingCompany() {
  console.log('🏢 Configurare companie existentă cu abonament\n');
  console.log('==============================================\n');

  try {
    // Afișăm companiile existente
    const companiesRes = await q(`SELECT id, code, name, plan, subscription_status FROM companies ORDER BY created_at`);
    
    console.log('Companii existente în sistem:');
    console.log('------------------------------');
    companiesRes.rows.forEach((c, i) => {
      console.log(`${i + 1}. ${c.name} (Cod: ${c.code})`);
      console.log(`   Plan: ${c.plan} | Status: ${c.subscription_status}`);
      console.log(`   ID: ${c.id}`);
      console.log('');
    });

    const choice = await ask('Selectează numărul companiei de configurat (sau Enter pentru compania DEFAULT): ');
    
    let company;
    if (!choice || choice === '1') {
      company = companiesRes.rows[0];
    } else {
      company = companiesRes.rows[parseInt(choice) - 1];
    }

    if (!company) {
      console.log('❌ Companie invalidă');
      rl.close();
      return;
    }

    console.log(`\n✅ Ai selectat: ${company.name}\n`);

    // Colectăm datele noi
    console.log('Introdu datele companiei (apasă Enter pentru a păstra valorile existente):\n');
    
    const newCode = await ask(`Cod companie [${company.code}]: `);
    const newName = await ask(`Nume firmă [${company.name}]: `);
    const newCui = await ask(`CUI [${company.cui || 'lipsă'}]: `);
    const newAddress = await ask(`Adresă: `);
    const newPhone = await ask(`Telefon: `);
    const newEmail = await ask(`Email: `);

    // Selectare plan
    console.log('\nSelectează planul:');
    console.log('1. Starter - 29.99€ (max 3 utilizatori)');
    console.log('2. Pro - 39.99€ (max 10 utilizatori)');
    console.log('3. Enterprise - 59.99€ (utilizatori nelimitați)');
    const planChoice = await ask(`Plan [1/2/3, curent: ${company.plan}]: `);

    let plan = company.plan;
    let planPrice = company.plan_price;
    let maxUsers = company.max_users;

    if (planChoice === '1') {
      plan = 'starter'; planPrice = 29.99; maxUsers = 3;
    } else if (planChoice === '2') {
      plan = 'pro'; planPrice = 39.99; maxUsers = 10;
    } else if (planChoice === '3') {
      plan = 'enterprise'; planPrice = 59.99; maxUsers = 999;
    }

    // Perioada abonamentului
    console.log('\nPerioada abonamentului:');
    console.log('1. 1 lună');
    console.log('2. 3 luni');
    console.log('3. 6 luni');
    console.log('4. 12 luni');
    const periodChoice = await ask('Alege perioada [1/2/3/4]: ') || '1';

    const months = { '1': 1, '2': 3, '3': 6, '4': 12 }[periodChoice] || 1;
    
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + months);

    // Actualizăm compania
    await q(
      `UPDATE companies 
       SET code = COALESCE(NULLIF($1, ''), code),
           name = COALESCE(NULLIF($2, ''), name),
           cui = COALESCE(NULLIF($3, ''), cui),
           address = COALESCE(NULLIF($4, ''), address),
           phone = COALESCE(NULLIF($5, ''), phone),
           email = COALESCE(NULLIF($6, ''), email),
           plan = $7,
           plan_price = $8,
           max_users = $9,
           subscription_status = 'active',
           subscription_expires_at = $10,
           updated_at = NOW()
       WHERE id = $11`,
      [
        newCode.toUpperCase(),
        newName,
        newCui,
        newAddress,
        newPhone,
        newEmail,
        plan,
        planPrice,
        maxUsers,
        expiresAt,
        company.id
      ]
    );

    // Actualizăm și company_settings
    await q(
      `INSERT INTO company_settings (company_id, name, cui, address, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (company_id) 
       DO UPDATE SET name = EXCLUDED.name, cui = EXCLUDED.cui, address = EXCLUDED.address, updated_at = NOW()`,
      [company.id, newName || company.name, newCui || company.cui, newAddress]
    );

    console.log('\n✅ Companie actualizată cu succes!');
    console.log('====================================');
    console.log(`Nume: ${newName || company.name}`);
    console.log(`Cod: ${newCode.toUpperCase() || company.code}`);
    console.log(`CUI: ${newCui || company.cui || 'N/A'}`);
    console.log(`Plan: ${plan.toUpperCase()} (${planPrice}€)`);
    console.log(`Max utilizatori: ${maxUsers}`);
    console.log(`Abonament activ până la: ${expiresAt.toLocaleDateString('ro-RO')}`);

    // Creare utilizatori
    console.log('\n-----------------------------------');
    console.log('Creare utilizatori pentru companie');
    console.log('-----------------------------------\n');

    while (true) {
      const createUser = await ask('Vrei să creezi un utilizator? (da/nu): ');
      if (createUser.toLowerCase() !== 'da') break;

      const username = await ask('Username: ');
      if (!username) {
        console.log('Username obligatoriu!');
        continue;
      }

      const password = await ask('Parolă (Enter pentru "changeme"): ') || 'changeme';
      const isAdmin = await ask('Este administrator? (da/nu): ');
      const role = isAdmin.toLowerCase() === 'da' ? 'admin' : 'user';

      // Verificăm dacă username există deja
      const existingUser = await q(
        `SELECT id FROM users WHERE username = $1`,
        [username]
      );

      if (existingUser.rows.length > 0) {
        console.log('❌ Username deja existent!');
        continue;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      
      await q(
        `INSERT INTO users (company_id, username, password_hash, role, active, is_approved, failed_attempts)
         VALUES ($1, $2, $3, $4, true, true, 0)`,
        [company.id, username, passwordHash, role]
      );

      console.log(`✅ Utilizator creat: ${username} / ${password}`);
      console.log(`   Rol: ${role === 'admin' ? 'Administrator' : 'Utilizator'}`);
    }

    // Afișăm utilizatorii companiei
    console.log('\n-----------------------------------');
    console.log('Utilizatori activi ai companiei:');
    console.log('-----------------------------------');
    
    const usersRes = await q(
      `SELECT username, role, active, is_approved FROM users WHERE company_id = $1 ORDER BY created_at`,
      [company.id]
    );

    usersRes.rows.forEach(u => {
      console.log(`• ${u.username} (${u.role}) ${u.active ? '✓' : '✗'}`);
    });

    console.log('\n==============================================');
    console.log('✅ Configurare completă!');
    console.log('==============================================');
    console.log(`\nFast Medical poate acum să se logheze în aplicație.`);
    console.log(`URL: http://localhost:3000 (sau domeniul tău)`);
    console.log(`\nIMPORTANT: Salvează aceste informații și trimite-le clientului!`);

  } catch (error) {
    console.error('\n❌ Eroare:', error.message);
    console.error(error.stack);
  } finally {
    rl.close();
    await pool.end();
  }
}

setupExistingCompany();
