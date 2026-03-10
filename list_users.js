const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function listUsers() {
  const result = await pool.query(
    'SELECT id, email, username, email_verification_code, email_verified, created_at FROM users ORDER BY created_at DESC LIMIT 5'
  );
  console.log('Ultimele 5 înregistrări:');
  console.log(JSON.stringify(result.rows, null, 2));
  pool.end();
}
listUsers();
