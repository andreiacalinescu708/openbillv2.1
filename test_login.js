require('dotenv').config();
const db = require('./db');
const bcrypt = require('bcrypt');

async function check() {
  const company = await db.getCompanyBySubdomain('fmd');
  if (company) {
    db.setCompanyContext(company);
    const users = await db.q('SELECT username, password_hash FROM users');
    console.log('User:', users.rows[0].username);
    
    // Test bcrypt cu parola comuna
    const testPasses = ['123456', 'password', 'admin', 'alex', 'alex1', 'fastmedical'];
    for (const pass of testPasses) {
      const match = await bcrypt.compare(pass, users.rows[0].password_hash);
      if (match) {
        console.log('Parola găsită:', pass);
        break;
      }
    }
  }
  process.exit(0);
}

check();
