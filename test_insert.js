const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function test() {
  const client = await pool.connect();
  console.log("Conectat");
  
  try {
    await client.query('BEGIN');
    console.log("BEGIN");
    
    const result = await client.query(
      `INSERT INTO users (company_id, username, password_hash, email, first_name, last_name, 
                         role, active, is_approved, email_verified, failed_attempts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin', false, false, false, 0, NOW())
       RETURNING id, email`,
      ['test-company-id', 'testuser123', 'hash123', 'test@example.com', 'Test', 'User']
    );
    console.log("Insert result:", result.rows[0]);
    
    await client.query('COMMIT');
    console.log("COMMIT");
    
    // Verifică dacă există
    const check = await pool.query('SELECT id, email FROM users WHERE email = $1', ['test@example.com']);
    console.log("Verificare:", check.rows);
    
    // Curăță
    await pool.query('DELETE FROM users WHERE email = $1', ['test@example.com']);
    console.log("Curățat");
    
  } catch (e) {
    console.error("Eroare:", e);
    await client.query('ROLLBACK');
  } finally {
    client.release();
    pool.end();
  }
}

test();
