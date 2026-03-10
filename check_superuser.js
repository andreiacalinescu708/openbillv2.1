const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const res = await pool.query("SELECT rolname, rolsuper FROM pg_roles WHERE rolname = 'postgres'");
  console.log('Rol postgres:', res.rows[0]);
  
  // Verificăm dacă există vreun utilizator non-superuser
  const res2 = await pool.query("SELECT rolname, rolsuper FROM pg_roles WHERE rolsuper = false LIMIT 5");
  console.log('\nUtilizatori non-superuser:');
  console.table(res2.rows);
  
  pool.end();
}

check();
