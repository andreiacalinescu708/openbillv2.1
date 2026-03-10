require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  try {
    console.log('🔧 Corectare prețuri speciale...\n');
    
    const userRes = await pool.query('SELECT company_id FROM users WHERE username = $1', ['alex1']);
    const companyId = userRes.rows[0].company_id;
    
    // Pentru clienții Al Shefa și Trei F, păstrăm doar structura (parent_id, group_name)
    // dar NU atingem coloana prices - fiecare punct de lucru își păstrează prețurile speciale
    
    console.log('📁 Restaurare prețuri individuale pentru punctele de lucru...');
    
    // Găsim toți clienții cu parent_id setat (puncte de lucru)
    const childClients = await pool.query(
      `SELECT id, name, group_name, parent_id 
       FROM clients 
       WHERE company_id = $1 AND parent_id IS NOT NULL`,
      [companyId]
    );
    
    console.log(`  ${childClients.rows.length} puncte de lucru găsite`);
    
    // IMPORTANT: NU modificăm coloana prices
    // Doar ne asigurăm că CUI-ul e la fel ca al părintelui (pentru facturare)
    
    for (const child of childClients.rows) {
      // Luăm CUI-ul părintelui
      const parentRes = await pool.query(
        'SELECT cui FROM clients WHERE id = $1',
        [child.parent_id]
      );
      
      if (parentRes.rows.length > 0) {
        const parentCui = parentRes.rows[0].cui;
        
        // Actualizăm DOAR CUI-ul, NU prices
        await pool.query(
          `UPDATE clients SET cui = $1 WHERE id = $2`,
          [parentCui, child.id]
        );
        
        console.log(`  ✅ ${child.name} - CUI actualizat, prețuri păstrate`);
      }
    }
    
    // Verificare - câți clienți au prețuri speciale (prices != '{}')
    const pricesCheck = await pool.query(
      `SELECT group_name, 
              COUNT(*) as total,
              SUM(CASE WHEN prices != '{}'::jsonb THEN 1 ELSE 0 END) as cu_preturi_speciale
       FROM clients 
       WHERE company_id = $1 AND (group_name = 'Al Shefa' OR group_name = 'Trei F')
       GROUP BY group_name`,
      [companyId]
    );
    
    console.log('\n📊 Verificare prețuri:');
    for (const row of pricesCheck.rows) {
      console.log(`  ${row.group_name}: ${row.total} clienți, ${row.cu_preturi_speciale} cu prețuri speciale`);
    }
    
    console.log('\n✅ Corecție completă!');
    console.log('   Fiecare punct de lucru își păstrează prețurile speciale individuale.');
    
  } catch (error) {
    console.error('❌ Eroare:', error.message);
  } finally {
    await pool.end();
  }
}

fix();
