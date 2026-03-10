require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const client = await pool.connect();
    
    // Găsește compania DEMO template
    const demoRes = await client.query("SELECT id, name FROM companies WHERE code = 'DEMO'");
    if (demoRes.rows.length === 0) {
      console.log('Compania DEMO nu există!');
      return;
    }
    
    const demoId = demoRes.rows[0].id;
    console.log('Companie DEMO template:', demoId);
    
    // Verifică produsele
    const productsRes = await client.query('SELECT COUNT(*) as count FROM products WHERE company_id = $1', [demoId]);
    console.log('Produse în template:', productsRes.rows[0].count);
    
    const products = await client.query('SELECT name, gtin FROM products WHERE company_id = $1 LIMIT 5', [demoId]);
    console.log('Primele 5 produse:', products.rows);
    
    // Verifică clienții
    const clientsRes = await client.query('SELECT COUNT(*) as count FROM clients WHERE company_id = $1', [demoId]);
    console.log('Clienți în template:', clientsRes.rows[0].count);
    
    client.release();
  } catch (e) {
    console.error('Eroare:', e.message);
  }
  setTimeout(() => process.exit(), 1000);
}

check();
