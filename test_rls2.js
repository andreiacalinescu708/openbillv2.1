const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function test() {
  console.log('=== TEST RLS DETALIAT ===\n');
  
  // Afișăm toți utilizatorii și company_id
  console.log('Toți utilizatorii din DB:');
  const all = await pool.query('SELECT id, email, company_id FROM users ORDER BY id');
  all.rows.forEach(u => console.log(`  ${u.id}: ${u.email} (company: ${u.company_id})`));
  
  // Test cu RLS pentru compania demo-company-001
  console.log('\n--- Cu RLS pentru demo-company-001 ---');
  const client1 = await pool.connect();
  await client1.query("SET app.current_company_id = 'demo-company-001'");
  await client1.query("SET app.is_superadmin = 'false'");
  const rls1 = await client1.query('SELECT id, email FROM users');
  console.log(`Văzuți ${rls1.rows.length} utilizatori:`);
  rls1.rows.forEach(u => console.log(`  - ${u.email}`));
  client1.release();
  
  // Test cu RLS pentru compania 50e8eeb4...
  console.log('\n--- Cu RLS pentru 50e8eeb4-a17e-49d3-8271-497ec37bf456 ---');
  const client2 = await pool.connect();
  await client2.query("SET app.current_company_id = '50e8eeb4-a17e-49d3-8271-497ec37bf456'");
  await client2.query("SET app.is_superadmin = 'false'");
  const rls2 = await client2.query('SELECT id, email FROM users');
  console.log(`Văzuți ${rls2.rows.length} utilizatori:`);
  rls2.rows.forEach(u => console.log(`  - ${u.email}`));
  client2.release();
  
  // Test ca superadmin
  console.log('\n--- Ca superadmin ---');
  const client3 = await pool.connect();
  await client3.query("SET app.is_superadmin = 'true'");
  const rls3 = await client3.query('SELECT id, email FROM users');
  console.log(`Văzuți ${rls3.rows.length} utilizatori:`);
  rls3.rows.forEach(u => console.log(`  - ${u.email}`));
  client3.release();
  
  pool.end();
}

test().catch(e => console.error(e));
