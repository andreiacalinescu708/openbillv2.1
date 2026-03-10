require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('🔧 Migrare company_settings...\n');
    
    // Verificăm ce coloane există
    const columnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'company_settings'
    `);
    
    const existingColumns = columnsRes.rows.map(r => r.column_name);
    console.log('Coloane existente:', existingColumns);
    
    // Adăugăm coloanele lipsă
    const columnsToAdd = [
      { name: 'smartbill_token', type: 'TEXT' },
      { name: 'county', type: 'TEXT' },
      { name: 'phone', type: 'TEXT' },
      { name: 'email', type: 'TEXT' },
      { name: 'bank_name', type: 'TEXT' },
      { name: 'bank_iban', type: 'TEXT' },
      { name: 'registration_number', type: 'TEXT' },
      { name: 'vat_number', type: 'TEXT' }
    ];
    
    for (const col of columnsToAdd) {
      if (!existingColumns.includes(col.name)) {
        await pool.query(`ALTER TABLE company_settings ADD COLUMN ${col.name} ${col.type}`);
        console.log(`✅ Adăugat coloana: ${col.name}`);
      } else {
        console.log(`⏩ Coloana ${col.name} există deja`);
      }
    }
    
    // Verificăm dacă există date pentru compania lui alex1
    const userRes = await pool.query(`SELECT company_id FROM users WHERE username = 'alex1'`);
    if (userRes.rows.length > 0) {
      const companyId = userRes.rows[0].company_id;
      
      const settingsRes = await pool.query(
        'SELECT * FROM company_settings WHERE company_id = $1', 
        [companyId]
      );
      
      if (settingsRes.rows.length === 0) {
        console.log('\n⚠️ Nu există setări pentru compania lui alex1');
        console.log('📝 Creăm setări default...');
        
        await pool.query(`
          INSERT INTO company_settings 
            (company_id, name, cui, smartbill_token, smartbill_series, country)
          VALUES ($1, 'Fast Medical Distribution', 'RO47095864', 
                  'cristiana_paun@yahoo.com:002|797b74e49656fba88457a0eb0854941e', 'FMD', 'Romania')
        `, [companyId]);
        
        console.log('✅ Setări create cu SmartBill token!');
      } else {
        console.log('\n✅ Setări existente pentru compania lui alex1');
        console.log('Date:', JSON.stringify(settingsRes.rows[0], null, 2));
      }
    }
    
    console.log('\n🎉 Migrare completă!');
    
  } catch (error) {
    console.error('❌ Eroare migrare:', error.message);
  } finally {
    await pool.end();
  }
}

migrate();
