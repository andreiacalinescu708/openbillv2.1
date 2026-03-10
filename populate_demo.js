require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function populate() {
  try {
    const client = await pool.connect();
    
    // Găsește compania DEMO template
    const demoRes = await client.query("SELECT id FROM companies WHERE code = 'DEMO'");
    if (demoRes.rows.length === 0) {
      console.log('Compania DEMO nu există!');
      return;
    }
    
    const demoId = demoRes.rows[0].id;
    console.log('Populez template DEMO:', demoId);
    
    // Adaugă clienți demo
    const demoClients = [
      { name: 'Farmacia MedPlus', cui: 'RO12345678', category: 'Farmacie' },
      { name: 'Farmacia Spring', cui: 'RO87654321', category: 'Farmacie' },
      { name: 'Spitalul Municipal', cui: 'RO11223344', category: 'Spital' },
      { name: 'Farmacia Speranța', cui: 'RO22334455', category: 'Farmacie' },
      { name: 'Clinica MedLife', cui: 'RO33445566', category: 'Clinică' }
    ];
    
    for (const c of demoClients) {
      const exists = await client.query('SELECT id FROM clients WHERE company_id = $1 AND cui = $2', [demoId, c.cui]);
      if (exists.rows.length === 0) {
        await client.query(
          `INSERT INTO clients (id, company_id, name, cui, category, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [crypto.randomUUID(), demoId, c.name, c.cui, c.category]
        );
      }
    }
    console.log('✓ Clienți demo adăugați');
    
    // Adaugă produse demo
    const demoProducts = [
      { name: 'Paracetamol 500mg x 20cp', gtin: '5941234567890', price: 12.50, category: 'Analgezice' },
      { name: 'Ibuprofen 400mg x 10cp', gtin: '5941234567891', price: 15.99, category: 'Antiinflamatoare' },
      { name: 'Amoxicilină 500mg x 16cp', gtin: '5941234567892', price: 24.50, category: 'Antibiotice' },
      { name: 'Omeprazol 20mg x 14cp', gtin: '5941234567893', price: 18.75, category: 'Digestive' },
      { name: 'Vitamină C 1000mg x 30cp', gtin: '5941234567894', price: 22.00, category: 'Vitamine' },
      { name: 'Nurofen Forte 400mg x 10cp', gtin: '5941234567895', price: 19.50, category: 'Antiinflamatoare' },
      { name: 'Strepsils cu miere x 24', gtin: '5941234567896', price: 16.25, category: 'Gât' },
      { name: 'Bandă elastică 5cm', gtin: '5941234567897', price: 8.90, category: 'Medical' }
    ];
    
    for (const p of demoProducts) {
      const exists = await client.query('SELECT id FROM products WHERE company_id = $1 AND gtin = $2', [demoId, p.gtin]);
      if (exists.rows.length === 0) {
        await client.query(
          `INSERT INTO products (id, company_id, name, gtin, price, category, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [crypto.randomUUID(), demoId, p.name, p.gtin, p.price, p.category]
        );
      }
    }
    console.log('✓ Produse demo adăugate');
    
    // Verificare finală
    const prodCount = await client.query('SELECT COUNT(*) as count FROM products WHERE company_id = $1', [demoId]);
    const clientCount = await client.query('SELECT COUNT(*) as count FROM clients WHERE company_id = $1', [demoId]);
    
    console.log('\nTemplate DEMO acum are:');
    console.log('  -', prodCount.rows[0].count, 'produse');
    console.log('  -', clientCount.rows[0].count, 'clienți');
    
    client.release();
  } catch (e) {
    console.error('Eroare:', e.message);
  }
  setTimeout(() => process.exit(), 1000);
}

populate();
