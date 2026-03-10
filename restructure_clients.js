require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function restructure() {
  try {
    console.log('🔧 Restructurare clienți Al Shefa și Trei F...\n');
    
    // Găsim compania lui alex1
    const userRes = await pool.query('SELECT company_id FROM users WHERE username = $1', ['alex1']);
    if (userRes.rows.length === 0) {
      console.log('❌ alex1 nu există');
      return;
    }
    const companyId = userRes.rows[0].company_id;
    console.log('🏢 Company ID:', companyId);
    
    // ========== AL SHEFA ==========
    console.log('\n📁 Procesare Al Shefa...');
    
    // Găsim toți clienții Al Shefa
    const alShefaRes = await pool.query(
      `SELECT id, name, cui, prices, payment_terms 
       FROM clients 
       WHERE company_id = $1 AND name ILIKE '%Al Shefa%'`,
      [companyId]
    );
    
    console.log(`  Găsiți ${alShefaRes.rows.length} clienți Al Shefa`);
    
    if (alShefaRes.rows.length > 0) {
      // Găsim sau creăm părintele (1 Mai)
      let parent1Mai = alShefaRes.rows.find(c => c.name.includes('1 MAI') || c.name.includes('1 Mai'));
      
      if (!parent1Mai) {
        // Creăm părintele cu datele primului client
        const first = alShefaRes.rows[0];
        const parentId = require('crypto').randomUUID();
        await pool.query(
          `INSERT INTO clients (id, company_id, name, cui, group_name, is_parent, prices, payment_terms, created_at)
           VALUES ($1, $2, $3, $4, $5, true, $6, $7, NOW())`,
          [parentId, companyId, 'Al Shefa 1 MAI', first.cui, 'Al Shefa', first.prices, 60]
        );
        parent1Mai = { id: parentId, cui: first.cui, prices: first.prices };
        console.log('  ✅ Creat părinte Al Shefa 1 MAI');
      } else {
        // Actualizăm ca părinte
        await pool.query(
          `UPDATE clients SET is_parent = true, group_name = 'Al Shefa', payment_terms = 60 WHERE id = $1`,
          [parent1Mai.id]
        );
        console.log('  ✅ Actualizat Al Shefa 1 MAI ca părinte');
      }
      
      // Actualizăm restul ca puncte de lucru
      for (const client of alShefaRes.rows) {
        if (client.id !== parent1Mai.id) {
          // Extragem numele locației din nume
          let locationName = client.name.replace('Al Shefa', '').replace('Al shefa', '').trim();
          if (locationName.startsWith('-')) locationName = locationName.substring(1).trim();
          
          await pool.query(
            `UPDATE clients 
             SET parent_id = $1, 
                 group_name = 'Al Shefa',
                 location_name = $2,
                 is_parent = false,
                 cui = $3,
                 prices = $4,
                 payment_terms = 60
             WHERE id = $5`,
            [parent1Mai.id, locationName || 'Punct de lucru', parent1Mai.cui, parent1Mai.prices, client.id]
          );
          console.log(`  ✅ ${client.name} → punct de lucru (${locationName})`);
        }
      }
    }
    
    // ========== TREI F (3F) ==========
    console.log('\n📁 Procesare Trei F...');
    
    // Găsim toți clienții Trei F / 3F
    const treiFRes = await pool.query(
      `SELECT id, name, cui, prices, payment_terms 
       FROM clients 
       WHERE company_id = $1 AND (name ILIKE '%Trei F%' OR name ILIKE '%3F%')`,
      [companyId]
    );
    
    console.log(`  Găsiți ${treiFRes.rows.length} clienți Trei F/3F`);
    
    if (treiFRes.rows.length > 0) {
      // Găsim sau creăm părintele (Centru)
      let parentCentru = treiFRes.rows.find(c => 
        c.name.toLowerCase().includes('centru') || 
        c.name.toLowerCase().includes('central')
      );
      
      if (!parentCentru) {
        // Creăm părintele cu datele primului client
        const first = treiFRes.rows[0];
        const parentId = require('crypto').randomUUID();
        await pool.query(
          `INSERT INTO clients (id, company_id, name, cui, group_name, is_parent, prices, payment_terms, created_at)
           VALUES ($1, $2, $3, $4, $5, true, $6, $7, NOW())`,
          [parentId, companyId, 'Trei F Centru', first.cui, 'Trei F', first.prices, 60]
        );
        parentCentru = { id: parentId, cui: first.cui, prices: first.prices };
        console.log('  ✅ Creat părinte Trei F Centru');
      } else {
        // Actualizăm ca părinte
        await pool.query(
          `UPDATE clients SET is_parent = true, group_name = 'Trei F', payment_terms = 60 WHERE id = $1`,
          [parentCentru.id]
        );
        console.log('  ✅ Actualizat Trei F Centru ca părinte');
      }
      
      // Actualizăm restul ca puncte de lucru
      for (const client of treiFRes.rows) {
        if (client.id !== parentCentru.id) {
          // Extragem numele locației
          let locationName = client.name
            .replace(/Trei F/i, '')
            .replace(/3F/i, '')
            .replace(/THREE F/i, '')
            .trim();
          if (locationName.startsWith('-')) locationName = locationName.substring(1).trim();
          
          await pool.query(
            `UPDATE clients 
             SET parent_id = $1, 
                 group_name = 'Trei F',
                 location_name = $2,
                 is_parent = false,
                 cui = $3,
                 prices = $4,
                 payment_terms = 60
             WHERE id = $5`,
            [parentCentru.id, locationName || 'Punct de lucru', parentCentru.cui, parentCentru.prices, client.id]
          );
          console.log(`  ✅ ${client.name} → punct de lucru (${locationName})`);
        }
      }
    }
    
    // ========== VERIFICARE ==========
    console.log('\n📊 Verificare finală:');
    
    const finalRes = await pool.query(
      `SELECT group_name, 
              COUNT(*) as total,
              SUM(CASE WHEN is_parent THEN 1 ELSE 0 END) as parinti,
              SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END) as filiale
       FROM clients 
       WHERE company_id = $1 AND (group_name = 'Al Shefa' OR group_name = 'Trei F')
       GROUP BY group_name`,
      [companyId]
    );
    
    for (const row of finalRes.rows) {
      console.log(`  ${row.group_name}: ${row.total} clienți (${row.parinti} părinți, ${row.filiale} filiale)`);
    }
    
    console.log('\n✅ Restructurare completă!');
    
  } catch (error) {
    console.error('❌ Eroare:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

restructure();
