const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const result = await pool.query('SELECT id, email, email_verification_code, email_verified FROM users WHERE email_verification_code = $1', ['389176']);
  console.log('User with code 389176:', result.rows[0]);
  
  const all = await pool.query('SELECT id, email, email_verification_code FROM users ORDER BY id DESC LIMIT 5');
  console.log('Last 5 users:', all.rows);
  pool.end();
}
check();
