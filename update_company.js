require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function update() {
  try {
    // Get company_id for alex1
    const userRes = await pool.query(`
      SELECT company_id FROM users WHERE username = 'alex1' LIMIT 1
    `);
    
    if (userRes.rows.length === 0) {
      console.log('❌ Utilizatorul alex1 nu există');
      return;
    }
    
    const companyId = userRes.rows[0].company_id;
    
    // Update company_settings
    await pool.query(`
      UPDATE company_settings 
      SET name = 'Fast Medical Distribution',
          cui = '45073726',
          smartbill_series = 'FMD'
      WHERE company_id = $1
    `, [companyId]);
    
    // Update companies
    await pool.query(`
      UPDATE companies 
      SET name = 'Fast Medical Distribution'
      WHERE id = $1
    `, [companyId]);
    
    console.log('✅ Compania actualizată: Fast Medical Distribution');
    console.log('📋 CUI: 45073726 (fără RO)');
    console.log('📋 Serie SmartBill: FMD');
    console.log('🆔 Company ID:', companyId);
    console.log('');
    console.log('⚠️ IMPORTANT: Asigură-te că în contul SmartBill ai:');
    console.log('   - Compania cu CUI 45073726');
    console.log('   - Seria FMD configurată pentru facturi');
    
  } catch (error) {
    console.error('❌ Eroare:', error.message);
  } finally {
    await pool.end();
  }
}

update();
