const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function clean() {
  await pool.query('DELETE FROM users WHERE email ILIKE $1', ['skymariia3@gmail.com']);
  await pool.query('DELETE FROM companies WHERE email ILIKE $1', ['skymariia3@gmail.com']);
  console.log('Utilizator si companie sterse');
  pool.end();
}
clean();
