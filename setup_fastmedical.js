require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  try {
    // Afișăm companiile
    const companies = await pool.query('SELECT id, code, name FROM companies ORDER BY name');
    console.log('Companii existente:');
    companies.rows.forEach(c => console.log(` - ${c.code} | ${c.name} | ID: ${c.id}`));
    
    // Găsim Fast Medical sau creăm una de test
    let companyId;
    const fastMedical = companies.rows.find(c => c.name.toLowerCase().includes('fast') || c.code.toLowerCase().includes('fast'));
    
    if (fastMedical) {
      companyId = fastMedical.id;
      console.log(`\n✅ Găsit Fast Medical: ${fastMedical.name} (${fastMedical.code})`);
    } else {
      console.log('\n⚠️ Fast Medical nu există. Folosim prima companie găsită.');
      companyId = companies.rows[0]?.id;
    }
    
    if (!companyId) {
      console.log('❌ Nu există nicio companie!');
      return;
    }
    
    // Cerem tokenul SmartBill
    console.log('\n📝 Setare token SmartBill pentru această companie...');
    
    // Setăm tokenul din .env temporar (sau poți modifica aici cu tokenul real)
    const smartbillToken = process.env.SMARTBILL_TOKEN || 'cristiana_paun@yahoo.com:002|797b74e49656fba88457a0eb0854941e';
    
    await pool.query(
      `INSERT INTO company_settings (company_id, name, smartbill_series, smartbill_token)
       VALUES ($1, $2, 'OB', $3)
       ON CONFLICT (company_id) 
       DO UPDATE SET smartbill_token = EXCLUDED.smartbill_token, smartbill_series = EXCLUDED.smartbill_series`,
      [companyId, 'Fast Medical Distribution', smartbillToken]
    );
    
    console.log('✅ Token SmartBill salvat pentru companie!');
    console.log('\n🧪 Acum poți testa trimiterea unei comenzi la SmartBill.');
    
  } catch (error) {
    console.error('❌ Eroare:', error.message);
  } finally {
    await pool.end();
  }
}

setup();
