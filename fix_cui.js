require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  try {
    await pool.query(`
      UPDATE company_settings 
      SET cui = 'RO47095864'
      WHERE company_id = (
        SELECT company_id FROM users WHERE username = 'alex1' LIMIT 1
      )
    `);
    console.log('✅ CUI actualizat: RO47095864');
  } catch (error) {
    console.error('❌ Eroare:', error.message);
  } finally {
    await pool.end();
  }
}

fix();
