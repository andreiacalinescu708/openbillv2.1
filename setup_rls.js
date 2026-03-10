const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function setupRLS() {
  const client = await pool.connect();
  
  try {
    console.log('=== CONFIGURARE ROW LEVEL SECURITY ===\n');
    
    // 1. Creăm un rol pentru aplicatie
    try {
      await client.query(`CREATE ROLE app_user NOLOGIN`);
      console.log('✅ Rol app_user creat');
    } catch (e) {
      console.log('ℹ️ Rolul app_user există deja');
    }
    
    // 2. Tabelele pentru care activăm RLS (filtrare după company_id)
    const tablesWithCompanyId = [
      'users',
      'clients',
      'products',
      'stock',
      'orders',
      'vehicles',
      'drivers',
      'trip_sheets',
      'fuel_receipts',
      'stock_transfers',
      'audit',
      'client_balances',
      'company_categories',
      'company_settings'
    ];
    
    for (const table of tablesWithCompanyId) {
      try {
        // Activăm RLS pe tabelă
        await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        console.log(`🔒 RLS activat pentru ${table}`);
        
        // Ștergem politicile existente pentru a evita conflicte
        await client.query(`
          DROP POLICY IF EXISTS ${table}_company_isolation ON ${table};
          DROP POLICY IF EXISTS ${table}_select_policy ON ${table};
          DROP POLICY IF EXISTS ${table}_insert_policy ON ${table};
          DROP POLICY IF EXISTS ${table}_update_policy ON ${table};
          DROP POLICY IF EXISTS ${table}_delete_policy ON ${table};
        `);
        
        // Creăm politica de izolare pe company_id
        await client.query(`
          CREATE POLICY ${table}_company_isolation ON ${table}
          USING (company_id = current_setting('app.current_company_id', true)::text OR 
                 current_setting('app.is_superadmin', true)::text = 'true')
          WITH CHECK (company_id = current_setting('app.current_company_id', true)::text OR 
                      current_setting('app.is_superadmin', true)::text = 'true')
        `);
        console.log(`   ✅ Politică creată pentru ${table}`);
        
      } catch (e) {
        console.error(`   ❌ Eroare pentru ${table}:`, e.message);
      }
    }
    
    // 3. Politici speciale pentru tabele cu logică diferită
    
    // Companies - utilizatorii pot vedea doar compania lor, superadmin vede toate
    try {
      await client.query(`ALTER TABLE companies ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS companies_isolation ON companies`);
      await client.query(`
        CREATE POLICY companies_isolation ON companies
        USING (id = current_setting('app.current_company_id', true)::text OR 
               current_setting('app.is_superadmin', true)::text = 'true')
        WITH CHECK (current_setting('app.is_superadmin', true)::text = 'true')
      `);
      console.log('🔒 RLS activat pentru companies (politică specială)');
    } catch (e) {
      console.error('❌ Eroare companies:', e.message);
    }
    
    // Invitations - pot fi văzute doar de adminii companiei
    try {
      await client.query(`ALTER TABLE invitations ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS invitations_isolation ON invitations`);
      await client.query(`
        CREATE POLICY invitations_isolation ON invitations
        USING (company_id = current_setting('app.current_company_id', true)::text OR 
               current_setting('app.is_superadmin', true)::text = 'true')
      `);
      console.log('🔒 RLS activat pentru invitations');
    } catch (e) {
      console.error('❌ Eroare invitations:', e.message);
    }
    
    // Password_resets - doar pentru utilizatorul curent
    try {
      await client.query(`ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS password_resets_isolation ON password_resets`);
      await client.query(`
        CREATE POLICY password_resets_isolation ON password_resets
        USING (user_id = current_setting('app.current_user_id', true)::int OR 
               current_setting('app.is_superadmin', true)::text = 'true')
      `);
      console.log('🔒 RLS activat pentru password_resets');
    } catch (e) {
      console.error('❌ Eroare password_resets:', e.message);
    }
    
    // 4. Oferim permisiuni rolului app_user
    await client.query(`GRANT USAGE ON SCHEMA public TO app_user`);
    
    for (const table of [...tablesWithCompanyId, 'companies', 'invitations', 'password_resets']) {
      try {
        await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO app_user`);
      } catch (e) {
        // ignore
      }
    }
    console.log('\n✅ Permisiuni acordate rolului app_user');
    
    // 5. Verificăm statusul final
    console.log('\n=== VERIFICARE STATUS RLS ===');
    const rlsStatus = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    
    rlsStatus.rows.forEach(row => {
      const status = row.rowsecurity ? '✅ ACTIV' : '❌ INACTIV';
      console.log(`${row.tablename.padEnd(25)} ${status}`);
    });
    
    console.log('\n=== POLITICI CREATE ===');
    const policies = await client.query(`
      SELECT tablename, policyname 
      FROM pg_policies 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    
    if (policies.rows.length === 0) {
      console.log('Nicio politică creată încă.');
    } else {
      policies.rows.forEach(p => {
        console.log(`${p.tablename.padEnd(25)} ${p.policyname}`);
      });
    }
    
    console.log('\n🎉 CONFIGURARE RLS COMPLETĂ!');
    console.log('\nNOTĂ: Pentru a folosi RLS, setează variabilele de sesiune:');
    console.log("  SET app.current_company_id = 'compania-ta-id';");
    console.log("  SET app.current_user_id = '123';");
    console.log("  SET app.is_superadmin = 'false';");
    
  } catch (e) {
    console.error('Eroare generală:', e);
  } finally {
    client.release();
    pool.end();
  }
}

setupRLS();
