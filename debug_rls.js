const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function debug() {
  const client = await pool.connect();
  
  // Setăm variabila
  await client.query("SET app.current_company_id = 'demo-company-001'");
  await client.query("SET app.is_superadmin = 'false'");
  
  // Verificăm ce returnează expresia
  const res = await client.query("SELECT current_setting('app.current_company_id', true) as val");
  console.log('Variabila setată:', res.rows[0].val);
  
  // Verificăm politica - important să vedem ce returnează expresia booleană
  const res2 = await client.query(`
    SELECT 
      company_id,
      current_setting('app.current_company_id', true) as ctx,
      company_id = current_setting('app.current_company_id', true) as matches
    FROM users 
    WHERE id = 21
  `);
  console.log('Matches pentru user 21:', res2.rows[0]);
  
  // Verificăm cu is_superadmin
  const res3 = await client.query("SELECT current_setting('app.is_superadmin', true) = 'true' as is_admin");
  console.log('Is superadmin:', res3.rows[0].is_admin);
  
  // Testăm direct politica RLS
  console.log('\n--- Test query cu RLS ---');
  const res4 = await client.query('SELECT id, email, company_id FROM users');
  console.log('Rezultate:', res4.rows.length);
  res4.rows.forEach(u => console.log(`  ${u.id}: ${u.email} (company: ${u.company_id})`));
  
  client.release();
  pool.end();
}

debug();
