const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function clean() {
  const email = 'skymariia3@gmail.com';
  
  // Găsește compania
  const companyRes = await pool.query('SELECT id FROM companies WHERE email ILIKE $1', [email]);
  if (companyRes.rows.length > 0) {
    const companyId = companyRes.rows[0].id;
    console.log('Sterg datele pentru compania:', companyId);
    
    // Doar utilizatorul
    await pool.query('DELETE FROM users WHERE company_id = $1', [companyId]);
    console.log('Utilizator sters');
  }
  
  // Șterge și utilizatorul după email (dacă există)
  await pool.query('DELETE FROM users WHERE email ILIKE $1', [email]);
  console.log('Curatare completa');
  
  pool.end();
}
clean();
