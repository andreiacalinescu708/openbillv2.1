require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function compare() {
  try {
    // Luăm 2 clienți și comparăm prețurile
    const res = await pool.query(`
      SELECT name, prices
      FROM clients 
      WHERE group_name = 'Al Shefa'
      LIMIT 2
    `);
    
    if (res.rows.length >= 2) {
      const client1 = res.rows[0];
      const client2 = res.rows[1];
      
      console.log('Comparare prețuri:');
      console.log(`  ${client1.name}: ${Object.keys(client1.prices).length} produse`);
      console.log(`  ${client2.name}: ${Object.keys(client2.prices).length} produse`);
      
      // Verificăm dacă sunt identice
      const keys1 = Object.keys(client1.prices).sort();
      const keys2 = Object.keys(client2.prices).sort();
      
      if (JSON.stringify(keys1) === JSON.stringify(keys2)) {
        console.log('  ✓ Aceleași produse cu prețuri speciale');
        
        // Verificăm valorile
        let differences = 0;
        for (const key of keys1.slice(0, 5)) {
          if (client1.prices[key] !== client2.prices[key]) {
            differences++;
            console.log(`    Diferență la ${key}: ${client1.prices[key]} vs ${client2.prices[key]}`);
          }
        }
        
        if (differences === 0) {
          console.log('  ⚠️  Prețurile par IDENTICE (posibil copiate de la părinte)');
        } else {
          console.log(`  ✓ Prețuri diferite la ${differences} produse`);
        }
      }
    }
    
    await pool.end();
  } catch (e) {
    console.error('Eroare:', e.message);
    await pool.end();
  }
}

compare();
