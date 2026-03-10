require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('🔧 Migrare structură clienți grupați...\n');
    
    // Adăugăm coloane pentru grupare clienți
    const columnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'clients'
    `);
    
    const existingColumns = columnsRes.rows.map(r => r.column_name);
    
    // parent_id - pentru relația părinte-copil
    if (!existingColumns.includes('parent_id')) {
      await pool.query(`ALTER TABLE clients ADD COLUMN parent_id TEXT REFERENCES clients(id) ON DELETE SET NULL`);
      console.log('✅ Adăugat parent_id în clients');
    }
    
    // is_parent - flag pentru clienții părinți
    if (!existingColumns.includes('is_parent')) {
      await pool.query(`ALTER TABLE clients ADD COLUMN is_parent BOOLEAN DEFAULT false`);
      console.log('✅ Adăugat is_parent în clients');
    }
    
    // group_name - pentru grupare vizuală
    if (!existingColumns.includes('group_name')) {
      await pool.query(`ALTER TABLE clients ADD COLUMN group_name TEXT`);
      console.log('✅ Adăugat group_name în clients');
    }
    
    // location_name - denumirea punctului de lucru
    if (!existingColumns.includes('location_name')) {
      await pool.query(`ALTER TABLE clients ADD COLUMN location_name TEXT`);
      console.log('✅ Adăugat location_name în clients');
    }
    
    // delivery_address - adresă specifică de livrare
    if (!existingColumns.includes('delivery_address')) {
      await pool.query(`ALTER TABLE clients ADD COLUMN delivery_address TEXT`);
      console.log('✅ Adăugat delivery_address în clients');
    }
    
    // Indecși pentru performanță
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_clients_parent ON clients (parent_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_clients_group ON clients (group_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_clients_is_parent ON clients (is_parent)`);
    
    console.log('\n🎉 Migrare completă!');
    
  } catch (error) {
    console.error('❌ Eroare migrare:', error.message);
  } finally {
    await pool.end();
  }
}

migrate();
