const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  // Găsește ultima companie DEMO creată
  const companyRes = await pool.query("SELECT id, code, name FROM companies WHERE code LIKE 'DEMO-%' ORDER BY created_at DESC LIMIT 1");
  if (companyRes.rows.length === 0) {
    console.log('Nu s-a gasit nicio companie DEMO');
    pool.end();
    return;
  }
  
  const company = companyRes.rows[0];
  console.log('Compania:', company);
  
  // Verifică clienții
  const clientsRes = await pool.query('SELECT name, group_name, category FROM clients WHERE company_id = $1', [company.id]);
  console.log('Clienti:', clientsRes.rows);
  
  pool.end();
}
check();
