// Test rapid pentru subdomeniu
require('dotenv').config();
const db = require('./db');

async function test() {
  console.log('=== TEST SUBDOMENIU ===\n');
  
  // Testăm getCompanyBySubdomain
  console.log('1. Test getCompanyBySubdomain("fmd"):');
  const company = await db.getCompanyBySubdomain('fmd');
  console.log('   Rezultat:', company ? `✅ ${company.name}` : '❌ Negăsit');
  
  if (company) {
    console.log('\n2. Test setCompanyContext:');
    db.setCompanyContext(company);
    console.log('   ✅ Context setat');
    
    console.log('\n3. Test query pe DB companie:');
    try {
      const result = await db.q('SELECT COUNT(*) as count FROM clients');
      console.log(`   ✅ ${result.rows[0].count} clienți găsiți`);
    } catch (e) {
      console.log('   ❌ Eroare:', e.message);
    }
    
    db.resetCompanyContext();
  }
  
  console.log('\n========================');
  process.exit(0);
}

test().catch(e => {
  console.error('Eroare:', e);
  process.exit(1);
});
