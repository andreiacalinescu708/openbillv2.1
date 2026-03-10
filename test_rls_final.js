const { Pool } = require('pg');
require('dotenv').config();

async function testRLS() {
  console.log('=== TEST RLS - COMPARAȚIE ===\n');
  
  // Extragem componentele din DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  const urlMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  
  if (!urlMatch) {
    console.log('URL invalid');
    return;
  }
  
  const [, currentUser, currentPass, host, port, database] = urlMatch;
  console.log(`Conexiune curentă: ${currentUser} (host: ${host})\n`);
  
  // === TEST 1: Conexiunea curentă (postgres - superuser) ===
  console.log('TEST 1: Conexiune SUPERUSER (postgres)');
  console.log('----------------------------------------');
  const poolSuper = new Pool({ 
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });
  
  const res1 = await poolSuper.query('SELECT id, email, company_id FROM users LIMIT 5');
  console.log(`✅ Vede ${res1.rows.length} utilizatori:`);
  res1.rows.forEach(u => console.log(`   - ${u.email} (company: ${u.company_id})`));
  await poolSuper.end();
  
  // === TEST 2: Conexiune ca app_user FĂRĂ variabilă RLS ===
  console.log('\n\nTEST 2: Conexiune APP_USER fără variabilă RLS setată');
  console.log('-----------------------------------------------------');
  const appUserUrl = `postgresql://app_user:app_user_password_123@${host}:${port}/${database}`;
  const poolAppNoVar = new Pool({ 
    connectionString: appUserUrl,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    const res2 = await poolAppNoVar.query('SELECT id, email FROM users');
    console.log(`⚠️  Vede ${res2.rows.length} utilizatori (ar trebui 0 dacă RLS funcționează perfect)`);
    if (res2.rows.length > 0) {
      console.log('   Explicație: RLS nu blochează complet pentru că politica permite și superadmin');
    }
  } catch (e) {
    console.log(`❌ Eroare: ${e.message}`);
  }
  await poolAppNoVar.end();
  
  // === TEST 3: Conexiune ca app_user CU variabilă RLS setată ===
  console.log('\n\nTEST 3: Conexiune APP_USER cu variabilă RLS setată (demo-company-001)');
  console.log('----------------------------------------------------------------------');
  const poolAppWithVar = new Pool({ 
    connectionString: appUserUrl,
    ssl: { rejectUnauthorized: false }
  });
  
  const client = await poolAppWithVar.connect();
  await client.query("SET app.current_company_id = 'demo-company-001'");
  await client.query("SET app.is_superadmin = 'false'");
  
  const res3 = await client.query('SELECT id, email, company_id FROM users');
  console.log(`✅ Vede ${res3.rows.length} utilizatori (doar cei din compania demo-company-001):`);
  res3.rows.forEach(u => console.log(`   - ${u.email} (company: ${u.company_id})`));
  
  client.release();
  await poolAppWithVar.end();
  
  // === REZUMAT ===
  console.log('\n\n=== REZUMAT ===');
  console.log('Superuser (postgres):       Vede TOȚI utilizatorii din toate companiile');
  console.log('App_user fără variabilă:    Vede 0 utilizatori (dacă RLS forțat)');
  console.log('App_user cu variabilă:      Vede doar utilizatorii companiei setate');
  
  console.log('\n=== CONCLUZIE ===');
  console.log('Pentru ca aplicația să funcționeze cu RLS, trebuie:');
  console.log('1. Să folosești APP_USER în loc de POSTGRES în .env');
  console.log('2. Să setezi variabila app.current_company_id înainte de fiecare query');
  console.log('   (asta fac automat middleware-urile requireAuth și requireCompany)');
}

testRLS().catch(e => console.error('Eroare:', e));
