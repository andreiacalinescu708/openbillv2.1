require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('🔧 Migrare tabele invitations și password_resets...\n');
    
    // Tabel invitations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invitations (
        id SERIAL PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        invite_token TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'user',
        invited_by INTEGER REFERENCES users(id),
        used BOOLEAN NOT NULL DEFAULT false,
        used_by INTEGER REFERENCES users(id),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    console.log('✅ Tabel invitations creat');
    
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations (invite_token)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invitations_company ON invitations (company_id)`);
    
    // Tabel password_resets
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reset_token TEXT NOT NULL UNIQUE,
        used BOOLEAN NOT NULL DEFAULT false,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    console.log('✅ Tabel password_resets creat');
    
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (reset_token)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id)`);
    
    // Coloane noi în users
    const columnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    
    const existingColumns = columnsRes.rows.map(r => r.column_name);
    
    const columnsToAdd = [
      { name: 'first_name', type: 'TEXT' },
      { name: 'last_name', type: 'TEXT' },
      { name: 'position', type: 'TEXT' },
      { name: 'phone', type: 'TEXT' },
      { name: 'email', type: 'TEXT' }
    ];
    
    for (const col of columnsToAdd) {
      if (!existingColumns.includes(col.name)) {
        await pool.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
        console.log(`✅ Adăugat coloana ${col.name} în users`);
      } else {
        console.log(`⏩ Coloana ${col.name} există deja`);
      }
    }
    
    console.log('\n🎉 Migrare completă!');
    
  } catch (error) {
    console.error('❌ Eroare migrare:', error.message);
  } finally {
    await pool.end();
  }
}

migrate();
