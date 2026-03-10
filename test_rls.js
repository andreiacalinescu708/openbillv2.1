const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function test() {
  console.log('=== TEST RLS ===\n');
  
  // Test 1: Fără context RLS (ca la startup)
  console.log('Test 1: Query fără context RLS');
  const res1 = await pool.query('SELECT COUNT(*) as count FROM users');
  console.log('  Total users (fără RLS):', res1.rows[0].count);
  
  // Test 2: Cu context RLS setat pentru o companie specifică
  console.log('\nTest 2: Query cu context RLS (compania demo-company-001)');
  const client = await pool.connect();
  await client.query("SET app.current_company_id = 'demo-company-001'");
  await client.query("SET app.is_superadmin = 'false'");
  const res2 = await client.query('SELECT id, email FROM users');
  console.log('  Users văzuți cu RLS:', res2.rows.length);
  res2.rows.forEach(u => console.log(`    - ${u.email}`));
  client.release();
  
  // Test 3: Cu superadmin
  console.log('\nTest 3: Query ca superadmin');
  const client2 = await pool.connect();
  await client2.query("SET app.is_superadmin = 'true'");
  const res3 = await client2.query('SELECT COUNT(*) as count FROM users');
  console.log('  Users văzuți ca superadmin:', res3.rows[0].count);
  client2.release();
  
  pool.end();
}

test().catch(e => console.error(e));
