const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkRLS() {
  try {
    // Verificăm care tabele au RLS activat
    const rlsTables = await pool.query(`
      SELECT schemaname, tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    
    console.log('=== RLS STATUS PENTRU TABELE ===');
    console.table(rlsTables.rows);
    
    // Verificăm politicile RLS existente
    const policies = await pool.query(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies 
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `);
    
    console.log('\n=== POLITICI RLS EXISTENTE ===');
    if (policies.rows.length === 0) {
      console.log('Nu există politici RLS definite.');
    } else {
      console.table(policies.rows);
    }
    
    // Verificăm proprietarii tabelelor
    const owners = await pool.query(`
      SELECT tablename, tableowner 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    
    console.log('\n=== PROPRIETARI TABELE ===');
    console.table(owners.rows);
    
  } catch (e) {
    console.error('Eroare:', e.message);
  } finally {
    pool.end();
  }
}

checkRLS();
