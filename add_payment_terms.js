const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addColumn() {
  try {
    await pool.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS payment_terms INTEGER DEFAULT 0
    `);
    console.log('✅ Coloana payment_terms adăugată cu succes');
  } catch (e) {
    console.error('❌ Eroare:', e.message);
  } finally {
    pool.end();
  }
}

addColumn();
