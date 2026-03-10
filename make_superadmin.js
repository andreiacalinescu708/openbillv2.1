require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function makeSuperAdmin() {
  try {
    const result = await pool.query(`
      UPDATE users 
      SET role = 'superadmin'
      WHERE username = 'alex1'
      RETURNING username, role, company_id
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ Utilizatorul alex1 nu există');
      return;
    }
    
    console.log('✅ alex1 este acum SUPERADMIN');
    console.log('   Username:', result.rows[0].username);
    console.log('   Role:', result.rows[0].role);
    console.log('   Company ID:', result.rows[0].company_id);
    
  } catch (error) {
    console.error('❌ Eroare:', error.message);
  } finally {
    await pool.end();
  }
}

makeSuperAdmin();
