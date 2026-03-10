const { Pool } = require('pg');
require('dotenv').config();

// URL pentru DB-ul companiei fmd
const FMD_DB_URL = process.env.DATABASE_URL.replace(/\/[^\/]+$/, '/railway_fmd');

const pool = new Pool({
  connectionString: FMD_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function addColumn() {
  try {
    await pool.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS payment_terms INTEGER DEFAULT 0
    `);
    console.log('✅ Coloana payment_terms adăugată în DB fmd');
  } catch (e) {
    console.error('❌ Eroare:', e.message);
  } finally {
    pool.end();
  }
}

addColumn();
