const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const result = await pool.query('SELECT name, group_name, category FROM clients WHERE company_id = $1', ['demo-company-001']);
  console.log('Template clients:', result.rows);
  pool.end();
}
check();
