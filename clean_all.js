const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function clean() {
  const email = 'skymariia3@gmail.com';
  
  // Găsește compania
  const companyRes = await pool.query('SELECT id FROM companies WHERE email ILIKE $1', [email]);
  if (companyRes.rows.length > 0) {
    const companyId = companyRes.rows[0].id;
    console.log('Sterg compania:', companyId);
    
    // Șterge în ordinea dependențelor
    await pool.query('DELETE FROM stock WHERE company_id = $1', [companyId]);
    await pool.query('DELETE FROM products WHERE company_id = $1', [companyId]);
    await pool.query('DELETE FROM clients WHERE company_id = $1', [companyId]);
    await pool.query('DELETE FROM vehicles WHERE company_id = $1', [companyId]);
    await pool.query('DELETE FROM drivers WHERE company_id = $1', [companyId]);
    await pool.query('DELETE FROM users WHERE company_id = $1', [companyId]);
    await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    console.log('Companie si date asociate sterse');
  } else {
    // Doar utilizatorul
    await pool.query('DELETE FROM users WHERE email ILIKE $1', [email]);
    console.log('Utilizator sters');
  }
  
  pool.end();
}
clean();
