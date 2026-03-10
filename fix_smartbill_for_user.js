require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  try {
    console.log('🔍 Verificare SmartBill pentru utilizatorul alex1\n');
    
    // Găsim utilizatorul alex1 și compania lui
    const userRes = await pool.query(`
      SELECT u.username, u.company_id, c.name as company_name, c.code
      FROM users u
      JOIN companies c ON u.company_id = c.id
      WHERE u.username = 'alex1'
    `);
    
    if (userRes.rows.length === 0) {
      console.log('❌ Utilizatorul alex1 nu există');
      return;
    }
    
    const user = userRes.rows[0];
    console.log('👤 Utilizator:', user.username);
    console.log('🏢 Companie:', user.company_name, '(', user.code, ')');
    console.log('🆔 Company ID:', user.company_id);
    
    // Verificăm settings
    const settingsRes = await pool.query(`
      SELECT smartbill_token, smartbill_series, name
      FROM company_settings
      WHERE company_id = $1
    `, [user.company_id]);
    
    if (settingsRes.rows.length === 0 || !settingsRes.rows[0].smartbill_token) {
      console.log('❌ SmartBill NECONFIGURAT pentru această companie!');
      console.log('');
      console.log('📝 Se configurează automat...');
      
      // Setăm tokenul
      await pool.query(`
        INSERT INTO company_settings (company_id, name, smartbill_token, smartbill_series)
        VALUES ($1, $2, $3, 'OB')
        ON CONFLICT (company_id) 
        DO UPDATE SET smartbill_token = EXCLUDED.smartbill_token
      `, [
        user.company_id,
        user.company_name,
        process.env.SMARTBILL_TOKEN || 'cristiana_paun@yahoo.com:002|797b74e49656fba88457a0eb0854941e'
      ]);
      
      console.log('✅ SmartBill configurat cu succes!');
      console.log('🔄 Reîncarcă pagina și încearcă din nou.');
    } else {
      console.log('✅ SmartBill deja configurat');
      console.log('   Token:', settingsRes.rows[0].smartbill_token ? 'EXISTS' : 'LIPSĂ');
    }
  } catch (error) {
    console.error('❌ Eroare:', error.message);
  } finally {
    await pool.end();
  }
}

fix();
