require('dotenv').config();
const db = require('./db');

setTimeout(async () => {
  try {
    const result = await db.masterQuery(
      'SELECT id, name, subdomain, status, plan, subscription_status FROM companies WHERE subdomain = $1', 
      ['fastmedical']
    );
    console.log('Company:', result.rows[0]);
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}, 1000);
