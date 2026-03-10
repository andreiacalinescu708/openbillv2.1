const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  // Găsește ultima companie
  const companyRes = await pool.query("SELECT id, code FROM companies WHERE code LIKE 'DEMO-%' ORDER BY created_at DESC LIMIT 1");
  const company = companyRes.rows[0];
  console.log('Compania:', company);
  
  // Vehicule
  const vehiclesRes = await pool.query('SELECT plate_number FROM vehicles WHERE company_id = $1', [company.id]);
  console.log('Vehicule:', vehiclesRes.rows.map(r => r.plate_number));
  
  // Șoferi
  const driversRes = await pool.query('SELECT name FROM drivers WHERE company_id = $1', [company.id]);
  console.log('Șoferi:', driversRes.rows.map(r => r.name));
  
  // Categorii
  const catRes = await pool.query('SELECT name FROM company_categories WHERE company_id = $1', [company.id]);
  console.log('Categorii:', catRes.rows.map(r => r.name));
  
  pool.end();
}
check();
