const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createAppRole() {
  const client = await pool.connect();
  
  try {
    console.log('=== CREARE ROL PENTRU APLICAȚIE ===\n');
    
    // Creăm rolul app_user dacă nu există
    try {
      await client.query(`CREATE ROLE app_user WITH LOGIN PASSWORD 'app_user_password_123'`);
      console.log('✅ Rol app_user creat');
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('ℹ️ Rolul app_user există deja');
      } else {
        throw e;
      }
    }
    
    // Oferim permisiuni
    await client.query(`GRANT USAGE ON SCHEMA public TO app_user`);
    
    const tables = [
      'users', 'clients', 'products', 'stock', 'orders', 
      'vehicles', 'drivers', 'trip_sheets', 'fuel_receipts',
      'stock_transfers', 'audit', 'client_balances',
      'company_categories', 'company_settings', 'companies',
      'invitations', 'password_resets', 'subscription_invoices',
      'subscriptions', 'invoices'
    ];
    
    for (const table of tables) {
      try {
        await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO app_user`);
        await client.query(`GRANT USAGE, SELECT ON SEQUENCE ${table}_id_seq TO app_user`);
      } catch (e) {
        // ignore - poate nu există secvența
      }
    }
    console.log('✅ Permisiuni acordate');
    
    // Verificăm că rolul nu este superuser
    const res = await client.query("SELECT rolname, rolsuper FROM pg_roles WHERE rolname = 'app_user'");
    console.log('\nRol app_user:', res.rows[0]);
    
    console.log('\n🎉 Rol creat cu succes!');
    console.log('\nPentru a folosi RLS, modificați DATABASE_URL în .env:');
    console.log(' postgresql://app_user:app_user_password_123@host:port/database');
    
  } catch (e) {
    console.error('Eroare:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

createAppRole();
