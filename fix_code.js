const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fix() {
  const email = 'andrei.alexandru.calinescu@gmail.com';
  // Setează expirare la 24 de ore de acum
  const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  
  const result = await pool.query(
    'UPDATE users SET email_verification_expires_at = $1 WHERE email ILIKE $2 RETURNING email, email_verification_code, email_verification_expires_at',
    [newExpiry, email]
  );
  
  if (result.rows.length > 0) {
    console.log('✅ Codul a fost prelungit!');
    console.log('═══════════════════════════════════════════════════');
    console.log('🔑 CODUL TĂU DE VERIFICARE:');
    console.log('═══════════════════════════════════════════════════');
    console.log('Email:', result.rows[0].email);
    console.log('Cod:', result.rows[0].email_verification_code);
    console.log('Expiră la:', result.rows[0].email_verification_expires_at);
    console.log('═══════════════════════════════════════════════════');
    console.log('Folosește acest cod în pagina de verificare!');
  } else {
    console.log('Nu s-a găsit utilizator');
  }
  pool.end();
}
fix();
