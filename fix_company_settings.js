require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  try {
    // Adăugăm coloana company_id
    await pool.query(`
      ALTER TABLE company_settings 
      ADD COLUMN IF NOT EXISTS company_id TEXT 
      REFERENCES companies(id) ON DELETE CASCADE
    `);
    console.log('✅ Coloană company_id adăugată în company_settings');

    // Actualizăm rândurile existente să aibă company_id
    await pool.query(`
      UPDATE company_settings 
      SET company_id = (SELECT id FROM companies LIMIT 1) 
      WHERE company_id IS NULL
    `);
    console.log('✅ Date actualizate în company_settings');

    // Adăugăm constrângerea PRIMARY KEY dacă nu există
    try {
      await pool.query(`
        ALTER TABLE company_settings 
        DROP CONSTRAINT IF EXISTS company_settings_pkey
      `);
      await pool.query(`
        ALTER TABLE company_settings 
        ADD PRIMARY KEY (company_id)
      `);
      console.log('✅ Primary key setat pe company_id');
    } catch (e) {
      console.log('ℹ️ Primary key există deja sau nu poate fi modificat');
    }

    console.log('\n✅ REPARAT! Poți testa din nou signup-ul.');
  } catch (error) {
    console.error('❌ Eroare:', error.message);
  } finally {
    await pool.end();
  }
}

fix();
