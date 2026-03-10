const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function deleteUser() {
  const result = await pool.query(
    'DELETE FROM users WHERE email ILIKE $1 RETURNING email', 
    ['andrei.alexandru.calinescu@gmail.com']
  );
  if (result.rows.length > 0) {
    console.log('✅ Utilizator sters:', result.rows[0].email);
  } else {
    console.log('Nu exista utilizator cu acest email');
  }
  pool.end();
}
deleteUser();
