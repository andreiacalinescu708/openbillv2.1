require('dotenv').config();
const db = require('./db.js');
const crypto = require('crypto');

async function test() {
  console.log("DB hasDb:", db.hasDb());
  
  const companyCode = 'DEMO-' + Date.now().toString(36).toUpperCase();
  const companyId = crypto.randomUUID();
  
  try {
    const result = await db.withTransaction(async (client) => {
      console.log("[TX] Inserare companie:", companyCode);
      await client.query(
        `INSERT INTO companies (id, code, name, plan, plan_price, subscription_status, max_users, settings, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [companyId, companyCode, 'Test Company', 'enterprise', 59.99, 'trial', 10, '{}', 'demo']
      );
      
      console.log("[TX] Inserare utilizator");
      const userResult = await client.query(
        `INSERT INTO users (company_id, username, password_hash, email, role, active, email_verified, failed_attempts, created_at)
         VALUES ($1, $2, $3, $4, 'admin', false, false, 0, NOW())
         RETURNING id`,
        [companyId, 'testuser', 'hash', 'testtx@example.com']
      );
      
      console.log("[TX] User ID:", userResult.rows[0].id);
      return { success: true, userId: userResult.rows[0].id };
    });
    
    console.log("[TX] Rezultat:", result);
    
    // Verifică
    const checkCompany = await db.q('SELECT id, code FROM companies WHERE id = $1', [companyId]);
    console.log("Companie:", checkCompany.rows);
    
    const checkUser = await db.q('SELECT id, email FROM users WHERE email = $1', ['testtx@example.com']);
    console.log("Utilizator:", checkUser.rows);
    
    // Curăță
    await db.q('DELETE FROM users WHERE email = $1', ['testtx@example.com']);
    await db.q('DELETE FROM companies WHERE id = $1', [companyId]);
    console.log("Curățat");
    
  } catch (e) {
    console.error("Eroare:", e);
  }
  
  process.exit(0);
}

test();
