require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function test() {
  try {
    // Simulate what API does
    const userRes = await pool.query(`
      SELECT company_id FROM users WHERE username = 'popescu.ion'
    `);
    
    if (userRes.rows.length === 0) {
      console.log('User not found');
      await pool.end();
      return;
    }
    
    const companyId = userRes.rows[0].company_id;
    console.log('Company ID for popescu.ion:', companyId);
    
    // Get clients like API does
    const clientsRes = await pool.query(`
      SELECT id, name, category, group_name 
      FROM clients 
      WHERE company_id = $1
      ORDER BY name
    `, [companyId]);
    
    console.log('\nClients found:', clientsRes.rows.length);
    clientsRes.rows.forEach(c => {
      console.log(` - ${c.name} (${c.category})`);
    });
    
    await pool.end();
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}

test();
