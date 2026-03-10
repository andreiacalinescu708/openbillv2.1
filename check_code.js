const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const email = 'andrei.alexandru.calinescu@gmail.com';
  const result = await pool.query(
    'SELECT email, email_verification_code, email_verification_expires_at FROM users WHERE email ILIKE $1',
    [email]
  );
  if (result.rows.length > 0) {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔑 CODUL TĂU DE VERIFICARE:');
    console.log('═══════════════════════════════════════════════════');
    console.log('Email:', result.rows[0].email);
    console.log('Cod:', result.rows[0].email_verification_code);
    console.log('Expiră:', result.rows[0].email_verification_expires_at);
    console.log('═══════════════════════════════════════════════════');
  } else {
    console.log('Nu s-a găsit utilizator cu acest email');
  }
  pool.end();
}
check();
