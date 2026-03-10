const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const result = await pool.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'drivers'
  `);
  console.log('Coloane drivers:', result.rows.map(r => r.column_name));
  pool.end();
}
check();
