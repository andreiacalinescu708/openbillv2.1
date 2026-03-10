require('dotenv').config();
const db = require('./db');
const bcrypt = require('bcrypt');

async function reset() {
  const company = await db.getCompanyBySubdomain('fmd');
  db.setCompanyContext(company);
  
  // Check table structure
  const r = await db.q("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
  console.log('Coloane users:', r.rows.map(r => r.column_name).join(', '));
  
  // Reset password
  const newHash = await bcrypt.hash('test123', 10);
  await db.q('UPDATE users SET password_hash = $1 WHERE username = $2', [newHash, 'alex1']);
  console.log('Parola resetată la: test123');
  
  process.exit(0);
}

reset().catch(e => {
  console.error('Eroare:', e.message);
  process.exit(1);
});
