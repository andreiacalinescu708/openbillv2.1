require('dotenv').config();
const db = require('./db');

async function test() {
  const company = await db.getCompanyBySubdomain('fmd');
  if (company) {
    db.setCompanyContext(company);
    try {
      console.log('Test produse...');
      const r = await db.q('SELECT COUNT(*) as n FROM products');
      console.log('✅ Produse:', r.rows[0].n);
      
      console.log('Test comenzi...');
      const o = await db.q('SELECT COUNT(*) as n FROM orders');
      console.log('✅ Comenzi:', o.rows[0].n);
      
      console.log('Test stoc...');
      const s = await db.q('SELECT COUNT(*) as n FROM stock');
      console.log('✅ Stoc:', s.rows[0].n);
      
      console.log('Test soferi...');
      const d = await db.q('SELECT COUNT(*) as n FROM drivers');
      console.log('✅ Soferi:', d.rows[0].n);
      
      console.log('Test vehicule...');
      const v = await db.q('SELECT COUNT(*) as n FROM vehicles');
      console.log('✅ Vehicule:', v.rows[0].n);
      
    } catch(e) {
      console.error('❌ Eroare:', e.message);
    }
  }
  process.exit(0);
}

test();
