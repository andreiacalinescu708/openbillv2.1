const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function forceRLS() {
  const client = await pool.connect();
  
  try {
    console.log('=== FORȚARE RLS PENTRU PROPRIETAR ===\n');
    
    const tables = [
      'users', 'clients', 'products', 'stock', 'orders', 
      'vehicles', 'drivers', 'trip_sheets', 'fuel_receipts',
      'stock_transfers', 'audit', 'client_balances',
      'company_categories', 'company_settings', 'companies',
      'invitations', 'password_resets'
    ];
    
    for (const table of tables) {
      try {
        // Forțăm RLS să se aplice și pentru proprietar (bypass disabled)
        await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        console.log(`✅ ${table}: FORCE RLS activat`);
      } catch (e) {
        console.error(`❌ ${table}: ${e.message}`);
      }
    }
    
    console.log('\n=== VERIFICARE ===');
    const res = await client.query(`
      SELECT tablename, rowsecurity, forcerowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    
    res.rows.forEach(row => {
      const force = row.forcerowsecurity ? '📛 FORCE' : '';
      console.log(`${row.tablename.padEnd(25)} RLS:${row.rowsecurity} ${force}`);
    });
    
  } catch (e) {
    console.error('Eroare:', e);
  } finally {
    client.release();
    pool.end();
  }
}

forceRLS();
