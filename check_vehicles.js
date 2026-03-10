const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const vehiclesRes = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'vehicles'`);
  console.log('Vehicles columns:', vehiclesRes.rows.map(r => r.column_name));
  
  const driversRes = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'drivers'`);
  console.log('Drivers columns:', driversRes.rows.map(r => r.column_name));
  
  pool.end();
}
check();
