require('dotenv').config();
console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);
console.log("DATABASE_URL value:", process.env.DATABASE_URL?.substring(0, 30) + "...");
console.log("[DEPLOY] OpenBill v2.1 - Starting server...");
const session = require("express-session");
const bcrypt = require("bcrypt");
const express = require("express");

const fs = require("fs");
const path = require("path");
const db = require("./db");
const emailService = require("./email");

// ===== SUBDOMAIN MIDDLEWARE =====
// Extrage subdomeniul din request și setează compania curentă
async function subdomainMiddleware(req, res, next) {
  const host = req.headers.host || '';
  const parts = host.split('.');
  
  // Detectăm subdomeniul
  let subdomain = null;
  
  // Pentru localhost: fmd.localhost:3000 -> fmd
  // Pentru producție: fmd.openbill.ro -> fmd
  if (parts.length >= 2) {
    const potentialSubdomain = parts[0].toLowerCase();
    
    // Excludem 'www', 'localhost' și IP-uri
    if (potentialSubdomain !== 'www' && 
        potentialSubdomain !== 'localhost' &&
        potentialSubdomain !== '' &&
        !potentialSubdomain.match(/^\d+$/)) {
      subdomain = potentialSubdomain;
    }
  }
  
  // Dacă suntem pe localhost fără subdomeniu -> landing page (nu e nevoie de companie)
  if (!subdomain && (host === 'localhost' || host.startsWith('localhost:'))) {
    console.log(`[Subdomain] Landing page mode (localhost)`);
    return next();
  }
  
  // Dacă avem un subdomeniu, încercăm să găsim compania
  if (subdomain) {
    try {
      const company = await db.getCompanyBySubdomain(subdomain);
      if (company) {
        req.company = company;
        req.subdomain = subdomain;
        db.setCompanyContext(company);
        console.log(`[Subdomain] Companie detectată: ${company.name} (${subdomain})`);
      } else {
        // Subdomeniu invalid - doar logăm, nu blocăm
        console.log(`[Subdomain] Subdomeniu invalid: ${subdomain}`);
      }
    } catch (e) {
      console.error('[Subdomain] Eroare:', e.message);
    }
  } else {
    // Fără subdomeniu - modul public (landing page, login, signup)
    console.log(`[Subdomain] Mod public (fără subdomeniu)`);
  }
  
  next();
}

// Middleware pentru a asigura că avem o companie selectată
function requireCompany(req, res, next) {
  if (!req.company) {
    return res.status(403).json({ 
      error: "Companie necunoscută", 
      message: "Accesați aplicația prin subdomeniul companiei (ex: fmd.domeniu.ro)" 
    });
  }
  // Set companyId for backwards compatibility with API endpoints
  req.companyId = req.company.id;
  next();
}
const crypto = require("crypto");

const app = express();

// ===== ENCRYPTION CONFIG =====
// Criptare AES-256-GCM pentru token-uri sensibile
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '7a3f9c2b8e5d1a4f0c6b3e8a9d2f5c1b'; // fallback doar pentru dev

function encrypt(text) {
  if (!text) return null;
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    console.error('Encryption error:', e);
    return null;
  }
}

function decrypt(encryptedText) {
  if (!encryptedText) return null;
  if (!encryptedText.includes(':')) return encryptedText; // Dacă nu e criptat, returnează ca atare
  try {
    const parts = encryptedText.split(':');
    // Verificăm dacă avem exact 2 părți și partea a 2-a e hex valid
    if (parts.length !== 2 || !/^[0-9a-f]+$/i.test(parts[1])) {
      return encryptedText; // Nu arată ca un text criptat de noi
    }
    const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Decryption error (returning original):', e.message);
    return encryptedText; // Dacă decriptarea eșuează, returnăm originalul
  }
}

// ===== MULTI-TENANT CONFIG =====
// Planuri și prețuri
const PLANS = {
  starter: { 
    name: 'Starter', 
    price: 29.99, 
    maxUsers: 3, 
    features: ['comenzi', 'stoc', 'clienti', 'produse'],
    display: '29.99€'
  },
  pro: { 
    name: 'Pro', 
    price: 39.99, 
    maxUsers: 10, 
    features: ['comenzi', 'stoc', 'clienti', 'produse', 'rapoarte', 'foi_parcurs'],
    display: '39.99€'
  },
  enterprise: { 
    name: 'Enterprise', 
    price: 59.99, 
    maxUsers: 999, 
    features: ['toate_functionalitatile', 'api_access', 'support_priority'],
    display: '59.99€'
  }
};

// Categorii DEFAULT pentru clienți (folosite la crearea companiei noi)
const DEFAULT_CATEGORIES = ['Craiova', 'Targu Jiu', 'Valcea', 'Calafat', 'Olt', 'Hunedoara', 'Horezu', 'Altele'];

// Company cache pentru performanță
const companyCache = new Map();
const categoryCache = new Map(); // Cache pentru categorii per companie

// Inițializează tabelul company_categories dacă nu există
// NOTĂ: În noua arhitectură cu DB separate, tabelele sunt create la migrare
async function initCompanyCategoriesTable() {
  // Nu mai facem nimic aici - tabelele sunt deja create în DB-ul companiei
  console.log('ℹ️ initCompanyCategoriesTable - tabelele sunt în DB-uri separate');
}

// Obține categoriile pentru compania curentă
// NOTĂ: În noua arhitectură, nu mai e nevoie de companyId pentru că fiecare companie are DB separat
async function getCompanyCategories(companyId = null) {
  // Folosim un cache key generic pentru compania curentă
  const cacheKey = 'current';
  
  // Verifică cache
  if (categoryCache.has(cacheKey)) {
    return categoryCache.get(cacheKey);
  }
  
  try {
    const r = await db.q(
      `SELECT name FROM company_categories 
       WHERE is_active = true 
       ORDER BY sort_order, name`
    );
    
    const categories = r.rows.map(row => row.name);
    
    // Dacă nu există categorii, folosește default-urile
    if (categories.length === 0) {
      // Inserează categoriile default
      for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
        await db.q(
          `INSERT INTO company_categories (name, sort_order) 
           VALUES ($1, $2) 
           ON CONFLICT (name) DO NOTHING`,
          [DEFAULT_CATEGORIES[i], i]
        );
      }
      categoryCache.set(cacheKey, DEFAULT_CATEGORIES);
      return DEFAULT_CATEGORIES;
    }
    
    categoryCache.set(cacheKey, categories);
    return categories;
  } catch (e) {
    console.error('Eroare getCompanyCategories:', e);
    return DEFAULT_CATEGORIES;
  }
}

// Invalidă cache-ul de categorii
function invalidateCategoryCache(companyId = null) {
  categoryCache.delete('current');
}

// ===== DEMO DATA SEED =====
const DEMO_CLIENTS = [
  { name: 'Farmacia MedPlus', cui: 'RO12345678', address: 'Str. Victoriei nr. 10, Bucuresti', city: 'Bucuresti', county: 'Ilfov', phone: '0712345678', email: 'contact@medplus.ro' },
  { name: 'Farmacia Spring', cui: 'RO87654321', address: 'Bd. Unirii nr. 25, Bucuresti', city: 'Bucuresti', county: 'Ilfov', phone: '0723456789', email: 'office@springpharm.ro' },
  { name: 'Spitalul Municipal', cui: 'RO11223344', address: 'Str. Spitalului nr. 5, Cluj-Napoca', city: 'Cluj-Napoca', county: 'Cluj', phone: '0734567890', email: 'achizitii@spitalcluj.ro' },
  { name: 'Farmacia Catena', cui: 'RO44332211', address: 'Str. Republicii nr. 15, Timisoara', city: 'Timisoara', county: 'Timis', phone: '0745678901', email: 'timisoara@catena.ro' },
  { name: 'Centrul Medical Sanovil', cui: 'RO55667788', address: 'Bd. Decebal nr. 30, Iasi', city: 'Iasi', county: 'Iasi', phone: '0756789012', email: 'contact@sanovil.ro' },
  { name: 'Farmacia HelpNet', cui: 'RO99887766', address: 'Str. Principala nr. 100, Constanta', city: 'Constanta', county: 'Constanta', phone: '0767890123', email: 'constanta@helpnet.ro' },
  { name: 'Farmacia Dona', cui: 'RO22334455', address: 'Bd. Magheru nr. 45, Bucuresti', city: 'Bucuresti', county: 'Ilfov', phone: '0778901234', email: 'dona@dona.ro' },
  { name: 'Spitalul Judetean', cui: 'RO33445566', address: 'Str. Clinicilor nr. 3-5, Cluj-Napoca', city: 'Cluj-Napoca', county: 'Cluj', phone: '0789012345', email: 'farmacia@spitalcluj.ro' },
  { name: 'Farmacia Sensiblu', cui: 'RO44556677', address: 'Calea Victoriei nr. 120, Bucuresti', city: 'Bucuresti', county: 'Ilfov', phone: '0790123456', email: 'sensiblu@sensiblu.ro' },
  { name: 'Clinica MedLife', cui: 'RO55667799', address: 'Str. Gheorghe Lazar nr. 15, Bucuresti', city: 'Bucuresti', county: 'Ilfov', phone: '0701234567', email: 'contact@medlife.ro' },
  { name: 'Farmacia Tei', cui: 'RO66778800', address: 'Bd. Iuliu Maniu nr. 50, Bucuresti', city: 'Bucuresti', county: 'Ilfov', phone: '0711111111', email: 'tei@farmaciatei.ro' },
  { name: 'Spitalul Colentina', cui: 'RO77889911', address: 'Soseaua Stefan cel Mare nr. 10, Bucuresti', city: 'Bucuresti', county: 'Ilfov', phone: '0722222222', email: 'colentina@spitalcolentina.ro' },
  { name: 'Farmacia Ropharma', cui: 'RO88990022', address: 'Str. Mihai Viteazu nr. 25, Brasov', city: 'Brasov', county: 'Brasov', phone: '0733333333', email: 'brasov@ropharma.ro' },
  { name: 'Clinica Regina Maria', cui: 'RO99001133', address: 'Bd. Aviatorilor nr. 8, Bucuresti', city: 'Bucuresti', county: 'Ilfov', phone: '0744444444', email: 'reginamaria@reginamaria.ro' },
  { name: 'Farmacia Elvila', cui: 'RO00112244', address: 'Str. Traian nr. 18, Craiova', city: 'Craiova', county: 'Dolj', phone: '0755555555', email: 'craiova@elvila.ro' }
];

const DEMO_PRODUCTS = [
  { name: 'Paracetamol 500mg x 20cp', gtin: '5941234567890', price: 12.50, stock: 100, category: 'Analgezice' },
  { name: 'Ibuprofen 400mg x 10cp', gtin: '5941234567891', price: 15.99, stock: 80, category: 'Antiinflamatoare' },
  { name: 'Amoxicilina 500mg x 16cp', gtin: '5941234567892', price: 24.50, stock: 50, category: 'Antibiotice' },
  { name: 'Omeprazol 20mg x 14cp', gtin: '5941234567893', price: 18.75, stock: 60, category: 'Digestive' },
  { name: 'Vitamina C 1000mg x 30cp', gtin: '5941234567894', price: 32.00, stock: 120, category: 'Suplimente' },
  { name: 'Magnesium 375mg x 20cp', gtin: '5941234567895', price: 28.50, stock: 90, category: 'Suplimente' },
  { name: 'Aspirina 500mg x 20cp', gtin: '5941234567896', price: 9.99, stock: 150, category: 'Analgezice' },
  { name: 'Nurofen Forte 400mg x 10cp', gtin: '5941234567897', price: 22.00, stock: 70, category: 'Analgezice' },
  { name: 'Strepsils lamaie x 24cp', gtin: '5941234567898', price: 19.99, stock: 85, category: 'Raceala si gripa' },
  { name: 'Theraflu Raceala si Gripa x 10plic', gtin: '5941234567899', price: 26.50, stock: 45, category: 'Raceala si gripa' },
  { name: 'Tachipirina 500mg x 20cp', gtin: '5941234567900', price: 14.50, stock: 95, category: 'Analgezice' },
  { name: 'Enterofuryl 200mg x 20cp', gtin: '5941234567901', price: 21.00, stock: 55, category: 'Digestive' },
  { name: 'Claritine 10mg x 10cp', gtin: '5941234567902', price: 35.00, stock: 40, category: 'Alergii' },
  { name: 'Adalat Oros 30mg x 30cp', gtin: '5941234567903', price: 45.50, stock: 30, category: 'Cardiologice' },
  { name: 'Glucozamina 750mg x 60cp', gtin: '5941234567904', price: 55.00, stock: 25, category: 'Suplimente' }
];

async function seedDemoData(companyId) {
  console.log(`🌱 Seeding date DEMO pentru compania ${companyId}...`);
  
  try {
    // 1. Adăugăm clienții demo
    for (const client of DEMO_CLIENTS) {
      await db.q(
        `INSERT INTO clients (id, name, cui, address, city, county, phone, email, is_active, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, true, NOW())
         ON CONFLICT DO NOTHING`,
        [client.name, client.cui, client.address, client.city, client.county, client.phone, client.email]
      );
    }
    console.log(`  ✅ ${DEMO_CLIENTS.length} clienti demo adaugati`);
    
    // 2. Adăugăm produsele demo
    for (const product of DEMO_PRODUCTS) {
      await db.q(
        `INSERT INTO products (id, name, gtin, price, stock, category, is_active, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, true, NOW())
         ON CONFLICT DO NOTHING`,
        [product.name, product.gtin, product.price, product.stock, product.category]
      );
    }
    console.log(`  ✅ ${DEMO_PRODUCTS.length} produse demo adaugate`);
    
    // 3. Creăm câteva comenzi demo
    const clientsRes = await db.q(`SELECT id FROM clients LIMIT 3`);
    const productsRes = await db.q(`SELECT id, name, price FROM products LIMIT 5`);
    
    if (clientsRes.rows.length > 0 && productsRes.rows.length > 0) {
      const statuses = ['livrata', 'in_procesare', 'preluata'];
      
      for (let i = 0; i < 3; i++) {
        const clientId = clientsRes.rows[i % clientsRes.rows.length].id;
        const items = [];
        let total = 0;
        
        // 2-3 produse per comandă
        for (let j = 0; j < 2 + Math.floor(Math.random() * 2); j++) {
          const product = productsRes.rows[Math.floor(Math.random() * productsRes.rows.length)];
          const qty = 1 + Math.floor(Math.random() * 5);
          items.push({
            product_id: product.id,
            name: product.name,
            qty: qty,
            price: product.price,
            total: qty * product.price
          });
          total += qty * product.price;
        }
        
        await db.q(
          `INSERT INTO orders (id, client_id, items, total, status, due_date, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW() + INTERVAL '7 days', NOW() - INTERVAL '${i} days')`,
          [clientId, JSON.stringify(items), total, statuses[i]]
        );
      }
      console.log(`  ✅ 3 comenzi demo adaugate`);
    }
    
    console.log('✅ Date DEMO seedate cu succes!');
    return true;
  } catch (error) {
    console.error('❌ Eroare seeding date DEMO:', error);
    return false;
  }
}

async function getCompanyById(companyId) {
  if (!companyId) return null;
  if (companyCache.has(companyId)) {
    return companyCache.get(companyId);
  }
  
  try {
    const r = await db.q(`SELECT * FROM companies WHERE id = $1`);
    if (r.rows.length > 0) {
      companyCache.set(companyId, r.rows[0]);
      return r.rows[0];
    }
  } catch (e) {
    console.error('Eroare la citire companie:', e);
  }
  return null;
}

// ===== VALIDATION HELPERS =====

function validatePassword(password) {
  const errors = [];
  if (password.length < 8) {
    errors.push('minim 8 caractere');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('minim o literă mare');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('minim o literă mică');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('minim un număr');
  }
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function clearCompanyCache(companyId) {
  if (companyId) {
    companyCache.delete(companyId);
  } else {
    companyCache.clear();
  }
}

// ===== SMARTBILL CONFIG =====
const SMARTBILL_BASE_URL = 'https://ws.smartbill.ro/SBORO/api';

async function getCompanyDetails(companyId) {
  if (!companyId) {
    throw new Error('Company ID lipsă');
  }
  
  try {
    const r = await db.q(`SELECT * FROM company_settings WHERE id = 1`);
    if (r.rows.length) {
      return r.rows[0];
    }
  } catch (e) {
    console.error('Eroare la citire date firmă:', e);
    throw new Error('Eroare la citire date firmă');
  }
  
  throw new Error('Date firmă negăsite');
}

function getSmartbillAuthHeaders(token) {
  if (!token) {
    throw new Error('SmartBill token neconfigurat pentru această companie');
  }
  const authString = Buffer.from(token).toString('base64');
  return {
    'Authorization': `Basic ${authString}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

// ===== MIDDLEWARE =====

// Middleware pentru verificare admin
function isAdmin(req, res, next) {
  if (req.session?.user?.role !== 'admin') {
    return res.status(403).json({ error: "Acces interzis. Doar admin." });
  }
  next();
}

// Middleware pentru verificare autentificare
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Neautentificat", authenticated: false });
  }
  
  // Setăm contextul RLS pentru request-ul curent
  const user = req.session.user;
  db.setRLSContext(
    user.company_id,
    user.id,
    user.role === 'superadmin'
  );
  
  next();
}

// Middleware pentru verificare abonament activ (skip pentru admin/superadmin)
async function requireSubscription(req, res, next) {
  // Admin și SuperAdmin pot accesa tot fără abonament
  if (req.session?.user?.role === 'admin' || req.session?.user?.role === 'superadmin') {
    return next();
  }
  
  const companyId = req.session?.user?.company_id;
  if (!companyId) {
    return res.status(403).json({ 
      error: "Abonament necesar", 
      requiresSubscription: true,
      message: "Companie necunoscută" 
    });
  }
  
  try {
    const company = await getCompanyById(companyId);
    
    if (!company) {
      return res.status(403).json({ 
        error: "Abonament necesar", 
        requiresSubscription: true,
        message: "Companie negăsită" 
      });
    }
    
    const now = new Date();
    const expiresAt = company.subscription_expires_at;
    
    // Dacă are abonament activ sau este în perioada de probă (trial/demo) și nu a expirat
    const validStatuses = ['active', 'trial'];
    if (validStatuses.includes(company.subscription_status) && expiresAt && new Date(expiresAt) > now) {
      // Verificăm limita de utilizatori
      const userCountRes = await db.q(
        `SELECT COUNT(*)::int as count FROM users WHERE active = true`
      );
      const userCount = userCountRes.rows[0].count;
      
      if (userCount > company.max_users) {
        return res.status(403).json({
          error: "Limită utilizatori depășită",
          message: `Ați depășit limita de ${company.max_users} utilizatori pentru planul ${PLANS[company.plan]?.name || company.plan}`
        });
      }
      
      return next();
    }
    
    return res.status(403).json({ 
      error: "Abonament necesar", 
      requiresSubscription: true,
      plan: company.plan || 'starter',
      status: company.subscription_status || 'inactive',
      message: "Abonamentul a expirat sau nu este activ."
    });
  } catch (err) {
    console.error("Eroare verificare abonament:", err);
    return res.status(500).json({ error: "Eroare server la verificare abonament" });
  }
}

// Middleware pentru verificare funcționalități în funcție de plan
function requireFeature(feature) {
  return async (req, res, next) => {
    // Admin și SuperAdmin pot accesa tot
    if (req.session?.user?.role === 'admin' || req.session?.user?.role === 'superadmin') {
      return next();
    }
    
    const companyId = req.session?.user?.company_id;
    if (!companyId) {
      return res.status(403).json({ 
        error: "Funcționalitate blocată", 
        message: "Companie necunoscută",
        upgradeRequired: true
      });
    }
    
    try {
      const company = await getCompanyById(companyId);
      if (!company) {
        return res.status(403).json({ 
          error: "Funcționalitate blocată", 
          message: "Companie negăsită",
          upgradeRequired: true
        });
      }
      
      const planKey = company.plan || 'starter';
      const plan = PLANS[planKey];
      
      if (!plan) {
        return res.status(403).json({ 
          error: "Funcționalitate blocată", 
          message: "Plan necunoscut",
          upgradeRequired: true
        });
      }
      
      // Verificăm dacă funcționalitatea e disponibilă în plan
      if (plan.features.includes(feature) || plan.features.includes('toate_functionalitatile')) {
        return next();
      }
      
      return res.status(403).json({ 
        error: "Funcționalitate blocată", 
        message: `Funcționalitatea '${feature}' nu este disponibilă în planul ${plan.name}. Upgrade la Pro sau Enterprise pentru acces.`,
        upgradeRequired: true,
        currentPlan: planKey,
        requiredPlan: 'pro',
        feature: feature
      });
      
    } catch (err) {
      console.error("Eroare verificare funcționalitate:", err);
      return res.status(500).json({ error: "Eroare server" });
    }
  };
}

// Middleware combinat: auth + company + subscription
function requireAuthCompanySub(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Neautentificat", authenticated: false });
  }
  const companyId = req.session?.user?.company_id;
  if (!companyId) {
    return res.status(403).json({ error: "Companie necunoscută" });
  }
  req.companyId = companyId;
  
  // Skip subscription check pentru admin
  if (req.session.user.role === 'admin') {
    return next();
  }
  
  // Verificare subscription async
  getCompanyById(companyId).then(company => {
    if (!company) {
      return res.status(403).json({ error: "Companie negăsită" });
    }
    
    const now = new Date();
    if (company.subscription_status === 'active' && 
        company.subscription_expires_at && 
        new Date(company.subscription_expires_at) > now) {
      next();
    } else {
      res.status(403).json({ 
        error: "Abonament necesar",
        requiresSubscription: true 
      });
    }
  }).catch(err => {
    console.error("Eroare:", err);
    res.status(500).json({ error: "Eroare server" });
  });
}

// ============================================================
// FUNCȚIE HELPER: Creare companie cu bază de date separată
// ============================================================
async function createCompanyWithDatabase({ name, code, cui, address, phone, email, plan, planData }) {
  const companyId = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (plan === 'trial' ? 7 : 30));
  
  // Generează subdomain unic
  let baseSubdomain = name.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 15);
  if (baseSubdomain.length < 3) baseSubdomain = baseSubdomain + 'co';
  
  let subdomain = baseSubdomain;
  let counter = 1;
  while (true) {
    const existing = await db.masterQuery(
      `SELECT 1 FROM companies WHERE subdomain = $1`,
      [subdomain]
    );
    if (existing.rows.length === 0) break;
    subdomain = baseSubdomain + counter;
    counter++;
  }
  
  const finalCode = code || subdomain.toUpperCase();
  
  // Creează compania în master DB
  await db.masterQuery(
    `INSERT INTO companies (id, code, name, cui, address, phone, email, 
                          plan, plan_price, max_users, subscription_status, 
                          subscription_expires_at, subdomain, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
    [
      companyId, finalCode, name, cui || null, address || null, 
      phone || null, email || null, plan, planData.price, 
      planData.maxUsers, plan === 'trial' ? 'trial' : 'active', 
      expiresAt, subdomain, 'active'
    ]
  );
  
  // Creează baza de date separată
  const companyData = { id: companyId, subdomain };
  try {
    await db.createCompanyDatabase(companyData);
    
    // Setează contextul și creează settings default
    db.setCompanyContext(companyData);
    await db.q(
      `INSERT INTO company_settings (name, cui, smartbill_series)
       VALUES ($1, $2, 'OB')`,
      [name, cui || '']
    );
    db.resetCompanyContext();
  } catch (dbError) {
    console.error("[createCompanyWithDatabase] Eroare creare DB:", dbError.message);
    // Nu aruncăm eroarea - compania există în master DB și DB-ul se poate crea manual
  }
  
  return { companyId, subdomain, code: finalCode, expiresAt };
}

// ============================================================

app.get("/api/version", (req, res) => {
  res.json({
    version: "2026-03-06-multi-tenant",
    hasDb: db.hasDb(),
    multiTenant: true
  });
});

app.set("trust proxy", 1);

// middleware
app.use(express.json());
app.use(express.static("public", { index: false }));  // Nu servi index.html automat
app.use(session({
  name: "magazin.sid",
  secret: process.env.SESSION_SECRET || "schimba-asta-cu-o-cheie-lunga",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax"
  }
}));

// Middleware pentru detectarea subdomeniului și setarea companiei
app.use(subdomainMiddleware);

// Ruta default - Landing page pentru vizitatori
app.get("/", (req, res) => {
  if (req.session?.user) {
    // Dacă e logat, du-l la dashboard
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } else {
    // Dacă nu e logat, arată landing page
    res.sendFile(path.join(__dirname, "public", "landing.html"));
  }
});

// Cine sunt eu (pentru frontend)
app.get("/api/debug/subdomain", (req, res) => {
  res.json({
    host: req.headers.host,
    subdomain: req.subdomain || null,
    company: req.company ? { id: req.company.id, name: req.company.name, subdomain: req.company.subdomain } : null,
    hasDbContext: !!req.company
  });
});

app.get("/api/me", async (req, res) => {
  if (!req.session.user) return res.json({ loggedIn: false });
  
  // Citim datele fresh din DB pentru a avea first_name, last_name actualizate
  try {
    const userRes = await db.q(
      `SELECT id, username, role, first_name, last_name, position, email, company_id, active, is_approved,
              is_demo_user, demo_company_id, pending_company_id, email_verified
       FROM users WHERE id = $1`,
      [req.session.user.id]
    );
    
    if (userRes.rows.length === 0) {
      return res.json({ loggedIn: false });
    }
    
    const user = userRes.rows[0];
    
    res.json({ 
      loggedIn: true, 
      user: user,
      company: req.session.company || null
    });
  } catch (err) {
    console.error('Eroare /api/me:', err);
    // Fallback la sesiune dacă DB e offline
    res.json({ 
      loggedIn: true, 
      user: req.session.user,
      company: req.session.company || null
    });
  }
});

const DATA_DIR = path.join(__dirname, "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const STOCK_FILE = path.join(DATA_DIR, "stock.json");

// ================= COMPANY MANAGEMENT API =================

// GET /api/companies - Lista companiilor utilizatorului (doar pentru admin sau utilizator cu acces)
app.get("/api/companies", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin' || req.session.user.role === 'superadmin';
    
    let companies;
    if (isAdmin) {
      // Admin/SuperAdmin vede toate companiile
      const r = await db.q(`SELECT * FROM companies ORDER BY created_at DESC`);
      companies = r.rows;
    } else {
      // User obișnuit vede doar compania lui
      const userRes = await db.q(`SELECT company_id FROM users WHERE id = $1`, [userId]);
      if (userRes.rows.length === 0 || !userRes.rows[0].company_id) {
        return res.json([]);
      }
      const companyId = userRes.rows[0].company_id;
      const r = await db.q(`SELECT * FROM companies WHERE id = $1`);
      companies = r.rows;
    }
    
    res.json(companies);
  } catch (e) {
    console.error("GET /api/companies error:", e);
    res.status(500).json({ error: "Eroare la încărcarea companiilor" });
  }
});

// GET /api/client-categories - Returnează categoriile valide pentru clienți (per companie)
app.get("/api/client-categories", requireAuth, async (req, res) => {
  try {
    const companyId = req.session.user.company_id;
    const categories = await getCompanyCategories(companyId);
    res.json({ categories });
  } catch (e) {
    console.error("GET /api/client-categories error:", e);
    res.json({ categories: DEFAULT_CATEGORIES });
  }
});

// ===== COMPANY CATEGORIES API =====

// GET /api/admin/categories - Returnează toate categoriile companiei (cu detalii)
app.get("/api/admin/categories", requireAuth, async (req, res) => {
  try {
    const companyId = req.session.user.company_id;
    const r = await db.q(
      `SELECT id, name, emoji, sort_order, is_active, created_at 
       FROM company_categories 
       ORDER BY sort_order, name`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/admin/categories error:", e);
    res.status(500).json({ error: "Eroare la încărcarea categoriilor" });
  }
});

// POST /api/admin/categories - Adaugă o categorie nouă
app.post("/api/admin/categories", requireAuth, async (req, res) => {
  try {
    const companyId = req.session.user.company_id;
    const { name, emoji = '📍', sort_order = 0 } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: "Numele categoriei este obligatoriu" });
    }
    
    const r = await db.q(
      `INSERT INTO company_categories (name, emoji, sort_order) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (company_id, name) DO UPDATE 
       SET is_active = true, emoji = $3, sort_order = $4, updated_at = NOW()
       RETURNING *`,
      [name.trim(), emoji, sort_order]
    );
    
    invalidateCategoryCache(companyId);
    
    await logAudit(req, "CATEGORY_CREATED", "company_categories", r.rows[0].id, { name });
    
    res.json({ success: true, category: r.rows[0] });
  } catch (e) {
    console.error("POST /api/admin/categories error:", e);
    res.status(500).json({ error: "Eroare la salvarea categoriei" });
  }
});

// PUT /api/admin/categories/:id - Actualizează o categorie
app.put("/api/admin/categories/:id", requireAuth, async (req, res) => {
  try {
    const companyId = req.session.user.company_id;
    const categoryId = req.params.id;
    const { name, emoji, sort_order, is_active } = req.body;
    
    const r = await db.q(
      `UPDATE company_categories 
       SET name = COALESCE($1, name), 
           emoji = COALESCE($2, emoji), 
           sort_order = COALESCE($3, sort_order), 
           is_active = COALESCE($4, is_active),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name, emoji, sort_order, is_active, categoryId, companyId]
    );
    
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Categoria nu a fost găsită" });
    }
    
    invalidateCategoryCache(companyId);
    
    await logAudit(req, "CATEGORY_UPDATED", "company_categories", categoryId, { name });
    
    res.json({ success: true, category: r.rows[0] });
  } catch (e) {
    console.error("PUT /api/admin/categories/:id error:", e);
    res.status(500).json({ error: "Eroare la actualizarea categoriei" });
  }
});

// DELETE /api/admin/categories/:id - Șterge o categorie
app.delete("/api/admin/categories/:id", requireAuth, async (req, res) => {
  try {
    const companyId = req.session.user.company_id;
    const categoryId = req.params.id;
    
    // Verifică dacă există clienți în această categorie
    const checkR = await db.q(
      `SELECT COUNT(*) as count FROM clients WHERE category = (SELECT name FROM company_categories WHERE id = $2)`,
      [categoryId]
    );
    
    if (checkR.rows[0].count > 0) {
      return res.status(400).json({ 
        error: "Nu poți șterge această categorie pentru că are clienți asignați. Mută clienții în altă categorie mai întâi." 
      });
    }
    
    const r = await db.q(
      `DELETE FROM company_categories WHERE id = $1 RETURNING *`,
      [categoryId, companyId]
    );
    
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Categoria nu a fost găsită" });
    }
    
    invalidateCategoryCache(companyId);
    
    await logAudit(req, "CATEGORY_DELETED", "company_categories", categoryId, { name: r.rows[0].name });
    
    res.json({ success: true, message: "Categoria a fost ștearsă" });
  } catch (e) {
    console.error("DELETE /api/admin/categories/:id error:", e);
    res.status(500).json({ error: "Eroare la ștergerea categoriei" });
  }
});

// POST /api/companies - Creează companie nouă (doar admin)
app.post("/api/companies", requireAuth, async (req, res) => {
  try {
    // Doar admin poate crea companii noi direct
    if (req.session.user.role !== 'admin') {
      return res.status(403).json({ error: "Doar administratorul poate crea companii" });
    }
    
    const { code, name, cui, plan = 'starter' } = req.body;
    
    if (!code || !name) {
      return res.status(400).json({ error: "Cod și nume obligatorii" });
    }
    
    if (!PLANS[plan]) {
      return res.status(400).json({ error: "Plan invalid" });
    }
    
    const id = crypto.randomUUID();
    const planData = PLANS[plan];
    
    // Data expirare default: 30 zile de la creare
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    // Generează subdomain unic din nume
    let subdomain = name.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 15);
    // Adaugă sufix dacă există deja
    const existingSub = await db.masterQuery(
      `SELECT 1 FROM companies WHERE subdomain = $1`,
      [subdomain]
    );
    if (existingSub.rows.length > 0) {
      subdomain = subdomain + Date.now().toString(36).substring(0, 4);
    }
    
    // Creează compania în master DB
    await db.masterQuery(
      `INSERT INTO companies (id, code, name, cui, plan, plan_price, max_users, subscription_status, subscription_expires_at, subdomain, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, 'active')`,
      [id, code.toUpperCase(), name, cui || null, plan, planData.price, planData.maxUsers, expiresAt, subdomain]
    );
    
    // Creează baza de date separată pentru companie
    const companyData = { id, subdomain };
    try {
      await db.createCompanyDatabase(companyData);
      
      // Setează contextul și creează settings default
      db.setCompanyContext(companyData);
      await db.q(
        `INSERT INTO company_settings (name, cui, smartbill_series)
         VALUES ($1, $2, 'OB')`,
        [name, cui || 'RO47095864']
      );
      db.resetCompanyContext();
    } catch (dbError) {
      console.error("Eroare creare DB companie:", dbError.message);
      // Continuă chiar dacă DB nu s-a creat - se poate crea manual ulterior
    }
    
    res.json({ 
      success: true, 
      company: { 
        id, 
        code: code.toUpperCase(), 
        name, 
        plan,
        subdomain,
        expiresAt,
        url: `http://${subdomain}.localhost:3000`
      } 
    });
  } catch (e) {
    if (e.message.includes('unique') || e.message.includes('duplicate')) {
      return res.status(400).json({ error: "Cod companie existent deja" });
    }
    console.error("POST /api/companies error:", e);
    res.status(500).json({ error: "Eroare la crearea companiei" });
  }
});

// POST /api/companies/switch - Schimbă compania activă
app.post("/api/companies/switch", requireAuth, async (req, res) => {
  try {
    const { companyId } = req.body;
    const userId = req.session.user.id;
    
    // Verifică dacă utilizatorul are acces la această companie
    const accessRes = await db.q(
      `SELECT 1 FROM users WHERE id = $1`,
      [userId, companyId, req.session.user.role === 'admin']
    );
    
    if (accessRes.rows.length === 0) {
      return res.status(403).json({ error: "Nu aveți acces la această companie" });
    }
    
    // Actualizează sesiunea
    req.session.user.company_id = companyId;
    
    // Preia datele companiei
    const company = await getCompanyById(companyId);
    req.session.company = company;
    
    res.json({ 
      success: true, 
      company: {
        id: company.id,
        name: company.name,
        code: company.code,
        plan: company.plan
      }
    });
  } catch (e) {
    console.error("POST /api/companies/switch error:", e);
    res.status(500).json({ error: "Eroare la schimbarea companiei" });
  }
});

// PUT /api/admin/companies/:id/plan - Schimba planul unei companii (doar admin/superadmin)
app.put("/api/admin/companies/:id/plan", requireAuth, isAdmin, async (req, res) => {
  try {
    const companyId = req.params.id;
    const { plan } = req.body;
    
    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: "Plan invalid. Planuri disponibile: starter, pro, enterprise" });
    }
    
    const planData = PLANS[plan];
    
    // Actualizeaza planul in baza de date
    await db.q(
      `UPDATE companies 
       SET plan = $1, plan_price = $2, max_users = $3, updated_at = NOW()
       WHERE id = $4`,
      [plan, planData.price, planData.maxUsers, companyId]
    );
    
    // Invalida cache-ul companiei
    companyCache.delete(companyId);
    
    // Log audit
    await logAudit(req, "COMPANY_PLAN_CHANGED", "company", companyId, {
      newPlan: plan,
      planPrice: planData.price,
      maxUsers: planData.maxUsers
    });
    
    res.json({ 
      success: true, 
      message: `Planul a fost schimbat la ${planData.name}`,
      plan: plan,
      planName: planData.name,
      price: planData.price,
      maxUsers: planData.maxUsers
    });
  } catch (e) {
    console.error("PUT /api/admin/companies/:id/plan error:", e);
    res.status(500).json({ error: "Eroare la schimbarea planului" });
  }
});

// GET /api/admin/companies - Lista tuturor companiilor cu detalii (doar admin)
app.get("/api/admin/companies", requireAuth, isAdmin, async (req, res) => {
  try {
    const r = await db.q(
      `SELECT c.id, c.code, c.name, c.cui, c.plan, c.plan_price, c.max_users, 
              c.status, c.subscription_status, c.subscription_expires_at, c.created_at,
              (SELECT COUNT(*)::int FROM users WHERE active = true) as user_count
       FROM companies c
       ORDER BY c.created_at DESC`
    );
    
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/admin/companies error:", e);
    res.status(500).json({ error: "Eroare la incarcarea companiilor" });
  }
});

// PUT /api/admin/companies/:id/activate - Activează o companie pending și copiază datele în company_settings
app.put("/api/admin/companies/:id/activate", requireAuth, isAdmin, async (req, res) => {
  try {
    const companyId = req.params.id;
    
    // Verifică dacă compania există și e pending
    const companyRes = await db.q(
      `SELECT * FROM companies WHERE id = $1`,
      []
    );
    
    if (companyRes.rows.length === 0) {
      return res.status(404).json({ error: "Compania nu a fost găsită" });
    }
    
    const company = companyRes.rows[0];
    
    if (company.status !== 'pending') {
      return res.status(400).json({ error: "Compania nu este în status pending" });
    }
    
    // 1. Actualizează statusul companiei în 'active'
    await db.q(
      `UPDATE companies SET status = 'active', updated_at = NOW() WHERE id = $1`,
      []
    );
    
    // 2. Șterge TOATE datele de test (demo) pentru această companie
    // Companiile reale pornesc de la zero - fără date de test
    console.log(`[ACTIVATE] Se șterg datele de test pentru compania ${companyId}...`);
    
    // Ștergem în ordinea corectă pentru a evita constraint violations
    await db.q(`DELETE FROM order_items`);
    await db.q(`DELETE FROM orders`);
    await db.q(`DELETE FROM stock`);
    await db.q(`DELETE FROM vehicles`);
    await db.q(`DELETE FROM drivers`);
    await db.q(`DELETE FROM clients`);
    await db.q(`DELETE FROM products`);
    await db.q(`DELETE FROM client_categories`);
    await db.q(`DELETE FROM client_prices`);
    
    console.log(`[ACTIVATE] Datele de test au fost șterse pentru compania ${companyId}`);
    
    // 3. Copiază/Actualizează datele în company_settings
    // Folosim ON CONFLICT pentru cazul în care există deja (deși ar trebui să fie nouă)
    await db.q(
      `INSERT INTO company_settings (
        company_id, name, cui, address, phone, email, 
        registration_number, bank_name, bank_iban, smartbill_series, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        name = EXCLUDED.name,
        cui = EXCLUDED.cui,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        registration_number = EXCLUDED.registration_number,
        bank_name = EXCLUDED.bank_name,
        bank_iban = EXCLUDED.bank_iban,
        smartbill_series = EXCLUDED.smartbill_series,
        updated_at = NOW()`,
      [
        companyId,
        company.name,
        company.cui,
        company.address,
        company.phone,
        company.email,
        company.registration_number,
        company.bank_name,
        company.bank_iban,
        'OB' // default series
      ]
    );
    
    // 4. Mută utilizatorul din pending_company_id în company_id
    // Găsim userul care are această companie ca pending_company_id
    const userRes = await db.q(
      `SELECT id FROM users WHERE pending_company_id IS NOT NULL`,
    );
    
    if (userRes.rows.length > 0) {
      const userId = userRes.rows[0].id;
      
      await db.q(
        `UPDATE users 
         SET pending_company_id = NULL, updated_at = NOW()
         WHERE id = $2`,
        [userId]
      );
      
      // Trimite email de confirmare utilizatorului cu instrucțiuni de plată
      const userDetailsRes = await db.q(
        `SELECT email, first_name, last_name FROM users WHERE id = $1`,
        [userId]
      );
      
      if (userDetailsRes.rows.length > 0) {
        const userDetails = userDetailsRes.rows[0];
        const planPrice = company.plan_price || (company.plan === 'starter' ? 29.99 : company.plan === 'pro' ? 39.99 : 59.99);
        
        await emailService.sendMail({
          to: userDetails.email,
          subject: '✅ Compania ta a fost activată - OpenBill',
          html: `
            <h2>Felicitări, ${userDetails.first_name || ''}!</h2>
            <p>Compania <strong>${company.name}</strong> a fost activată cu succes în OpenBill.</p>
            <p><strong>Cod companie:</strong> ${company.code}</p>
            <p><strong>Plan:</strong> ${company.plan.toUpperCase()}</p>
            
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
            
            <h3>💳 Informații Plată</h3>
            <p>Vei primi factura pe email în cel mai scurt timp.</p>
            <p><strong>Plata se face prin Ordin de Plată la:</strong></p>
            <ul>
              <li><strong>Cont:</strong> RO49 AAAA 1B31 0075 9384 0000</li>
              <li><strong>Bancă:</strong> Banca Transilvania</li>
              <li><strong>Titular:</strong> OpenBill SRL</li>
              <li><strong>Sumă:</strong> ${planPrice}€</li>
              <li><strong>Mențiune:</strong> ${company.code}</li>
            </ul>
            
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin: 15px 0;">
              <p style="margin: 0; color: #856404;">
                <strong>⏰ Termen plată:</strong> 2 zile lucrătoare<br>
                <strong>⚠️ Important:</strong> Dacă plata nu este efectuată în termen de 2 zile, compania va fi ștearsă automat.
              </p>
            </div>
            
            <p>Plata va fi verificată manual în maxim 2 zile lucrătoare.</p>
            
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
            
            <p>Poți accesa acum toate funcționalitățile platformei:</p>
            <p><a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" style="background: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Accesează OpenBill</a></p>
          `
        });
      }
    }
    
    // Log audit
    await logAudit(req, "COMPANY_ACTIVATED", "companies", companyId, {
      name: company.name,
      cui: company.cui,
      plan: company.plan
    });
    
    res.json({
      success: true,
      message: `Compania ${company.name} a fost activată cu succes`,
      paymentInfo: {
        message: "Vei primi factura pe email. Plata se face prin Ordin de Plată.",
        account: "RO49 AAAA 1B31 0075 9384 0000",
        bank: "Banca Transilvania",
        beneficiary: "OpenBill SRL",
        amount: `${company.plan_price || (company.plan === 'starter' ? 29.99 : company.plan === 'pro' ? 39.99 : 59.99)}€`,
        reference: company.code,
        deadline: "2 zile lucrătoare",
        warning: "Dacă plata nu este efectuată în termen de 2 zile, compania va fi ștearsă automat."
      },
      company: {
        id: companyId,
        name: company.name,
        code: company.code,
        status: 'active'
      }
    });
    
  } catch (e) {
    console.error("PUT /api/admin/companies/:id/activate error:", e);
    res.status(500).json({ error: "Eroare la activarea companiei: " + e.message });
  }
});

// ================= SEED FUNCTIONS =================

async function seedClientsFromFileIfEmpty(companyId) {
  if (!db.hasDb() || !companyId) return;

  const r = await db.q("SELECT COUNT(*)::int AS n FROM clients");
  if ((r.rows?.[0]?.n ?? 0) > 0) return;

  const fileClients = readJson(CLIENTS_FILE, []);
  for (const c of fileClients) {
    const id = String(c.id ?? (Date.now().toString() + Math.random().toString(36).slice(2)));
    const name = String(c.name ?? "").trim();
    if (!name) continue;

    const group = String(c.group ?? "");
    const category = String(c.category ?? "");
    const prices = c.prices && typeof c.prices === "object" ? c.prices : {};

    await db.q(
      `INSERT INTO clients (id, name, group_name, category, prices)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, companyId, name, group, category, JSON.stringify(prices)]
    );
  }

  console.log(`✅ Clients seeded for company ${companyId}`);
}

async function seedProductsFromFileIfEmpty(companyId) {
  if (!db.hasDb() || !companyId) return;

  const r = await db.q("SELECT COUNT(*)::int AS n FROM products");
  if ((r.rows?.[0]?.n ?? 0) > 0) return;

  const list = readProductsAsList();

  for (const p of list) {
    const name = String(p.name || "").trim();
    if (!name) continue;

    const id = (p.id != null && String(p.id).trim() !== "") ? String(p.id) : null;
    const gtinClean = normalizeGTIN(p.gtin || "") || null;

    const gtinsArr = []
      .concat(gtinClean ? [gtinClean] : [])
      .concat(Array.isArray(p.gtins) ? p.gtins : [])
      .map(normalizeGTIN)
      .filter(Boolean);

    const category = String(p.category || "Altele").trim() || "Altele";
    const price = (p.price != null && p.price !== "") ? Number(p.price) : null;
    const idFinal = id && String(id).trim() ? String(id) : crypto.randomUUID();

    await db.q(
      `INSERT INTO products (id, name, gtin, gtins, category, price, active)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,true)
       ON CONFLICT (id) DO NOTHING`,
      [idFinal, companyId, name, gtinClean, JSON.stringify(gtinsArr), category, (Number.isFinite(price) ? price : null)]
    );
  }

  console.log(`✅ Products seeded for company ${companyId}`);
}

// ================= HELPER FUNCTIONS =================

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const txt = fs.readFileSync(filePath, "utf8");
    if (!txt.trim()) return fallback;
    return JSON.parse(txt);
  } catch (e) {
    console.error("Eroare citire JSON:", filePath, e.message);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

const AUDIT_FILE = path.join(DATA_DIR, "audit.json");

async function logAudit(req, action, entity, entityId, details = {}) {
  const u = req?.session?.user || null;
  const companyId = req?.companyId || req?.session?.user?.company_id || null;

  const row = {
    id: crypto.randomUUID(),
    action,
    entity,
    entityId: String(entityId || ""),
    user: u ? { id: u.id, username: u.username, role: u.role } : null,
    details,
    createdAt: new Date().toISOString()
  };

  if (db.hasDb()) {
    try {
      await db.q(
        `INSERT INTO audit (id, action, entity, entity_id, user_json, details, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::timestamptz)`,
        [
          row.id,
          companyId,
          row.action,
          row.entity,
          row.entityId,
          JSON.stringify(row.user),
          JSON.stringify(row.details),
          row.createdAt
        ]
      );
      return;
    } catch (e) {
      console.error("AUDIT DB ERROR:", e.message);
    }
  }

  // Fallback JSON
  const audit = readJson(AUDIT_FILE, []);
  audit.push(row);
  writeJson(AUDIT_FILE, audit);
}

function flattenClientsTree(tree) {
  const out = [];
  let id = 1;

  function addClient(name, pathArr) {
    if (!name) return;
    out.push({
      id: id++,
      name,
      path: pathArr.join(" / "),
      group: pathArr[0] || "",
      area: pathArr[1] || "",
    });
  }

  for (const top of Object.keys(tree || {})) {
    const node = tree[top];
    if (Array.isArray(node)) {
      node.forEach((c) => addClient(c, [top]));
    } else if (node && typeof node === "object") {
      for (const sub of Object.keys(node)) {
        const arr = node[sub];
        if (Array.isArray(arr)) {
          arr.forEach((c) => addClient(c, [top, sub]));
        }
      }
    }
  }
  return out;
}

function flattenProductsTree(tree) {
  const out = [];

  function walk(node, pathArr) {
    if (Array.isArray(node)) {
      node.forEach(item => {
        if (!item || !item.name) return;
        if (!item.id) {
          console.warn("Produs fără id:", item.name);
          return;
        }

        const pathStr = pathArr.join(" / ");
        out.push({
          id: String(item.id),
          name: item.name,
          gtin: item.gtin || "",
          price: item.price ?? null,
          path: pathStr || `Produse / ${item.category || "Altele"}`,
          category: item.category || pathArr[0] || "",
          subcategory: item.subcategory || pathArr[1] || "",
          subsubcategory: item.subsubcategory || pathArr[2] || ""
        });
      });
      return;
    }

    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        walk(node[key], [...pathArr, key]);
      }
    }
  }

  walk(tree, []);
  return out;
}

const LOCATION_ORDER = ["A", "B", "C", "R1", "R2", "R3"];

function locRank(loc) {
  const i = LOCATION_ORDER.indexOf(String(loc || "").toUpperCase());
  return i === -1 ? 999 : i;
}

function sqlLocOrderCase(colName = "location") {
  return `
    CASE UPPER(${colName})
      WHEN 'D1' THEN 1
      WHEN 'D2' THEN 2
      WHEN 'D3' THEN 3
      WHEN 'R1' THEN 4
      WHEN 'R2' THEN 5
      WHEN 'R3' THEN 6
      WHEN 'M1' THEN 7
      WHEN 'M2' THEN 8
      WHEN 'M3' THEN 9
      ELSE 999
    END
  `;
}

function normalizeGTIN(gtin) {
  let g = String(gtin || "").replace(/\D/g, "");
  if (g.length === 14 && g.startsWith("0")) g = g.slice(1);
  return g;
}

function allocateStockByLocation(stock, gtin, neededQty) {
  const g = normalizeGTIN(gtin);

  const lots = stock
    .filter(s => normalizeGTIN(s.gtin) === g && Number(s.qty) > 0)
    .sort((a, b) => locRank(a.location) - locRank(b.location));

  let remaining = Number(neededQty);
  const allocated = [];

  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.qty), remaining);

    allocated.push({
      stockId: lot.id,
      lot: lot.lot,
      expiresAt: lot.expiresAt,
      location: lot.location,
      qty: take
    });

    lot.qty -= take;
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error("Stoc insuficient");
  }

  return allocated;
}

function allocateFromSpecificLot(stock, gtin, lot, neededQty) {
  const g = normalizeGTIN(gtin);
  const lotStr = String(lot || "").trim();

  const lots = stock
    .filter(s =>
      normalizeGTIN(s.gtin) === g &&
      String(s.lot || "").trim() === lotStr &&
      Number(s.qty) > 0
    )
    .sort((a, b) => locRank(a.location) - locRank(b.location));

  let remaining = Number(neededQty);
  const allocated = [];

  for (const entry of lots) {
    if (remaining <= 0) break;
    const take = Math.min(Number(entry.qty), remaining);

    allocated.push({
      stockId: entry.id,
      lot: entry.lot,
      expiresAt: entry.expiresAt,
      location: entry.location || "A",
      qty: take
    });

    entry.qty = Number(entry.qty) - take;
    remaining -= take;
  }

  if (remaining > 0) throw new Error("Stoc insuficient pe lotul scanat");

  return allocated;
}

function readProductsAsList() {
  const data = readJson(PRODUCTS_FILE, []);
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    return flattenProductsTree(data);
  }
  return [];
}

// ----- API CLIENTS -----
app.get("/api/clients-tree", requireAuth, requireCompany, requireSubscription, async (req, res) => {
  try {
    const companyId = req.companyId;
    
    if (db.hasDb()) {
      const r = await db.q(
        `SELECT name, group_name as "group", category 
         FROM clients 
         ORDER BY name ASC`,
        []
      );
      
      const flat = r.rows.map(row => ({
        name: row.name,
        group: row.group || "",
        category: row.category || ""
      }));
      
      res.json(buildClientsTreeFromFlat(flat));
    } else {
      const flat = readJson(CLIENTS_FILE, []);
      res.json(buildClientsTreeFromFlat(Array.isArray(flat) ? flat : []));
    }
  } catch (e) {
    console.error("clients-tree error:", e);
    res.status(500).json({ error: "Eroare la clienți" });
  }
});

app.get("/api/clients-flat", requireAuth, requireCompany, requireSubscription, async (req, res) => {
  try {
    if (db.hasDb()) {
      const r = await db.q(
        `SELECT id, name, group_name, category, prices, cui
         FROM clients
         ORDER BY name ASC`
      );

      const out = r.rows.map(row => ({
        id: row.id,
        name: row.name,
        group: row.group_name || "",
        category: row.category || "",
        cui: row.cui || "",
        prices: row.prices || {}
      }));

      return res.json(out);
    }

    const clients = readJson(CLIENTS_FILE, []);
    return res.json(clients);
  } catch (e) {
    console.error("clients-flat error:", e);
    res.status(500).json({ error: "Eroare la clienți" });
  }
});

app.get("/api/clients/:id", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const id = String(req.params.id);

    const r = await db.q(
      `SELECT id, name, group_name AS "group", category, prices, cui, payment_terms
       FROM clients
       WHERE id = $1`,
      [id, companyId]
    );

    if (!r.rows.length) return res.status(404).json({ error: "Client inexistent" });

    const c = r.rows[0];
    c.prices = c.prices || {};
    return res.json(c);
  } catch (e) {
    console.error("GET /api/clients/:id error:", e);
    res.status(500).json({ error: "Eroare server" });
  }
});

app.put("/api/clients/:id/prices", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const id = String(req.params.id);
    const prices = req.body?.prices;

    if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
      return res.status(400).json({ error: "Body invalid. Trimite { prices: {...} }" });
    }

    // Verificăm că clientul aparține companiei
    const checkRes = await db.q(
      `SELECT 1 FROM clients WHERE id = $1`,
      [id, companyId]
    );
    
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: "Client inexistent" });
    }

    await db.q(
      `UPDATE clients SET prices = $1::jsonb WHERE id = $2`,
      [JSON.stringify(prices), id]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/clients/:id/prices error:", e);
    res.status(500).json({ error: "Eroare server" });
  }
});

function buildClientsTreeFromFlat(flat) {
  const tree = {};

  flat.forEach(c => {
    if (!c || !c.group || !c.category || !c.name) return;

    if (!tree[c.group]) tree[c.group] = {};
    if (!tree[c.group][c.category]) tree[c.group][c.category] = [];
    tree[c.group][c.category].push(c.name);
  });

  return tree;
}

// ----- API PRODUCTS -----
app.get("/api/products-tree", requireAuth, requireCompany, requireSubscription, async (req, res) => {
  try {
    const companyId = req.companyId;
    let list = [];

    if (db.hasDb()) {
      const r = await db.q(
        `SELECT id, name, category
         FROM products
         WHERE COALESCE(active, true) = true
         ORDER BY name ASC`,
        []
      );
      list = r.rows.map(x => ({ id: x.id, name: x.name, category: x.category || "Altele" }));
    } else {
      list = readProductsAsList();
    }

    const CATEGORY_ORDER = ["Seni Active Classic x30","Seni Active Classic x10","Seni Classic Air x30","Seni Classic Air x10","Seni Aleze x30","Seni Lady","Manusi","Altele","Absorbante Bella"];
    const treeByCategory = {};

    list.forEach(p => {
      const cat = (p.category || "Altele").trim();
      if (!treeByCategory[cat]) treeByCategory[cat] = [];
      treeByCategory[cat].push({ id: p.id, name: p.name });
    });

    Object.keys(treeByCategory).forEach(cat => {
      treeByCategory[cat].sort((a,b) => a.name.localeCompare(b.name, "ro"));
    });

    const sorted = {};
    CATEGORY_ORDER.forEach(cat => { if (treeByCategory[cat]) sorted[cat] = treeByCategory[cat]; });
    Object.keys(treeByCategory).forEach(cat => { if (!sorted[cat]) sorted[cat] = treeByCategory[cat]; });

    res.json(sorted);
  } catch (e) {
    console.error("products-tree error:", e);
    res.status(500).json({ error: "Eroare la produse" });
  }
});

app.put("/api/products/:id", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    
    if (!db.hasDb()) return res.status(500).json({ error: "DB neconfigurat" });

    const id = String(req.params.id);
    const { name, gtin, category, price, gtins } = req.body || {};

    // Verificăm că produsul aparține companiei
    const checkRes = await db.q(
      `SELECT 1 FROM products WHERE id = $1`,
      [id, companyId]
    );
    
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: "Produs inexistent" });
    }

    const gtinClean = normalizeGTIN(gtin || "") || null;
    const gtinsArr = []
      .concat(gtinClean ? [gtinClean] : [])
      .concat(Array.isArray(gtins) ? gtins : [])
      .map(normalizeGTIN)
      .filter(Boolean);

    const cat = String(category || "Altele").trim() || "Altele";
    const pr = (price != null && price !== "") ? Number(price) : null;

    await db.q(
      `UPDATE products
       SET name=$1, gtin=$2, gtins=$3::jsonb, category=$4, price=$5
       WHERE id=$6`,
      [String(name || "").trim(), gtinClean, JSON.stringify(gtinsArr), cat, (Number.isFinite(pr) ? pr : null), id, companyId]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/products/:id error:", e);
    return res.status(500).json({ error: e.message || "Eroare DB edit produs" });
  }
});

app.delete("/api/products/:id", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    
    if (!db.hasDb()) return res.status(500).json({ error: "DB neconfigurat" });

    const id = String(req.params.id);

    await db.q(
      `UPDATE products SET active=false WHERE id=$1`,
      [id, companyId]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/products/:id error:", e);
    return res.status(500).json({ error: e.message || "Eroare DB arhivare produs" });
  }
});

app.get("/api/products-flat", requireAuth, requireCompany, requireSubscription, async (req, res) => {
  try {
    const companyId = req.companyId;
    
    if (db.hasDb()) {
      // Get products
      const r = await db.q(
        `SELECT id, name, gtin, gtins, category, price
         FROM products
         WHERE COALESCE(active, true) = true
         ORDER BY name ASC`
      );
      
      // Get stock aggregated by GTIN
      let stockMap = {};
      try {
        const stockRes = await db.q(
          `SELECT gtin, SUM(qty) as total_qty 
           FROM stock 
           GROUP BY gtin`
        );
        stockRes.rows.forEach(row => {
          stockMap[row.gtin] = parseInt(row.total_qty) || 0;
        });
      } catch (stockErr) {
        console.log("Stock table not available or empty");
      }

      return res.json(r.rows.map(x => {
        const arr = Array.isArray(x.gtins) ? x.gtins : [];
        const primary = x.gtin || arr[0] || "";
        
        // Calculate stock for this product (by primary GTIN or any GTIN in array)
        let productStock = 0;
        if (primary && stockMap[primary]) {
          productStock = stockMap[primary];
        } else {
          // Try to find stock by any GTIN
          for (const g of arr) {
            if (stockMap[g]) {
              productStock = stockMap[g];
              break;
            }
          }
        }

        return {
          id: String(x.id),
          name: x.name,
          gtin: primary,
          gtins: arr,
          category: x.category || "Altele",
          price: x.price,
          stock: productStock,
          path: `Produse / ${x.category || "Altele"}`
        };
      }));
    }

    const data = readJson(PRODUCTS_FILE, []);
    if (Array.isArray(data)) return res.json(data);
    return res.json(flattenProductsTree(data));
  } catch (e) {
    console.error("products-flat error:", e);
    res.status(500).json({ error: "Eroare la produse: " + e.message });
  }
});

// ----- API ORDERS -----
app.get("/api/orders", requireAuth, requireCompany, requireSubscription, async (req, res) => {
  try {
    const companyId = req.companyId;
    
    if (!db.hasDb()) {
      const orders = readJson(ORDERS_FILE, []);
      return res.json(orders);
    }

    const r = await db.q(
      `SELECT id, client, items, status, created_at, sent_to_smartbill, 
              smartbill_series, smartbill_number, due_date, smartbill_error
       FROM orders
       WHERE 1=1
       ORDER BY created_at DESC`,
      []
    );

    const orders = r.rows.map(x => ({
      id: x.id,
      client: x.client,
      items: x.items,
      status: x.status,
      createdAt: x.created_at,
      sentToSmartbill: x.sent_to_smartbill,
      smartbillSeries: x.smartbill_series,
      smartbillNumber: x.smartbill_number,
      dueDate: x.due_date,
      smartbillError: x.smartbill_error
    }));

    res.json(orders);
  } catch (e) {
    console.error("GET /api/orders error:", e);
    res.status(500).json({ error: "Eroare DB la încărcare comenzi" });
  }
});

app.post("/api/orders", requireAuth, requireCompany, requireSubscription, async (req, res) => {
  try {
    const companyId = req.companyId;
    const { client, items } = req.body;
    
    if (!items || !items.length) {
      return res.status(400).json({ error: "Comandă goală" });
    }

    for (const item of items) {
      if (!item.gtin || String(item.gtin).trim() === '') {
        return res.status(400).json({ 
          error: `Produsul "${item.name}" nu are GTIN configurat.` 
        });
      }
    }

    const itemsWithAllocations = [];
    
    for (const item of items) {
      const qty = Number(item.qty || 0);
      if (qty <= 0) continue;
      
      const unitPrice = Number(item.price || 0);
      
      let allocations = [];
      try {
        if (db.hasDb()) {
          allocations = await allocateStockFromDB(item.gtin, qty, companyId);
        } else {
          const stock = readJson(STOCK_FILE, []);
          allocations = allocateStockByLocation(stock, item.gtin, qty);
          writeJson(STOCK_FILE, stock);
        }
      } catch (e) {
        return res.status(400).json({ 
          error: `Stoc insuficient pentru ${item.name}. ${e.message}` 
        });
      }
      
      itemsWithAllocations.push({
        id: item.id,
        name: item.name,
        gtin: item.gtin,
        qty: qty,
        unitPrice: unitPrice,
        lineTotal: unitPrice * qty,
        allocations: allocations
      });
    }

    let paymentTerms = 0;
    let dueDate = null;
    
    if (db.hasDb() && client.id) {
      const clientRes = await db.q(
        `SELECT payment_terms FROM clients WHERE id = $1`,
        [client.id]
      );
      if (clientRes.rows.length > 0) {
        paymentTerms = clientRes.rows[0].payment_terms || 0;
      }
    }
    
    if (paymentTerms > 0) {
      const today = new Date();
      dueDate = new Date(today);
      dueDate.setDate(today.getDate() + paymentTerms);
      dueDate = dueDate.toISOString().split('T')[0];
    }

    const newOrder = {
      id: Date.now().toString(),
      client,
      items: itemsWithAllocations,
      status: "in_procesare",
      sent_to_smartbill: false,
      smartbill_draft_sent: false,
      smartbill_error: null,
      smartbill_series: null,
      smartbill_number: null,
      payment_terms: paymentTerms,
      due_date: dueDate,
      createdAt: new Date().toISOString()
    };

    if (!db.hasDb()) {
      const orders = readJson(ORDERS_FILE, []);
      orders.push(newOrder);
      writeJson(ORDERS_FILE, orders);
      return res.json({ ok: true, order: newOrder });
    }

    await db.q(
      `INSERT INTO orders (id, client, items, status, created_at, sent_to_smartbill, 
       smartbill_draft_sent, smartbill_error, due_date, payment_terms)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::timestamptz, $6, $7, $8, $9, $10)`,
      [
        newOrder.id, 
        JSON.stringify(client),
        JSON.stringify(itemsWithAllocations), 
        newOrder.status, 
        newOrder.createdAt, 
        false, 
        false, 
        null,
        dueDate,
        paymentTerms
      ]
    );

    await logAudit(req, "ORDER_CREATE", "order", newOrder.id, {
      clientName: client?.name,
      paymentTerms,
      dueDate
    });

    return res.json({ 
      ok: true, 
      order: newOrder,
      message: "Comandă salvată. Poți să o trimiți la SmartBill când ești gata."
    });

  } catch (e) {
    console.error("POST /api/orders error:", e);
    res.status(500).json({ error: "Eroare la salvare comandă: " + (e.message || e) });
  }
});

// Continuare în partea 2...

// PARTEA 2 - Continuare server.js

app.post("/api/orders/:id/send", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const orderId = String(req.params.id);
    
    if (!db.hasDb()) {
      return res.status(500).json({ error: "DB neconfigurat" });
    }
    
    const orderRes = await db.q(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId]
    );
    
    if (!orderRes.rows.length) {
      return res.status(404).json({ error: "Comandă inexistentă" });
    }
    
    const order = orderRes.rows[0];
    
    if (order.sent_to_smartbill) {
      return res.status(400).json({ 
        error: "Comanda a fost deja trimisă la SmartBill",
        smartbillSeries: order.smartbill_series,
        smartbillNumber: order.smartbill_number
      });
    }
    
    const clientRes = await db.q(
      `SELECT cui FROM clients WHERE id = $1`,
      [order.client?.id]
    );
    const clientCui = clientRes.rows[0]?.cui || '';
    
    // Verificăm configurarea SmartBill pentru companie
    let company;
    try {
      company = await getCompanyDetails(companyId);
    } catch (err) {
      return res.status(400).json({
        error: "SmartBill neconfigurat",
        message: "Contul SmartBill nu este configurat pentru această companie. Contactați administratorul.",
        details: err.message
      });
    }
    
    // Verificăm explicit tokenul
    if (!company.smartbill_token) {
      return res.status(400).json({
        error: "SmartBill token lipsă",
        message: "Tokenul SmartBill nu este configurat. Contactați administratorul pentru configurare.",
        action: "Contactați suportul pentru a configura integrarea SmartBill."
      });
    }
    
    const payload = {
      companyVatCode: company.cui,
      client: {
        name: order.client?.name || 'Client',
        vatCode: clientCui,
        isTaxPayer: true,
        country: 'Romania'
      },
      isDraft: true,
      seriesName: company.smartbill_series || 'OB',
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: order.due_date,
      useStock: true,
      mentions: `Punct de lucru: ${order.client?.name || 'Client'}`,
      products: (order.items || []).map(item => ({
        name: item.name,
        code: item.gtin,
        measuringUnitName: "BUC",
        currency: 'RON',
        quantity: Number(item.qty || 0),
        price: Number(item.unitPrice || item.price || 0),
        isTaxIncluded: false,
        taxName: 'Normala',
        taxPercentage: 21,
        isDiscount: false,
        warehouseName: "DISTRIBUTIE",
        isService: false,
        saveToDb: false,
        productDescription: (item.allocations || []).map(alloc => {
          const lot = alloc.lot || '-';
          const exp = alloc.expiresAt ? new Date(alloc.expiresAt).toLocaleDateString('ro-RO') : '-';
          return `LOT: ${lot} | EXP: ${exp}`;
        }).join('\n')
      }))
    };
    
    console.log('=== SMARTBILL SEND PAYLOAD ===');
    console.log('Folosind token pentru compania:', company.name);
    console.log(JSON.stringify(payload, null, 2));
    
    // Decriptăm token-ul pentru utilizare
    const decryptedToken = decrypt(company.smartbill_token);
    console.log('=== SMARTBILL TOKEN DEBUG ===');
    console.log('Token from DB (first 20 chars):', company.smartbill_token ? company.smartbill_token.substring(0, 20) + '...' : 'NULL');
    console.log('Decrypted token exists:', !!decryptedToken);
    
    try {
      const response = await fetch(`${SMARTBILL_BASE_URL}/invoice`, {
        method: 'POST',
        headers: getSmartbillAuthHeaders(decryptedToken),
        body: JSON.stringify(payload)
      });
      
      const responseData = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        console.log('=== SMARTBILL ERROR RESPONSE ===');
        console.log('Status:', response.status);
        console.log('Response:', JSON.stringify(responseData, null, 2));
        throw new Error(responseData.error || responseData.message || `Eroare HTTP ${response.status}`);
      }
      
      await db.q(
        `UPDATE orders SET 
          sent_to_smartbill = true,
          smartbill_draft_sent = true,
          smartbill_response = $1,
          smartbill_series = $2,
          smartbill_number = $3,
          status = 'facturata'
         WHERE id = $4`,
        [
          JSON.stringify(responseData),
          responseData.series || null,
          responseData.number || null,
          orderId
        ]
      );
      
      await logAudit(req, "ORDER_SEND_SMARTBILL", "order", orderId, {
        clientName: order.client?.name,
        smartbillSeries: responseData.series,
        smartbillNumber: responseData.number
      });
      
      return res.json({
        success: true,
        message: "Comandă trimisă cu succes în SmartBill",
        smartbillSeries: responseData.series,
        smartbillNumber: responseData.number,
        smartbillUrl: responseData.url,
        dueDate: order.due_date
      });
      
    } catch (smartbillErr) {
      await db.q(
        `UPDATE orders SET 
          smartbill_error = $1,
          smartbill_response = $2
         WHERE id = $3`,
        [smartbillErr.message, JSON.stringify({error: smartbillErr.message}), orderId]
      );
      
      await logAudit(req, "ORDER_SEND_SMARTBILL_FAIL", "order", orderId, {
        error: smartbillErr.message
      });
      
      return res.status(500).json({
        error: `Eroare SmartBill: ${smartbillErr.message}`,
        requiresRetry: true
      });
    }
    
  } catch (e) {
    console.error("POST /api/orders/:id/send error:", e);
    res.status(500).json({ error: e.message || "Eroare server" });
  }
});

app.put("/api/orders/:id", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const orderId = String(req.params.id);
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Items invalid" });
    }

    if (!db.hasDb()) {
      return res.status(500).json({ error: "DB neconfigurat" });
    }

    const checkRes = await db.q(
      `SELECT sent_to_smartbill, items FROM orders WHERE id=$1`,
      [orderId]
    );

    if (!checkRes.rows.length) {
      return res.status(404).json({ error: "Comandă inexistentă" });
    }
    
    if (checkRes.rows[0].sent_to_smartbill) {
      return res.status(403).json({ 
        error: "Comanda a fost deja trimisă la SmartBill și nu poate fi modificată"
      });
    }

    const oldItems = checkRes.rows[0].items || [];
    for (const oldItem of oldItems) {
      const allocs = oldItem.allocations || [];
      for (const alloc of allocs) {
        if (alloc.stockId && alloc.qty) {
          await db.q(
            `UPDATE stock SET qty = qty + $1 WHERE id=$2`,
            [Number(alloc.qty), alloc.stockId]
          );
        }
      }
    }

    const newItems = [];
    
    for (const it of items) {
      const qty = Number(it.qty || 0);
      if (qty <= 0) continue;

      const unitPrice = Number(it.price || 0);
      const allocations = await allocateStockFromDB(it.gtin, qty, companyId);
      
      newItems.push({
        id: it.id,
        name: it.name,
        gtin: it.gtin,
        qty: qty,
        unitPrice: unitPrice,
        lineTotal: unitPrice * qty,
        allocations: allocations
      });
    }

    await db.q(
      `UPDATE orders SET items=$1::jsonb WHERE id=$2`,
      [JSON.stringify(newItems), orderId]
    );

    await logAudit(req, "ORDER_UPDATE", "order", orderId, {
      itemsCount: newItems.length
    });

    res.json({ ok: true, message: "Comandă actualizată" });
  } catch (e) {
    console.error("PUT /api/orders/:id error:", e);
    res.status(500).json({ error: e.message || "Eroare la actualizare" });
  }
});

async function allocateStockFromDB(gtin, neededQty, companyId) {
  const g = normalizeGTIN(gtin);
  if (!g) throw new Error("GTIN invalid");

  const productRes = await db.q(
    `SELECT id, gtin, gtins FROM products 
     WHERE (gtin = $1 OR gtins::jsonb @> to_jsonb($1))
     LIMIT 1`,
    [g]
  );
  
  if (!productRes.rows.length) {
    throw new Error(`Produs cu GTIN ${gtin} nu există în catalog`);
  }
  
  const product = productRes.rows[0];
  
  let allGtins = [];
  if (product.gtin) allGtins.push(product.gtin);
  
  if (product.gtins) {
    try {
      const gtinsArray = typeof product.gtins === 'string' 
        ? JSON.parse(product.gtins) 
        : product.gtins;
      if (Array.isArray(gtinsArray)) {
        allGtins = allGtins.concat(gtinsArray);
      }
    } catch (e) {
      console.error('Eroare parsing gtins:', e);
    }
  }

  const uniqueGtins = [...new Set(allGtins.map(normalizeGTIN))].filter(Boolean);
  
  console.log(`[Stock] Produs ${product.id}, GTIN-uri: ${uniqueGtins.join(', ')}`);

  const locCase = sqlLocOrderCase("location");
  let remaining = Number(neededQty);
  const allocated = [];

  for (const productGtin of uniqueGtins) {
    if (remaining <= 0) break;
    
    let r = await db.q(
      `SELECT id, gtin, lot, expires_at, qty, location, warehouse
       FROM stock
       WHERE gtin=$1 AND warehouse='depozit' AND qty > 0
       ORDER BY ${locCase} ASC
       FOR UPDATE`,
      [productGtin]
    );

    for (const s of r.rows) {
      if (remaining <= 0) break;

      const avail = Number(s.qty || 0);
      if (avail <= 0) continue;

      const take = Math.min(avail, remaining);

      await db.q(
        `UPDATE stock SET qty = qty - $1 WHERE id=$2`,
        [take, s.id]
      );

      allocated.push({
        stockId: s.id,
        lot: s.lot,
        expiresAt: s.expires_at ? s.expires_at.toISOString().slice(0, 10) : null,
        location: s.location || (s.warehouse === 'magazin' ? 'M1' : 'D1'),
        warehouse: s.warehouse,
        qty: take,
        gtinUsed: s.gtin
      });

      remaining -= take;
    }
  }

  if (remaining > 0) {
    console.log(`[Stock] Fallback Magazin pentru ${gtin}, mai lipsesc ${remaining} buc`);
    
    for (const productGtin of uniqueGtins) {
      if (remaining <= 0) break;
      
      let r = await db.q(
        `SELECT id, gtin, lot, expires_at, qty, location, warehouse
         FROM stock
         WHERE gtin=$2 AND warehouse='magazin' AND qty > 0
         ORDER BY expires_at ASC
         FOR UPDATE`,
        [productGtin]
      );

      for (const s of r.rows) {
        if (remaining <= 0) break;

        const avail = Number(s.qty || 0);
        if (avail <= 0) continue;

        const take = Math.min(avail, remaining);

        await db.q(
          `UPDATE stock SET qty = qty - $1 WHERE id=$2`,
          [take, s.id]
        );

        allocated.push({
          stockId: s.id,
          lot: s.lot,
          expiresAt: s.expires_at ? s.expires_at.toISOString().slice(0, 10) : null,
          location: s.location || 'MAGAZIN',
          warehouse: 'magazin',
          qty: take,
          gtinUsed: s.gtin
        });

        remaining -= take;
      }
    }
  }

  if (remaining > 0) {
    throw new Error(`Stoc insuficient. Lipsă ${remaining} buc în Depozit și Magazin`);
  }

  return allocated;
}

app.post("/api/orders/:id/status", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const allowed = new Set(["in_procesare", "facturata", "gata_de_livrare", "livrata"]);
    if (!allowed.has(req.body.status)) {
      return res.status(400).json({ error: "Status invalid" });
    }

    const id = String(req.params.id);
    const newStatus = req.body.status;

    if (!db.hasDb()) {
      const orders = readJson(ORDERS_FILE, []);
      const order = orders.find(o => String(o.id) === id);
      if (!order) return res.status(404).json({ error: "Comandă inexistentă" });

      order.status = newStatus;
      writeJson(ORDERS_FILE, orders);

      await logAudit(req, "ORDER_STATUS", "order", order.id, {
        clientName: order.client?.name,
        newStatus: order.status
      });

      return res.json({ ok: true });
    }

    const r = await db.q(
      `UPDATE orders SET status=$1 WHERE id=$2 RETURNING id, client`,
      [newStatus, id]
    );
    
    if (!r.rows.length) return res.status(404).json({ error: "Comandă inexistentă" });

    await logAudit(req, "ORDER_STATUS", "order", id, {
      clientName: r.rows[0].client?.name,
      newStatus
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/orders/:id/status error:", e);
    res.status(500).json({ error: "Eroare DB status" });
  }
});

app.delete("/api/orders/:id", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const orderId = String(req.params.id);
    
    if (!db.hasDb()) {
      return res.status(500).json({ error: "DB neconfigurat" });
    }
    
    const checkRes = await db.q(
      `SELECT sent_to_smartbill, items FROM orders WHERE id = $1`,
      [orderId, companyId]
    );
    
    if (!checkRes.rows.length) {
      return res.status(404).json({ error: "Comandă inexistentă" });
    }
    
    if (checkRes.rows[0].sent_to_smartbill) {
      return res.status(403).json({ 
        error: "Comanda a fost deja trimisă la SmartBill și nu poate fi ștearsă"
      });
    }
    
    const items = checkRes.rows[0].items || [];
    for (const item of items) {
      for (const alloc of item.allocations || []) {
        if (alloc.stockId && alloc.qty) {
          await db.q(
            `UPDATE stock SET qty = qty + $1 WHERE id=$2`,
            [alloc.qty, alloc.stockId]
          );
        }
      }
    }
    
    await db.q(
      `DELETE FROM orders WHERE id = $1`,
      [orderId, companyId]
    );
    
    await logAudit(req, "ORDER_DELETE", "order", orderId, {});
    
    res.json({ ok: true, message: "Comandă ștearsă" });
    
  } catch (e) {
    console.error("DELETE /api/orders/:id error:", e);
    res.status(500).json({ error: e.message || "Eroare la ștergere" });
  }
});

// ----- API STOCK -----
app.get("/api/stock", requireAuth, requireCompany, requireSubscription, async (req, res) => {
  try {
    const companyId = req.companyId;
    const warehouse = req.query.warehouse || 'depozit';
    
    if (!db.hasDb()) {
      const stock = readJson(STOCK_FILE, []).filter(s => (s.warehouse || 'depozit') === warehouse);
      return res.json(stock);
    }

    const r = await db.q(
      `SELECT id, gtin, product_name, lot, expires_at, qty, location, warehouse, created_at
       FROM stock 
       WHERE warehouse = $1
       ORDER BY created_at DESC`,
      [warehouse]
    );

    const out = r.rows.map(s => ({
      id: s.id,
      gtin: s.gtin,
      productName: s.product_name,
      lot: s.lot,
      expiresAt: s.expires_at,
      qty: Number(s.qty || 0),
      location: s.location || (s.warehouse === 'magazin' ? 'M1' : 'D1'),
      warehouse: s.warehouse || 'depozit',
      createdAt: s.created_at
    }));

    res.json(out);
  } catch (e) {
    console.error("GET /api/stock error:", e);
    res.status(500).json({ error: "Eroare DB stock" });
  }
});

app.post("/api/stock", requireAuth, requireCompany, requireSubscription, async (req, res) => {
  try {
    const companyId = req.companyId;
    const warehouse = req.body.warehouse || 'depozit';
    const location = warehouse === 'magazin' ? (req.body.location || 'M1') : (req.body.location || 'D1');
    
    const entry = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      gtin: String(req.body.gtin || "").trim(),
      productName: String(req.body.productName || "").trim(),
      lot: String(req.body.lot || "").trim(),
      expiresAt: String(req.body.expiresAt || "").slice(0, 10),
      qty: Number(req.body.qty),
      location: location,
      warehouse: warehouse,
      createdAt: new Date().toISOString()
    };

    if (!entry.gtin) return res.status(400).json({ error: "Lipsește GTIN" });

    if (!db.hasDb()) {
      const stock = readJson(STOCK_FILE, []);
      stock.push(entry);
      writeJson(STOCK_FILE, stock);
      return res.json({ ok: true, entry });
    }

    await db.q(
      `INSERT INTO stock (id, gtin, product_name, lot, expires_at, qty, location, warehouse, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10::timestamptz)`,
      [entry.id, companyId, entry.gtin, entry.productName, entry.lot, entry.expiresAt, entry.qty, entry.location, entry.warehouse, entry.createdAt]
    );

    await logAudit(req, "STOCK_ADD", "stock", entry.id, {
      gtin: entry.gtin,
      productName: entry.productName,
      lot: entry.lot,
      qty: entry.qty,
      warehouse: entry.warehouse,
      location: entry.location
    });

    res.json({ ok: true, entry });
  } catch (e) {
    console.error("POST /api/stock error:", e);
    res.status(500).json({ error: "Eroare DB stock add" });
  }
});

app.post("/api/stock/transfer", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const { gtin, productName, lot, expiresAt, qty, fromWarehouse, toWarehouse, fromLocation, toLocation } = req.body;
    
    if (!gtin || !lot || !qty || !fromWarehouse || !toWarehouse) {
      return res.status(400).json({ error: "Date incomplete" });
    }

    const transferQty = Number(qty);
    if (!Number.isFinite(transferQty) || transferQty <= 0) {
      return res.status(400).json({ error: "Cantitate invalidă" });
    }

    const g = normalizeGTIN(gtin);
    const sourceLoc = fromWarehouse === 'magazin' ? (fromLocation || 'M1') : (fromLocation || 'D1');
    const destLoc = toWarehouse === 'magazin' ? (toLocation || 'M1') : (toLocation || 'D1');

    console.log(`Transfer: ${transferQty} buc ${g} lot ${lot} din ${fromWarehouse}/${sourceLoc} în ${toWarehouse}/${destLoc}`);

    await db.q("BEGIN");

    const r1 = await db.q(
      `UPDATE stock SET qty = qty - $1 
       WHERE gtin=$3 AND lot=$4 AND warehouse=$5 AND location=$6 AND qty >= $1
       RETURNING id, qty as remaining`,
      [transferQty, companyId, g, lot, fromWarehouse, sourceLoc]
    );

    if (r1.rows.length === 0) {
      await db.q("ROLLBACK");
      return res.status(400).json({ 
        error: "Stoc insuficient în sursă sau lotul nu există în locația selectată"
      });
    }

    const r2 = await db.q(
      `SELECT id, qty FROM stock WHERE gtin=$2 AND lot=$3 AND warehouse=$4 AND location=$5`,
      [g, lot, toWarehouse, destLoc]
    );

    if (r2.rows.length > 0) {
      await db.q(
        `UPDATE stock SET qty = qty + $1 WHERE id=$2`,
        [transferQty, r2.rows[0].id]
      );
    } else {
      const newId = crypto.randomUUID();
      await db.q(
        `INSERT INTO stock (id, gtin, product_name, lot, expires_at, qty, location, warehouse)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newId, companyId, g, productName, lot, expiresAt, transferQty, destLoc, toWarehouse]
      );
    }

    await db.q(
      `INSERT INTO stock_transfers (id, gtin, product_name, lot, expires_at, qty, from_warehouse, to_warehouse, from_location, to_location, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [crypto.randomUUID(), companyId, g, productName, lot, expiresAt, transferQty, fromWarehouse, toWarehouse, sourceLoc, destLoc, req.session?.user?.username || 'system']
    );

    await db.q("COMMIT");
    res.json({ ok: true, message: `Transfer ${transferQty} buc realizat cu succes` });

  } catch (e) {
    try { await db.q("ROLLBACK"); } catch {}
    console.error("Transfer error:", e);
    res.status(500).json({ error: e.message || "Eroare internă la transfer" });
  }
});

// ----- API AUDIT -----
app.get("/api/audit", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    
    if (!db.hasDb()) return res.json(readJson(AUDIT_FILE, []));
    
    const r = await db.q(
      `SELECT id, action, entity, entity_id, user_json, details, created_at
       FROM audit
       WHERE 1=1
       ORDER BY created_at DESC
       LIMIT 200`,
      []
    );
    
    res.json(r.rows.map(x => ({
      id: x.id,
      action: x.action,
      entity: x.entity,
      entityId: x.entity_id,
      user: x.user_json,
      details: x.details,
      createdAt: x.created_at
    })));
  } catch (e) {
    res.status(500).json({ error: "Eroare audit" });
  }
});

// ----- API AUTH -----

// Funcție helper pentru a găsi userul în toate companiile (când suntem pe localhost)
async function findUserInAllCompanies(username) {
  // Luăm lista companiilor din master DB
  const companiesRes = await db.masterQuery(`SELECT id, subdomain FROM companies WHERE status = 'active'`);
  
  for (const company of companiesRes.rows) {
    try {
      // Setăm contextul pentru această companie
      db.setCompanyContext(company);
      
      // Căutăm userul
      const userRes = await db.q(
        `SELECT id, username, password_hash, role, active, is_approved, 
                failed_attempts, unlock_at, last_failed_at
         FROM users
         WHERE username=$1 OR LOWER(email)=LOWER($1) LIMIT 1`,
        [username]
      );
      
      if (userRes.rows.length > 0) {
        return {
          user: userRes.rows[0],
          company: company
        };
      }
    } catch (e) {
      // Compania nu are încă DB sau altă eroare - continuăm cu următoarea
      continue;
    }
  }
  
  return null;
}

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!db.hasDb()) return res.status(500).json({ error: "DB neconfigurat" });

    let userData = null;
    let companyData = null;

    if (req.company) {
      // Suntem pe subdomeniu - căutăm în compania curentă
      const r = await db.q(
        `SELECT id, username, password_hash, role, active, is_approved, 
                failed_attempts, unlock_at, last_failed_at
         FROM users
         WHERE username=$1 OR LOWER(email)=LOWER($1) LIMIT 1`,
        [username]
      );
      if (r.rows.length > 0) {
        userData = r.rows[0];
        companyData = req.company;
      }
    } else {
      // Suntem pe localhost - căutăm în toate companiile
      const result = await findUserInAllCompanies(username);
      if (result) {
        userData = result.user;
        companyData = result.company;
      }
    }

    if (!userData) return res.status(401).json({ error: "User sau parolă greșită" });
    
    // Setăm contextul companiei pentru operațiunile viitoare
    if (companyData) {
      db.setCompanyContext(companyData);
    }

    const u = userData;

    const now = new Date();

    if (u.failed_attempts > 0 && u.last_failed_at) {
      const lastFail = new Date(u.last_failed_at);
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60000);
      
      if (lastFail < thirtyMinAgo) {
        await db.q(
          `UPDATE users SET failed_attempts = 0, unlock_at = null, last_failed_at = null WHERE id = $1`,
          [u.id]
        );
        u.failed_attempts = 0;
        u.unlock_at = null;
      }
    }

    if (u.failed_attempts >= 3 && u.unlock_at) {
      const unlockTime = new Date(u.unlock_at);
      if (unlockTime > now) {
        const minutesLeft = Math.ceil((unlockTime - now) / 60000);
        return res.status(403).json({ 
          locked: true,
          minutesLeft: minutesLeft,
          message: `Cont blocat. Mai așteaptă ${minutesLeft} minute.` 
        });
      } else {
        await db.q(
          `UPDATE users SET failed_attempts = 0, unlock_at = null, last_failed_at = null WHERE id = $1`,
          [u.id]
        );
        u.failed_attempts = 0;
      }
    }

    if (!u.active) return res.status(401).json({ error: "User sau parolă greșită" });
    if (!u.is_approved) {
      return res.status(403).json({ pending: true, message: "Cont în așteptare" });
    }
    
    // Verificare email pentru utilizatorii noi (demo) - skip pentru admin/superadmin
    if (u.role !== 'admin' && u.role !== 'superadmin') {
      const emailCheck = await db.q(
        `SELECT email_verified FROM users WHERE id = $1`,
        [u.id]
      );
      if (emailCheck.rows.length > 0 && !emailCheck.rows[0].email_verified) {
        return res.status(403).json({ 
          emailNotVerified: true, 
          message: "Verifică-ți email-ul înainte de a te autentifica."
        });
      }
    }

    const ok = bcrypt.compareSync(password, u.password_hash);
    
    if (!ok) {
      const newAttempts = (u.failed_attempts || 0) + 1;
      
      if (newAttempts >= 3) {
        const unlockAt = new Date(now.getTime() + 30 * 60000);
        await db.q(
          `UPDATE users SET failed_attempts = $1, last_failed_at = NOW(), unlock_at = $2 WHERE id = $3`,
          [newAttempts, unlockAt, u.id]
        );
        
        return res.status(403).json({ 
          locked: true, 
          minutesLeft: 30,
          message: "Cont blocat pentru 30 minute după 3 încercări eșuate." 
        });
      } else {
        await db.q(
          `UPDATE users SET failed_attempts = $1, last_failed_at = NOW() WHERE id = $2`,
          [newAttempts, u.id]
        );
        
        return res.status(401).json({ 
          error: "User sau parolă greșită",
          attemptsLeft: 3 - newAttempts 
        });
      }
    }

    await db.q(
      `UPDATE users SET failed_attempts = 0, unlock_at = null, last_failed_at = null WHERE id = $1`,
      [u.id]
    );

    let companyInfo = null;
    let redirectUrl = null;
    
    if (req.company) {
      // Suntem pe subdomeniu - folosim compania detectată
      companyInfo = {
        id: req.company.id,
        name: req.company.name,
        code: req.company.code,
        plan: req.company.plan,
        subdomain: req.company.subdomain
      };
    } else {
      // Suntem pe localhost - căutăm compania userului în master DB
      try {
        const host = req.headers.host || '';
        const baseDomain = host.includes(':') ? host.split(':')[0] : host;
        const port = host.includes(':') ? ':' + host.split(':')[1] : '';
        
        // Căutăm toate companiile și verificăm care are acest user
        const companiesRes = await db.masterQuery(
          `SELECT c.id, c.name, c.code, c.plan, c.subdomain 
           FROM companies c
           JOIN users u ON u.company_id = c.id
           WHERE u.id = $1 AND c.status = 'active'`,
          [u.id]
        );
        
        if (companiesRes.rows.length > 0) {
          const comp = companiesRes.rows[0];
          companyInfo = {
            id: comp.id,
            name: comp.name,
            code: comp.code,
            plan: comp.plan,
            subdomain: comp.subdomain
          };
          // Construim URL-ul de redirect
          redirectUrl = `http://${comp.subdomain}.${baseDomain}${port}`;
        }
      } catch (e) {
        console.error('[Login] Eroare căutare companie:', e.message);
      }
    }
    
    req.session.user = { 
      id: u.id, 
      username: u.username, 
      role: u.role, 
      is_approved: u.is_approved,
      company_id: companyInfo ? companyInfo.id : null
    };
    
    if (companyInfo) {
      req.session.company = companyInfo;
    }
    
    res.json({ 
      ok: true, 
      user: req.session.user,
      company: companyInfo,
      redirectUrl: redirectUrl // URL pentru redirect dacă suntem pe localhost
    });
    
  } catch (e) {
    console.error("LOGIN error:", e);
    res.status(500).json({ error: "Eroare login" });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { username, password, companyCode } = req.body;

    if (!username || !password) return res.status(400).json({ error: "Date lipsă" });
    if (!db.hasDb()) return res.status(500).json({ error: "DB neconfigurat" });

    let companyId = null;
    
    // Dacă s-a specificat un cod de companie, caută compania
    if (companyCode) {
      const companyRes = await db.q(
        `SELECT id FROM companies WHERE code = $1`,
        [companyCode.toUpperCase()]
      );
      if (companyRes.rows.length > 0) {
        companyId = companyRes.rows[0].id;
      } else {
        return res.status(400).json({ error: "Cod companie invalid" });
      }
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const r = await db.q(
      `INSERT INTO users (username, password_hash, role, active, is_approved, failed_attempts)
       VALUES ($1,$2,$3,'user',true,false,0)
       RETURNING id, username, role, is_approved, company_id`,
      [username.trim(), passwordHash]
    );

    res.json({ 
      ok: true, 
      message: companyId ? "Cont creat. Așteaptă aprobarea administratorului." : "Cont creat. Alocă-i o companie."
    });
  } catch (e) {
    if (String(e.message || "").includes("duplicate key")) {
      return res.status(400).json({ error: "Utilizator existent" });
    }
    console.error("REGISTER error:", e);
    res.status(500).json({ error: "Eroare register" });
  }
});

// ===== DEMO SIGNUP & EMAIL VERIFICATION =====

// POST /api/demo-signup - Înregistrare utilizator DEMO cu companie separată (DB separat)
app.post("/api/demo-signup", async (req, res) => {
  let newCompanyId = null;
  let userId = null;
  
  try {
    const { username, password, email, firstName, lastName } = req.body;
    
    if (!username || !password || !email) {
      return res.status(400).json({ error: "Username, parolă și email sunt obligatorii" });
    }
    
    if (!db.hasDb()) return res.status(500).json({ error: "DB neconfigurat" });
    
    // Validare email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Email invalid" });
    }
    
    // Verifică dacă email-ul există deja în toate companiile (căutăm în master DB)
    console.log("Checking email:", email.toLowerCase());
    const companiesRes = await db.masterQuery(`SELECT id, subdomain FROM companies WHERE status = 'active'`);
    let emailExists = false;
    for (const company of companiesRes.rows) {
      try {
        db.setCompanyContext(company);
        const emailCheck = await db.q(
          `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [email]
        );
        if (emailCheck.rows.length > 0) {
          emailExists = true;
          break;
        }
      } catch (e) { /* ignoră erori */ }
    }
    db.resetCompanyContext();
    
    if (emailExists) {
      return res.status(409).json({ 
        emailExists: true,
        error: "Email-ul există deja în baza de date",
        message: "Acest email este deja înregistrat. Mergi la pagina de login."
      });
    }
    
    // Găsește compania DEMO (template) - este în master DB
    const demoCompany = await db.masterQuery(
      `SELECT * FROM companies WHERE code = 'DEMO' LIMIT 1`
    );
    
    if (demoCompany.rows.length === 0) {
      return res.status(500).json({ error: "Template-ul demo nu este configurat" });
    }
    
    const demoTemplate = demoCompany.rows[0];
    const passwordHash = bcrypt.hashSync(password, 10);
    
    // Generează cod de verificare (6 cifre)
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minute
    
    // Creează compania cu bază de date SEPARATĂ
    console.log("[DEMO-SIGNUP] Creez companie cu DB separat...");
    const companyResult = await createCompanyWithDatabase({
      name: `Firma ${firstName || username} Demo`,
      code: null, // Se generează automat
      cui: null,
      address: demoTemplate.address,
      phone: demoTemplate.phone,
      email: email.toLowerCase(),
      plan: 'trial',
      planData: { price: demoTemplate.plan_price || 59.99, maxUsers: 10 }
    });
    
    newCompanyId = companyResult.companyId;
    const subdomain = companyResult.subdomain;
    const companyCode = companyResult.code;
    
    console.log("[DEMO-SIGNUP] Companie creată:", companyCode, "Subdomain:", subdomain);
    
    // Setează contextul pentru noua companie și populează cu date
    const companyData = { id: newCompanyId, subdomain };
    db.setCompanyContext(companyData);
    
    try {
      // 1. Creează utilizatorul ca ADMIN în noua companie
      const userResult = await db.q(
        `INSERT INTO users (username, password_hash, email, first_name, last_name, 
                           role, active, is_approved, is_demo_user, demo_company_id, 
                           email_verification_code, email_verification_expires_at, 
                           email_verified, failed_attempts, created_at)
         VALUES ($1, $2, $3, $4, $5, 'admin', false, false, true, $6, $7, $8, false, 0, NOW())
         RETURNING id, username, email, email_verification_code`,
        [username.trim(), passwordHash, email.toLowerCase(), 
         firstName || '', lastName || '', newCompanyId, verificationCode, codeExpiresAt]
      );
      userId = userResult.rows[0].id;
      console.log("[DEMO-SIGNUP] Utilizator creat:", userId);
      
      // 2. Copiază clienții din template (din DB-ul demo)
      // Mai întâi setăm contextul pentru template
      db.setCompanyContext({ id: demoTemplate.id, subdomain: demoTemplate.subdomain || 'demo' });
      const templateClients = await db.q(`SELECT name, cui, group_name, category, prices, payment_terms FROM clients`);
      const templateProducts = await db.q(`SELECT name, gtin, gtins, price, category, stock FROM products WHERE active = true`);
      
      // Revenim la noua companie
      db.setCompanyContext(companyData);
      
      // Inserăm clienții
      for (const clientRow of templateClients.rows) {
        const newId = crypto.randomUUID();
        await db.q(
          `INSERT INTO clients (id, name, cui, group_name, category, prices, payment_terms, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())`,
          [newId, clientRow.name, clientRow.cui, clientRow.group_name, clientRow.category,
           clientRow.prices || '{}', clientRow.payment_terms || 0]
        );
      }
      console.log("[DEMO-SIGNUP] Clienți copiați:", templateClients.rows.length);
      
      // Inserăm produsele
      for (const prodRow of templateProducts.rows) {
        const newId = crypto.randomUUID();
        await db.q(
          `INSERT INTO products (id, name, gtin, gtins, price, category, stock, active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())`,
          [newId, prodRow.name, prodRow.gtin, prodRow.gtins || JSON.stringify([prodRow.gtin]), 
           prodRow.price, prodRow.category, prodRow.stock || 0]
        );
        
        // Adăugăm și stoc dacă există
        if (prodRow.stock > 0) {
          await db.q(
            `INSERT INTO stock (id, gtin, product_name, lot, expires_at, qty, location, warehouse, created_at)
             VALUES ($1, $2, $3, 'DEMO001', '2026-12-31', $4, 'A', 'depozit', NOW())`,
            [crypto.randomUUID(), prodRow.gtin, prodRow.name, prodRow.stock]
          );
        }
      }
      console.log("[DEMO-SIGNUP] Produse copiate:", templateProducts.rows.length);
      
      // 3. Adăugăm vehicule default
      const uniqueId = Date.now().toString(36).toUpperCase();
      const vehicles = [
        { plate: `B-${uniqueId}-01`, active: true },
        { plate: `B-${uniqueId}-02`, active: true },
        { plate: `B-${uniqueId}-03`, active: true }
      ];
      for (const v of vehicles) {
        await db.q(
          `INSERT INTO vehicles (id, plate_number, active, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [crypto.randomUUID(), v.plate, v.active]
        );
      }
      
      // 4. Adăugăm șoferi default
      const drivers = [
        { name: 'Ion Popescu', active: true },
        { name: 'Maria Ionescu', active: true },
        { name: 'Andrei Georgescu', active: true }
      ];
      for (const d of drivers) {
        await db.q(
          `INSERT INTO drivers (id, name, active, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [crypto.randomUUID(), d.name, d.active]
        );
      }
      
      db.resetCompanyContext();
      console.log("[DEMO-SIGNUP] Date populate cu succes!");
      
    } catch (popError) {
      db.resetCompanyContext();
      console.error("[DEMO-SIGNUP] Eroare populare date:", popError.message);
      // Continuăm - compania și DB-ul există, chiar dacă popularea a eșuat
    }
    
    // LOG IMPORTANT: Afișează codul în consolă pentru debugging
    console.log('\n' + '='.repeat(60));
    console.log('📧 EMAIL VERIFICATION CODE (DEBUG)');
    console.log('='.repeat(60));
    console.log('Email:', email);
    console.log('Cod verificare:', verificationCode);
    console.log('Subdomain:', companyResult.subdomain);
    console.log('URL:', `http://${companyResult.subdomain}.localhost:3000`);
    console.log('='.repeat(60) + '\n');
    
    // Trimite email cu codul de verificare
    await emailService.sendMail({
      to: email,
      subject: 'Cod de verificare - OpenBill Demo',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1>🎉 Bun venit în OpenBill!</h1>
            <p>Confirmă adresa ta de email</p>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Salut <strong>${firstName || username}</strong>,</p>
            <p>Compania ta demo a fost creată cu succes!</p>
            <p><strong>Datele tale de acces:</strong></p>
            <ul>
              <li>🔗 <strong>URL unic:</strong> http://${companyResult.subdomain}.localhost:3000</li>
              <li>👤 <strong>Username:</strong> ${username}</li>
              <li>🔑 <strong>Parolă:</strong> (cea aleasă de tine)</li>
            </ul>
            <p><strong>Beneficii incluse:</strong></p>
            <ul>
              <li>✅ Bază de date separată și securizată</li>
              <li>✅ Acces complet la toate funcționalitățile (plan Enterprise)</li>
              <li>✅ Date demo pre-populate (produse, clienți, stoc)</li>
              <li>✅ Rol de Administrator - poți invita alți utilizatori</li>
              <li>✅ Valabil 14 zile</li>
            </ul>
            <p>Introdu codul de mai jos pentru a-ți activa contul:</p>
            <center>
              <div style="background: white; border: 2px dashed #667eea; padding: 20px; margin: 20px 0; border-radius: 10px; display: inline-block;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${verificationCode}</span>
              </div>
            </center>
            <p style="color: #666; font-size: 14px;">Codul este valabil 30 de minute.</p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            <p style="color: #666; font-size: 12px;">Echipa OpenBill</p>
          </div>
        </div>
      `,
      text: `Bun venit in OpenBill!\n\nURL-ul tau unic: http://${companyResult.subdomain}.localhost:3000\n\nCodul tau de verificare este: ${verificationCode}\n\nAcest cod este valabil 30 de minute.`
    });
    
    res.json({
      success: true,
      message: "Companie creată! Introdu codul primit pe email.",
      userId: userId,
      companyCode: companyResult.code,
      subdomain: companyResult.subdomain,
      url: `http://${companyResult.subdomain}.localhost:3000`,
      requiresVerification: true
    });
    
  } catch (e) {
    // Tranzacția s-a făcut rollback automat de withTransaction
    console.error("DEMO SIGNUP FULL ERROR:", e);
    console.error("Error message:", e.message);
    console.error("Error code:", e.code);
    console.error("Error detail:", e.detail);
    console.error("Error table:", e.table);
    console.error("Error constraint:", e.constraint);
    
    if (String(e.message || "").includes("duplicate key") || String(e.code || "") === "23505") {
      return res.status(400).json({ 
        error: "Duplicate key violation", 
        details: e.message,
        constraint: e.constraint,
        table: e.table
      });
    }
    
    // Returnează detalii eroare pentru debugging
    res.status(500).json({ 
      error: "Eroare la crearea companiei demo", 
      details: e.message,
      code: e.code,
      constraint: e.constraint,
      table: e.table,
      hint: "Verifică console server pentru detalii"
    });
  }
});

// POST /api/verify-email-code - Verificare email cu cod + auto-login
app.post("/api/verify-email-code", async (req, res) => {
  try {
    const { email, code } = req.body;
    
    console.log("VERIFY CODE:", { email: email?.toLowerCase(), code });
    
    if (!email || !code) {
      return res.status(400).json({ error: "Email și cod obligatorii" });
    }
    
    // Caută user-ul în toate companiile (căutare globală)
    let foundUser = null;
    let foundCompany = null;
    
    const companiesRes = await db.masterQuery(`SELECT id, subdomain FROM companies WHERE status = 'active'`);
    
    for (const company of companiesRes.rows) {
      try {
        db.setCompanyContext(company);
        const result = await db.q(
          `UPDATE users 
           SET email_verified = true, email_verified_at = NOW(), email_verification_code = NULL, 
               email_verification_expires_at = NULL, active = true, is_approved = true
           WHERE LOWER(email) = LOWER($1) AND email_verification_code = $2 
             AND email_verification_expires_at > NOW()
           RETURNING id, username, email, role`,
          [email.toLowerCase(), code]
        );
        
        if (result.rows.length > 0) {
          foundUser = result.rows[0];
          foundUser.company_id = company.id;
          foundCompany = company;
          break;
        }
      } catch (e) { /* ignoră erori */ }
    }
    db.resetCompanyContext();
    
    if (!foundUser) {
      return res.status(400).json({ 
        error: "Cod invalid sau expirat",
        message: "Verifică codul sau solicită unul nou."
      });
    }
    
    const user = foundUser;
    
    // Obține info companie din master DB
    const companyRes = await db.masterQuery(
      `SELECT id, name, code, plan, subdomain FROM companies WHERE id = $1`,
      [user.company_id]
    );
    const companyInfo = companyRes.rows[0] || {};
    
    // Setează sesiunea pentru auto-login
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      is_approved: true,
      company_id: user.company_id
    };
    
    if (companyRes.rows.length > 0) {
      const c = companyRes.rows[0];
      req.session.company = {
        id: c.id,
        name: c.name,
        code: c.code,
        plan: c.plan,
        subdomain: c.subdomain
      };
    }
    
    // Construiește URL-ul de redirect către subdomeniu
    const subdomain = companyInfo.subdomain;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || 'localhost:3000';
    const baseDomain = host.includes('localhost') ? 'localhost:3000' : host.replace(/^[^.]+\./, '');
    const redirectUrl = subdomain ? `${protocol}://${subdomain}.${baseDomain}/index.html` : '/index.html';
    
    res.json({
      success: true,
      message: "Email verificat! Ești autentificat automat.",
      user: req.session.user,
      company: req.session.company || null,
      subdomain: subdomain,
      redirectTo: redirectUrl
    });
    
  } catch (e) {
    console.error("VERIFY CODE error:", e);
    res.status(500).json({ error: "Eroare la verificare" });
  }
});

// POST /api/resend-verification-code - Retrimite codul de verificare
app.post("/api/resend-verification-code", async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: "Email obligatoriu" });
    }
    
    // Generează cod nou
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minute
    
    // Caută user-ul în toate companiile și updatează codul
    let updatedUser = null;
    const companiesRes = await db.masterQuery(`SELECT id, subdomain FROM companies WHERE status = 'active'`);
    
    for (const company of companiesRes.rows) {
      try {
        db.setCompanyContext(company);
        const result = await db.q(
          `UPDATE users 
           SET email_verification_code = $1, email_verification_expires_at = $2
           WHERE LOWER(email) = LOWER($3) AND email_verified = false
           RETURNING id, username, first_name`,
          [verificationCode, expiresAt, email.toLowerCase()]
        );
        
        if (result.rows.length > 0) {
          updatedUser = result.rows[0];
          break;
        }
      } catch (e) { /* ignoră erori */ }
    }
    db.resetCompanyContext();
    
    if (!updatedUser) {
      return res.status(404).json({ error: "Utilizator negăsit sau deja verificat" });
    }
    
    const user = updatedUser;
    
    // LOG pentru debugging
    console.log('\n' + '='.repeat(60));
    console.log('📧 EMAIL RESEND CODE (DEBUG)');
    console.log('='.repeat(60));
    console.log('Email:', email);
    console.log('Cod verificare NOU:', verificationCode);
    console.log('='.repeat(60) + '\n');
    
    // Trimite email
    await emailService.sendMail({
      to: email,
      subject: 'Cod de verificare nou - OpenBill Demo',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1>🔑 Cod de Verificare Nou</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Salut <strong>${user.first_name || user.username}</strong>,</p>
            <p>Ai solicitat un cod de verificare nou.</p>
            <p>Introdu codul de mai jos:</p>
            <center>
              <div style="background: white; border: 2px dashed #667eea; padding: 20px; margin: 20px 0; border-radius: 10px; display: inline-block;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${verificationCode}</span>
              </div>
            </center>
            <p style="color: #666; font-size: 14px;">Codul este valabil 30 de minute.</p>
          </div>
        </div>
      `,
      text: `Codul tau de verificare nou este: ${verificationCode}`
    });
    
    res.json({ success: true, message: "Cod retrimis! Verifică emailul." });
    
  } catch (e) {
    console.error("RESEND CODE error:", e);
    res.status(500).json({ error: "Eroare la retrimitere" });
  }
});

// GET /api/verify-email - Verificare email (legacy cu token)
app.get("/api/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: "Token lipsă" });
    }
    
    const result = await db.q(
      `UPDATE users 
       SET email_verified = true, email_verified_at = NOW(), email_verification_token = NULL
       WHERE email_verification_token = $1 AND email_verified = false
       RETURNING id, username, email`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Token invalid sau email deja verificat" });
    }
    
    res.json({
      success: true,
      message: "Email confirmat cu succes!",
      user: result.rows[0]
    });
    
  } catch (e) {
    console.error("VERIFY EMAIL error:", e);
    res.status(500).json({ error: "Eroare la verificarea emailului" });
  }
});

// POST /api/companies/register - Înregistrare companie din contul DEMO
app.post("/api/companies/register", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { companyName, cui, address, phone, plan } = req.body;
    
    if (!companyName || !cui || !address || !phone || !plan) {
      return res.status(400).json({ error: "Toate câmpurile sunt obligatorii" });
    }
    
    if (!['starter', 'pro', 'enterprise'].includes(plan)) {
      return res.status(400).json({ error: "Plan invalid" });
    }
    
    // Generează cod unic pentru companie
    const companyCode = 'COMP' + Date.now().toString(36).toUpperCase();
    const companyId = crypto.randomUUID();
    
    // Creează compania cu status 'pending'
    await db.q(
      `INSERT INTO companies (id, code, name, cui, address, phone, plan, plan_price, 
                            subscription_status, status, max_users, settings, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'pending', $9, $10, NOW())`,
      [
        companyId,
        companyCode,
        companyName,
        cui,
        address,
        phone,
        plan,
        plan === 'starter' ? 29.99 : plan === 'pro' ? 39.99 : 59.99,
        plan === 'starter' ? 3 : plan === 'pro' ? 10 : 999,
        JSON.stringify({ registration_pending: true, registered_by: userId })
      ]
    );
    
    // Actualizează utilizatorul
    await db.q(
      `UPDATE users 
       SET is_demo_user = false
       WHERE id = $2`,
      [userId]
    );
    
    // Trimite notificare admin
    const userRes = await db.q(`SELECT email, username FROM users WHERE id = $1`, [userId]);
    const user = userRes.rows[0];
    
    await emailService.sendMail({
      to: process.env.ADMIN_EMAIL || 'billing@openbill.ro',
      subject: '🆕 Nouă înregistrare companie - Așteaptă aprobare',
      html: `
        <h2>🆕 Nouă solicitare de înregistrare</h2>
        <p><strong>Utilizator:</strong> ${user.username} (${user.email})</p>
        <p><strong>Companie:</strong> ${companyName}</p>
        <p><strong>CUI:</strong> ${cui}</p>
        <p><strong>Adresă:</strong> ${address}</p>
        <p><strong>Telefon:</strong> ${phone}</p>
        <p><strong>Plan:</strong> ${plan.toUpperCase()}</p>
        <p><strong>Cod companie:</strong> ${companyCode}</p>
        <hr>
        <p>Accesează panoul de administrare pentru a aproba/respinge solicitarea.</p>
      `
    });
    
    res.json({
      success: true,
      message: "Solicitarea a fost trimisă! Vei primi un email când contul este activat.",
      companyCode: companyCode
    });
    
  } catch (e) {
    console.error("REGISTER COMPANY error:", e);
    res.status(500).json({ error: "Eroare la înregistrarea companiei" });
  }
});

// Nou endpoint - înregistrare companie reală cu ACTIVARE IMEDIATĂ
app.post("/api/register-real-company", requireAuth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { 
      email, firstName, lastName, phone,
      companyName, cui, address, registrationNumber,
      bankIban, bankName, plan 
    } = req.body;
    
    const userId = req.session.user.id;
    const demoCompanyId = req.session.user.company_id;
    
    // Validări
    if (!email || !firstName || !lastName || !phone) {
      return res.status(400).json({ error: "Toate datele personale sunt obligatorii" });
    }
    if (!companyName || !cui || !address) {
      return res.status(400).json({ error: "Toate datele companiei sunt obligatorii" });
    }
    if (!plan || !['starter', 'pro', 'enterprise'].includes(plan)) {
      return res.status(400).json({ error: "Selectează un plan valid" });
    }
    
    // Verifică dacă CUI există deja
    const existingCui = await db.q(
      `SELECT id FROM companies WHERE cui = $1`,
      [cui]
    );
    if (existingCui.rows.length > 0) {
      return res.status(400).json({ error: "Acest CUI este deja înregistrat în sistem" });
    }
    
    await client.query('BEGIN');
    
    // Generează cod unic pentru companie
    const companyCode = 'COMP-' + Date.now().toString(36).toUpperCase();
    const companyId = crypto.randomUUID();
    
    const planPrice = plan === 'starter' ? 29.99 : plan === 'pro' ? 39.99 : 59.99;
    const maxUsers = plan === 'starter' ? 3 : plan === 'pro' ? 10 : 999;
    
    // 1. Creează compania nouă cu status ACTIVE (nu pending)
    await client.query(
      `INSERT INTO companies (
        id, code, name, cui, address, phone, plan, 
        plan_price, max_users, status,
        registration_number, bank_iban, bank_name,
        settings
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        companyId, companyCode, companyName, cui, address, phone, plan,
        planPrice, maxUsers, 'active', // ACTIVE de la început!
        registrationNumber || null,
        bankIban || null,
        bankName || null,
        JSON.stringify({ 
          registered_by: userId,
          source: 'user_registration',
          registration_date: new Date().toISOString()
        })
      ]
    );
    
    // 2. ȘTERGE toate datele DEMO pentru această companie
    console.log(`[REGISTER] Șterg datele demo pentru compania ${demoCompanyId}...`);
    await client.query(`DELETE FROM order_items`);
    await client.query(`DELETE FROM orders`);
    await client.query(`DELETE FROM stock`);
    await client.query(`DELETE FROM vehicles`);
    await client.query(`DELETE FROM drivers`);
    await client.query(`DELETE FROM client_prices`);
    await client.query(`DELETE FROM clients`);
    await client.query(`DELETE FROM products`);
    await client.query(`DELETE FROM client_categories`);
    await client.query(`DELETE FROM company_categories`);
    console.log(`[REGISTER] Datele demo au fost șterse`);
    
    // 3. ȘTERGE compania DEMO
    await client.query(`DELETE FROM companies WHERE id = $1`, [demoCompanyId]);
    console.log(`[REGISTER] Compania demo ${demoCompanyId} a fost ștearsă`);
    
    // 4. Creează company_settings pentru noua companie (goală - fără date predefinite)
    await client.query(
      `INSERT INTO company_settings (
        company_id, name, cui, address, phone, email,
        registration_number, bank_name, bank_iban, 
        smartbill_series, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        companyId, companyName, cui, address, phone, email.toLowerCase().trim(),
        registrationNumber || null, bankName || null, bankIban || null,
        '' // Serie goală - userul o setează manual
      ]
    );
    
    // 5. Actualizează utilizatorul - devine ADMIN la noua companie
    await client.query(
      `UPDATE users 
       SET 
         email = $1,
         first_name = $2,
         last_name = $3,
         phone = $4,
         -- company_id removed
         pending_company_id = NULL,
         is_demo_user = false,
         role = 'admin',
         updated_at = NOW()
       WHERE id = $6`,
      [email.toLowerCase().trim(), firstName.trim(), lastName.trim(), phone.trim(), companyId, userId]
    );
    
    await client.query('COMMIT');
    
    // 6. Actualizează sesiunea
    req.session.user.company_id = companyId;
    req.session.user.is_demo_user = false;
    req.session.user.pending_company_id = null;
    req.session.user.role = 'admin';
    
    // 7. Trimite notificare admin (fără aprobare necesară)
    await emailService.sendMail({
      to: process.env.ADMIN_EMAIL || 'billing@openbill.ro',
      subject: '🆕 Nouă companie activată',
      html: `
        <h2>🆕 Nouă companie s-a activat automat</h2>
        <p><strong>Utilizator:</strong> ${firstName} ${lastName} (${email})</p>
        <p><strong>Telefon:</strong> ${phone}</p>
        <p><strong>Companie:</strong> ${companyName}</p>
        <p><strong>CUI:</strong> ${cui}</p>
        <p><strong>Plan:</strong> ${plan.toUpperCase()}</p>
        <p><strong>Cod companie:</strong> ${companyCode}</p>
        <hr>
        <p>⚠️ <strong>Acțiune necesară:</strong> Trimite factura manual pentru plată.</p>
      `
    });
    
    res.json({
      success: true,
      activated: true,
      message: "Compania a fost activată cu succes!",
      paymentMessage: "Vei primi factura pe email pentru planul selectat. Plata se face prin Ordin de Plată.",
      companyCode: companyCode,
      company: {
        id: companyId,
        name: companyName,
        code: companyCode,
        plan: plan
      }
    });
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("REGISTER REAL COMPANY error:", e);
    res.status(500).json({ error: "Eroare la înregistrarea companiei: " + e.message });
  } finally {
    client.release();
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ----- API PRODUCTS & CLIENTS -----
app.post("/api/products", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const { name, gtin, category, price, gtins } = req.body;

    if (!name) return res.status(400).json({ error: "Lipsește numele" });
    if (!db.hasDb()) return res.status(500).json({ error: "DB neconfigurat" });

    const id = crypto.randomUUID();
    const gtinClean = normalizeGTIN(gtin || "") || null;
    const gtinsArr = []
      .concat(gtinClean ? [gtinClean] : [])
      .concat(Array.isArray(gtins) ? gtins : [])
      .map(normalizeGTIN)
      .filter(Boolean);

    const cat = String(category || "Altele").trim() || "Altele";
    const pr = (price != null && price !== "") ? Number(price) : null;
    const primaryGtin = gtinClean || (gtinsArr[0] || null);

    const r = await db.q(
      `INSERT INTO products (id, name, gtin, gtins, category, price, active)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,true)
       RETURNING id`,
      [id, companyId, String(name).trim(), primaryGtin, JSON.stringify(gtinsArr), cat, (Number.isFinite(pr) ? pr : null)]
    );

    await logAudit(req, "PRODUCT_ADD", "product", r.rows[0].id, {
      name: String(name).trim(),
      gtin: primaryGtin,
      category: cat,
      price: pr
    });

    return res.json({ ok: true, id: r.rows[0].id });

  } catch (e) {
    if (String(e.code) === "23505") {
      return res.status(400).json({ error: "GTIN existent deja în această companie" });
    }
    console.error("POST /api/products error:", e);
    return res.status(500).json({ error: e.message || "Eroare DB product add" });
  }
});

app.post("/api/clients", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const name = String(req.body.name || "").trim();
    const group = String(req.body.group || "").trim();
    const category = String(req.body.category || "").trim();
    const cui = String(req.body.cui || "").trim().toUpperCase();
    const prices = (req.body.prices && typeof req.body.prices === "object") ? req.body.prices : {};

    if (!name) return res.status(400).json({ error: "Lipsește numele clientului" });

    const id = Date.now().toString();
    await db.q(
      `INSERT INTO clients (id, name, group_name, category, cui, prices)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [id, companyId, name, group, category, cui || null, JSON.stringify(prices)]
    );

    return res.json({ ok: true, id, cui });

  } catch (e) {
    console.error("POST /api/clients error:", e);
    res.status(500).json({ error: "Eroare la salvarea clientului" });
  }
});

// ----- ADMIN ENDPOINTS -----
app.get("/api/users/pending", isAdmin, async (req, res) => {
  try {
    const r = await db.q(
      `SELECT u.id, u.username, u.created_at, u.failed_attempts, u.company_id,
              c.name as company_name, c.code as company_code
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE u.is_approved = false AND u.role = 'user'
       ORDER BY u.created_at DESC`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/users/approve/:id", isAdmin, async (req, res) => {
  try {
    const { company_id } = req.body;
    
    await db.q(
      `UPDATE users 
       SET is_approved = true, failed_attempts = 0, company_id = COALESCE($1, company_id)
       WHERE id = $2 AND role = 'user'`,
      [company_id, req.params.id]
    );
    res.json({ ok: true, message: "Utilizator aprobat" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/users", isAdmin, async (req, res) => {
  try {
    const r = await db.q(
      `SELECT u.id, u.username, u.role, u.is_approved, u.active, u.created_at,
              u.company_id, c.name as company_name, c.code as company_code
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       ORDER BY u.created_at DESC`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- INITIALIZATION -----
const PORT = process.env.PORT || 3000;

async function ensureDefaultCompany() {
  // Nu mai creăm companie demo - fiecare utilizator își creează propria companie
  console.log("ℹ️ ensureDefaultCompany: Nu se creează companie demo (trial 14 zile la înregistrare)");
  return null;
}

async function ensureDefaultAdmin() {
  // În noua arhitectură, users sunt în DB-uri separate per companie
  // Nu mai creăm admin global - fiecare companie își creează adminii proprii
  console.log("ℹ️ ensureDefaultAdmin: Skipped (users sunt în DB-uri per companie)");
  return;
}

async function seedInitialData(companyId) {
  if (!db.hasDb() || !companyId) return;

  try {
    // ȘOFERI
    const soferi = ["Calinescu Andrei-Alexandru", "Paun Rares-Alexandru", "Cristiana Paun"];
    for (const nume of soferi) {
      const check = await db.q(
        `SELECT id FROM drivers WHERE name = $2`,
        [nume]
      );
      
      if (check.rows.length === 0) {
        const id = crypto.randomUUID();
        await db.q(
          `INSERT INTO drivers (id, name, active) VALUES ($1, $3, true)`,
          [id, companyId, nume]
        );
      }
    }

    // MAȘINI
    const masini = ["DJ05OB", "DJ50OB"];
    for (const numar of masini) {
      const check = await db.q(
        `SELECT id FROM vehicles WHERE plate_number = $2`,
        [numar]
      );
      
      if (check.rows.length === 0) {
        const id = crypto.randomUUID();
        await db.q(
          `INSERT INTO vehicles (id, plate_number, active) VALUES ($1, $3, true)`,
          [id, companyId, numar]
        );
      }
    }
    
    console.log(`✅ Date inițiale verificate pentru compania ${companyId}`);
  } catch (e) {
    console.error("❌ Eroare la datele inițiale:", e.message);
  }
}

// ----- START SERVER -----
(async () => {
  try {
    // 1. MAI ÎNTÂI inițializăm Master DB (companies table)
    console.log("🚀 PAS 1: Inițializăm Master DB...");
    await db.initMasterDatabase();
    console.log("✅ Master DB gata");
    
    // 2. Apoi restul inițializărilor
    await db.ensureTables();
    console.log("✅ DB ready (multi-tenant)");
    
    const companyId = await ensureDefaultCompany();
    await ensureDefaultAdmin();
    
    // Seeding temporar dezactivat - se face manual per companie
    // if (companyId) {
    //   await seedClientsFromFileIfEmpty(companyId);
    //   await seedProductsFromFileIfEmpty(companyId);
    //   await seedInitialData(companyId);
    // }
  } catch (e) {
    console.error("❌ DB init error:", e?.message || e);
  }

  // Verificăm serviciul de email
  await emailService.verifyConnection();
  
  // Inițializăm tabelul pentru categorii per companie
  await initCompanyCategoriesTable();

  app.listen(PORT, () => console.log("Server pornit pe port", PORT));
})();

// PARTEA 3 - API Drivers, Vehicles, Trip Sheets, etc.

// ----- API DRIVERS -----
app.get("/api/drivers", requireAuth, requireCompany, requireSubscription, requireFeature('foi_parcurs'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const r = await db.q(
      `SELECT id, name, active FROM drivers WHERE active=true ORDER BY name`,
      []
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/drivers", requireAuth, requireCompany, isAdmin, requireFeature('foi_parcurs'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const { name } = req.body;
    const id = crypto.randomUUID();
    await db.q(
      `INSERT INTO drivers (id, name) VALUES ($1,$3)`,
      [id, companyId, name]
    );
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- API VEHICLES -----
app.get("/api/vehicles", requireAuth, requireCompany, requireSubscription, requireFeature('foi_parcurs'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const r = await db.q(
      `SELECT id, plate_number, active FROM vehicles WHERE active=true ORDER BY plate_number`,
      []
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/vehicles", requireAuth, requireCompany, isAdmin, requireFeature('foi_parcurs'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const { plate_number } = req.body;
    const id = crypto.randomUUID();
    await db.q(
      `INSERT INTO vehicles (id, plate_number) VALUES ($1,$3)`,
      [id, companyId, plate_number.toUpperCase()]
    );
    res.json({ ok: true, id });
  } catch (e) {
    if (e.message.includes("unique")) return res.status(400).json({ error: "Numărul există deja" });
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/vehicles/:id/last-km", requireAuth, requireCompany, requireFeature('foi_parcurs'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const vehicleId = req.params.id;
    
    const r = await db.q(
      `SELECT km_end 
       FROM trip_sheets 
       WHERE 1=1 AND vehicle_id = $2 AND km_end IS NOT NULL
       ORDER BY date DESC, created_at DESC 
       LIMIT 1`,
      [vehicleId]
    );
    
    if (r.rows.length > 0 && r.rows[0].km_end) {
      res.json({ lastKm: parseInt(r.rows[0].km_end) });
    } else {
      res.json({ lastKm: 0 });
    }
  } catch (e) {
    console.error("Eroare la obținerea ultimului KM:", e);
    res.status(500).json({ error: e.message });
  }
});

// ----- API TRIP SHEETS -----
app.get("/api/trip-sheets", requireAuth, requireCompany, requireSubscription, requireFeature('foi_parcurs'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const r = await db.q(
      `SELECT 
        t.id, t.date, t.km_start, t.km_end, t.locations, 
        t.trip_number, t.departure_time, t.arrival_time, 
        t.purpose, t.tech_check_departure, t.tech_check_arrival,
        t.created_at,
        d.name as driver_name,
        v.plate_number
      FROM trip_sheets t
      JOIN drivers d ON t.driver_id = d.id
      JOIN vehicles v ON t.vehicle_id = v.id
      ORDER BY t.date DESC`,
      []
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/trip-sheets", requireAuth, requireCompany, requireSubscription, requireFeature('foi_parcurs'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const { 
      date, driver_id, vehicle_id, km_start, locations,
      trip_number, departure_time, arrival_time, purpose,
      tech_check_departure, tech_check_arrival 
    } = req.body;
    
    // Validare KM
    const lastKmCheck = await db.q(
      `SELECT km_end FROM trip_sheets 
       WHERE 1=1 AND vehicle_id = $2 AND km_end IS NOT NULL
       ORDER BY date DESC, created_at DESC 
       LIMIT 1`,
      [vehicle_id]
    );
    
    if (lastKmCheck.rows.length > 0) {
      const lastKm = parseInt(lastKmCheck.rows[0].km_end);
      if (km_start < lastKm) {
        return res.status(400).json({ 
          error: `KM Plecare (${km_start}) nu poate fi mai mic decât ultimul KM înregistrat (${lastKm})` 
        });
      }
    }
    
    const id = crypto.randomUUID();
    
    await db.q(
      `INSERT INTO trip_sheets (
        id, company_id, date, driver_id, vehicle_id, km_start, locations,
        trip_number, departure_time, arrival_time, purpose,
        tech_check_departure, tech_check_arrival, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id, companyId, date, driver_id, vehicle_id, km_start, locations || '',
        trip_number, departure_time, arrival_time, purpose,
        tech_check_departure || false, tech_check_arrival || false,
        req.session.user.username
      ]
    );
    
    res.json({ ok: true, id, trip_number });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/trip-sheets/:id", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const { km_end, locations } = req.body;
    
    const r = await db.q(
      `UPDATE trip_sheets 
       SET km_end = $1, locations = $2
       WHERE id = $3
       RETURNING km_start, km_end`,
      [km_end, locations, req.params.id, companyId]
    );
    
    if (r.rows.length === 0) return res.status(404).json({ error: "Not found" });
    
    const km_total = r.rows[0].km_end - r.rows[0].km_start;
    res.json({ ok: true, km_total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/trip-sheets/:id", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    await db.q(
      `DELETE FROM trip_sheets WHERE id = $1`,
      [req.params.id, companyId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- API FUEL RECEIPTS -----
app.get("/api/trip-sheets/:id/fuel-receipts", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    
    // Verificăm că trip_sheet aparține companiei
    const tripCheck = await db.q(
      `SELECT 1 FROM trip_sheets WHERE id = $1`,
      [req.params.id, companyId]
    );
    
    if (tripCheck.rows.length === 0) {
      return res.status(404).json({ error: "Foaie de parcurs inexistentă" });
    }
    
    const r = await db.q(
      `SELECT id, type, receipt_number, liters, km_at_refuel 
       FROM fuel_receipts 
       WHERE 1=1 AND trip_sheet_id = $2 
       ORDER BY km_at_refuel`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/trip-sheets/:id/fuel-receipts", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const { type, receipt_number, liters, km_at_refuel } = req.body;
    
    // Verificăm că trip_sheet aparține companiei
    const tripCheck = await db.q(
      `SELECT 1 FROM trip_sheets WHERE id = $1`,
      [req.params.id, companyId]
    );
    
    if (tripCheck.rows.length === 0) {
      return res.status(404).json({ error: "Foaie de parcurs inexistentă" });
    }
    
    const id = crypto.randomUUID();
    
    await db.q(
      `INSERT INTO fuel_receipts (id, trip_sheet_id, type, receipt_number, liters, km_at_refuel)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, companyId, req.params.id, type, receipt_number, liters, km_at_refuel]
    );
    
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/fuel-receipts/:id", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    await db.q(
      `DELETE FROM fuel_receipts WHERE id = $1`,
      [req.params.id, companyId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- API CLIENT BALANCES -----
app.post("/api/balances/upload", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const { invoices } = req.body;
    
    if (!invoices || !Array.isArray(invoices)) {
      return res.status(400).json({ error: "Date invalide. Trimite array de facturi." });
    }
    
    // ȘTERGE TOATE datele vechi pentru această companie
    await db.q(`DELETE FROM client_balances`);
    
    // Găsim clienții după CUI pentru matching (doar din compania curentă)
    const clientsRes = await db.q(
      `SELECT id, cui FROM clients WHERE cui IS NOT NULL`,
      []
    );
    
    const clientsByCui = {};
    clientsRes.rows.forEach(c => {
      const cuiCurat = String(c.cui).replace(/^RO/i, '').replace(/\s/g, '').trim();
      clientsByCui[cuiCurat] = c.id;
    });
    
    let inserted = 0;
    for (const inv of invoices) {
      const cuiCurat = String(inv.cui || '').replace(/^RO/i, '').replace(/\s/g, '').trim();
      const clientId = clientsByCui[cuiCurat] || null;
      
      const check = await db.q(
        `SELECT 1 FROM client_balances WHERE client_id = $2 AND invoice_number = $3 LIMIT 1`,
        [clientId, inv.invoice_number]
      );
      
      if (check.rows.length === 0) {
        await db.q(
          `INSERT INTO client_balances 
           (company_id, client_id, cui, invoice_number, invoice_date, due_date, currency, total_value, balance_due, days_overdue, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            companyId, clientId, inv.cui, inv.invoice_number, inv.invoice_date, inv.due_date,
            inv.currency, inv.total_value, inv.balance_due, inv.days_overdue, inv.status
          ]
        );
        inserted++;
      }
    }
    
    res.json({ success: true, inserted, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error("Upload balances error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/clients/:id/balances", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const clientId = String(req.params.id);
    
    // Verificăm că clientul aparține companiei
    const clientCheck = await db.q(
      `SELECT 1 FROM clients WHERE id = $1`,
      [clientId, companyId]
    );
    
    if (clientCheck.rows.length === 0) {
      return res.status(404).json({ error: "Client inexistent" });
    }
    
    const result = await db.q(
      `SELECT * FROM client_balances 
       WHERE 1=1 AND client_id = $2 
       ORDER BY due_date ASC`,
      [clientId]
    );
    
    const lastUploadRes = await db.q(
      `SELECT MAX(uploaded_at) as last_upload 
       FROM client_balances`,
      []
    );
    
    const lastUpload = lastUploadRes.rows[0]?.last_upload || new Date().toISOString();
    
    if (result.rows.length === 0) {
      return res.json({ 
        expired: false, 
        lastUpload: lastUpload,
        invoices: [], 
        totalBalance: 0,
        message: "Nu sunt facturi scadente pentru acest client" 
      });
    }
    
    const total = result.rows.reduce((sum, r) => sum + parseFloat(r.balance_due || 0), 0);
    
    res.json({
      expired: false,
      lastUpload: lastUpload,
      invoices: result.rows,
      totalBalance: total,
      count: result.rows.length
    });
  } catch (e) {
    console.error("Get balances error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ----- API PRICES -----
app.post("/api/clients/:id/prices-special", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;
    const { product_id, special_price } = req.body;
    
    // Verificăm că clientul aparține companiei
    const clientCheck = await db.q(
      `SELECT prices FROM clients WHERE id = $1`,
      [id, companyId]
    );
    
    if (!clientCheck.rows.length) return res.status(404).json({ error: "Client negăsit" });
    
    const prices = clientCheck.rows[0].prices || {};
    prices[String(product_id)] = Number(special_price);
    
    await db.q(
      `UPDATE clients SET prices = $1::jsonb WHERE id = $2`,
      [JSON.stringify(prices), id]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error("Eroare adăugare preț:", err);
    res.status(500).json({ error: "Eroare server" });
  }
});

app.get("/api/products/search", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const { q } = req.query;
    
    if (!q || q.length < 2) return res.json([]);
    
    const r = await db.q(
      `SELECT id, name, gtin, price 
       FROM products 
       WHERE 1=1 AND (name ILIKE $2 OR gtin ILIKE $2) AND active = true
       LIMIT 10`,
      [`%${q}%`]
    );
    
    res.json(r.rows);
  } catch (err) {
    console.error("Eroare căutare:", err);
    res.status(500).json({ error: "Eroare server" });
  }
});

// ----- API SUBSCRIPTION -----
app.get("/api/subscription-status", requireAuth, async (req, res) => {
  try {
    // Use company from subdomain middleware
    if (!req.company) {
      return res.status(404).json({ error: "Companie necunoscută" });
    }
    
    // Query master DB for company subscription info
    const result = await db.masterQuery(
      `SELECT plan, subscription_status, subscription_expires_at, max_users
       FROM companies WHERE id = $1`,
      [req.company.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Companie negăsită" });
    }
    
    const company = result.rows[0];
    const now = new Date();
    const expiresAt = company.subscription_expires_at;
    const hasSubscription = company.subscription_status === 'active' && 
                           expiresAt && new Date(expiresAt) > now;
    
    res.json({
      authenticated: true,
      plan: company.plan || 'starter',
      status: company.subscription_status || 'inactive',
      hasSubscription: hasSubscription,
      currentPeriodEnd: expiresAt,
      userLimit: company.max_users || 3
    });
  } catch (err) {
    console.error("Eroare subscription-status:", err);
    res.status(500).json({ error: "Eroare server" });
  }
});

// ----- TEST ENDPOINT -----
app.get("/api/test", (req, res) => {
  res.json({ 
    ok: true, 
    message: "Server funcționează!",
    multiTenant: true,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/debug-db", async (req, res) => {
  try {
    if (!db.hasDb()) return res.json({ hasDb: false });

    const r = await db.q("select current_database() as db, inet_server_addr() as host");
    const c1 = await db.q("select count(*)::int as n from companies");
    const c2 = await db.q("select count(*)::int as n from users");
    const c3 = await db.q("select count(*)::int as n from orders");
    const c4 = await db.q("select count(*)::int as n from stock");

    res.json({
      hasDb: true,
      db: r.rows[0],
      companiesCount: c1.rows[0].n,
      usersCount: c2.rows[0].n,
      ordersCount: c3.rows[0].n,
      stockCount: c4.rows[0].n
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PARTEA 4 - API Public pentru Signup și Onboarding

// ===== PUBLIC API (fără autentificare) =====

// POST /api/public-signup - Înregistrare client nou
app.post("/api/public-signup", async (req, res) => {
  try {
    const { companyName, cui, email, phone, username, password, plan } = req.body;

    // Validare
    if (!companyName || !username || !password) {
      return res.status(400).json({ error: "Numele firmei, username-ul și parola sunt obligatorii" });
    }

    // Validare parolă nouă (8 caractere, 1 majusculă, 1 număr)
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ 
        error: `Parola trebuie să conțină: ${passwordValidation.errors.join(', ')}` 
      });
    }

    if (!PLANS[plan]) {
      return res.status(400).json({ error: "Plan invalid" });
    }

    // Generare cod unic pentru companie
    let companyCode = generateCompanyCode(companyName);

    // Verificăm dacă există deja
    const existingCompany = await db.q(
      `SELECT 1 FROM companies WHERE code = $1`,
      [companyCode]
    );

    if (existingCompany.rows.length > 0) {
      // Adăugăm sufix numeric dacă există
      const suffix = Math.floor(Math.random() * 1000);
      companyCode = companyCode + suffix;
    }

    const existingUser = await db.q(
      `SELECT 1 FROM users WHERE username = $1`,
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Username deja existent. Alege alt username." });
    }

    // Calculăm perioada TRIAL (14 zile)
    const trialExpires = new Date();
    trialExpires.setDate(trialExpires.getDate() + 14);

    const planData = PLANS[plan];
    const companyId = crypto.randomUUID();

    // Începem tranzacția
    await db.q("BEGIN");

    try {
      // 1. Creăm compania
      await db.q(
        `INSERT INTO companies (id, code, name, cui, email, phone, plan, plan_price, max_users, subscription_status, subscription_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'trial', $10)`,
        [
          companyId,
          companyCode,
          companyName,
          cui || null,
          email || null,
          phone || null,
          plan,
          planData.price,
          planData.maxUsers,
          trialExpires
        ]
      );

      // 2. Creăm company_settings
      await db.q(
        `INSERT INTO company_settings (name, cui, address, smartbill_series)
         VALUES ($1, $2, $3, '', 'OB')`,
        [companyName, cui || '']
      );

      // 3. Creăm utilizatorul admin
      const passwordHash = await bcrypt.hash(password, 10);
      const userResult = await db.q(
        `INSERT INTO users (username, password_hash, role, active, is_approved, failed_attempts)
         VALUES ($1, $2, $3, 'admin', true, true, 0)
         RETURNING id`,
        [username, passwordHash]
      );

      // 4. Creăm factura proforma pentru după perioada de probă
      await db.q(
        `INSERT INTO subscription_invoices (user_id, plan, amount, status, payment_method)
         VALUES ($1, $2, $3, $4, 'pending', 'op')`,
        [userResult.rows[0].id, plan, planData.price * 100]
      );

      await db.q("COMMIT");

      // Seed date DEMO pentru testare (async, nu blocăm răspunsul)
      seedDemoData(companyId).catch(err => console.error('Eroare seeding date demo:', err));

      // Log pentru audit
      await db.auditLog({
        action: 'COMPANY_REGISTERED',
        entity: 'company',
        entity_id: companyId,
        user: { username },
        details: { companyName, plan, trialExpires, demo: true },
        company_id: companyId
      });

      console.log(`✅ Companie nouă înregistrată: ${companyName} (${companyCode}) - Plan: ${plan} - TRIAL 14 zile`);

      // Trimitem email de bun venit (async, nu blocăm răspunsul)
      if (email) {
        emailService.sendWelcomeEmail({
          to: email,
          companyName,
          username,
          password, // ⚠️ În producție, poate vrei să nu trimiți parola în clar
          plan,
          companyCode,
          trialDays: 14
        }).catch(err => console.error('Eroare trimitere email:', err));
      }

      // Returnăm succes
      res.json({
        success: true,
        message: "Cont creat cu succes",
        company: {
          id: companyId,
          code: companyCode,
          name: companyName
        },
        demo: {
          days: 7,
          expiresAt: trialExpires,
          message: "Lucrezi cu date DEMO. Poti testa toate functionalitatile cu datele de test. Dupa 14 zile, datele vor fi sterse daca nu activezi un abonament."
        }
      });

    } catch (err) {
      await db.q("ROLLBACK");
      throw err;
    }

  } catch (error) {
    console.error("Eroare la signup:", error);
    res.status(500).json({ error: error.message || "Eroare la crearea contului" });
  }
});

// GET /api/public-plans - Obține planurile disponibile
app.get("/api/public-plans", (req, res) => {
  res.json({
    plans: PLANS
  });
});

// POST /api/public-check-username - Verifică dacă username e disponibil
app.post("/api/public-check-username", async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.json({ available: false });
    }

    const result = await db.q(
      `SELECT 1 FROM users WHERE username = $1`,
      [username]
    );

    res.json({ available: result.rows.length === 0 });
  } catch (error) {
    res.status(500).json({ error: "Eroare server" });
  }
});

// Funcție helper pentru generare cod companie
function generateCompanyCode(companyName) {
  // Eliminăm caracterele speciale și facem uppercase
  let code = companyName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 10);
  
  if (code.length < 3) {
    // Dacă e prea scurt, adăugăm litere random
    code += Math.random().toString(36).substring(2, 5).toUpperCase();
  }
  
  return code;
}

// ===== ONBOARDING API (după primul login) =====

// GET /api/onboarding-status - Verifică dacă utilizatorul a completat onboarding
app.get("/api/onboarding-status", requireAuth, async (req, res) => {
  try {
    const companyId = req.session.user.company_id;
    
    // Verificăm dacă are clienți, produse, etc.
    const clientsCount = await db.q(
      `SELECT COUNT(*)::int as n FROM clients`,
      []
    );
    
    const productsCount = await db.q(
      `SELECT COUNT(*)::int as n FROM products`,
      []
    );
    
    const companyRes = await db.q(
      `SELECT name, cui, address FROM companies WHERE id = $1`,
      []
    );
    
    const hasCompleted = clientsCount.rows[0].n > 0 && productsCount.rows[0].n > 0;
    
    res.json({
      completed: hasCompleted,
      company: companyRes.rows[0],
      stats: {
        clients: clientsCount.rows[0].n,
        products: productsCount.rows[0].n
      },
      steps: {
        companyProfile: !!companyRes.rows[0].cui,
        addClients: clientsCount.rows[0].n > 0,
        addProducts: productsCount.rows[0].n > 0,
        addStock: false // Verificăm separat
      }
    });
  } catch (error) {
    console.error("Eroare onboarding status:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// POST /api/onboarding-complete - Marchează onboarding ca finalizat
app.post("/api/onboarding-complete", requireAuth, requireCompany, async (req, res) => {
  try {
    const { companyData } = req.body;
    const companyId = req.companyId;
    
    // Actualizăm datele companiei
    if (companyData) {
      await db.q(
        `UPDATE companies 
         SET name = COALESCE($1, name),
             cui = COALESCE($2, cui),
             address = COALESCE($3, address),
             phone = COALESCE($4, phone),
             email = COALESCE($5, email),
             updated_at = NOW()
         WHERE id = $6`,
        [
          companyData.name,
          companyData.cui,
          companyData.address,
          companyData.phone,
          companyData.email,
          companyId
        ]
      );
      
      // Actualizăm și company_settings
      await db.q(
        `UPDATE company_settings 
         SET name = $1, cui = $2, address = $3, updated_at = NOW()
         WHERE 1=1`,
        [companyData.name, companyData.cui, companyData.address, companyId]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Eroare onboarding complete:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// ===== TRIAL & BILLING REMINDERS =====

// GET /api/trial-status - Status perioadă de probă
app.get("/api/trial-status", requireAuth, async (req, res) => {
  try {
    const companyId = req.session.user.company_id;
    
    const result = await db.q(
      `SELECT subscription_status, subscription_expires_at, plan, plan_price
       FROM companies WHERE id = $1`,
      []
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Companie negăsită" });
    }
    
    const company = result.rows[0];
    const now = new Date();
    const expiresAt = new Date(company.subscription_expires_at);
    const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    
    res.json({
      isTrial: company.subscription_status === 'trial',
      daysLeft: daysLeft,
      expiresAt: company.subscription_expires_at,
      plan: company.plan,
      price: company.plan_price,
      needsPayment: daysLeft <= 0 && company.subscription_status === 'trial'
    });
  } catch (error) {
    console.error("Eroare trial status:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// ===== CLIENTS MANAGEMENT API =====

// POST /api/clients - Creează client nou
app.post("/api/clients", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const { 
      name, cui, group_name, location_name, 
      delivery_address, payment_terms, category,
      is_parent, parent_id 
    } = req.body;
    
    if (!name || !group_name) {
      return res.status(400).json({ error: "Nume și grup obligatorii" });
    }
    
    const clientId = crypto.randomUUID();
    
    await db.q(
      `INSERT INTO clients (id, name, cui, group_name, location_name, 
       delivery_address, payment_terms, category, is_parent, parent_id, prices, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '{}'::jsonb, NOW())`,
      [clientId, companyId, name, cui || null, group_name, location_name || null,
       delivery_address || null, payment_terms || 0, category || 'farmacie', 
       is_parent || false, parent_id || null]
    );
    
    res.json({ success: true, id: clientId, message: "Client creat cu succes" });
  } catch (error) {
    console.error("Eroare creare client:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// PUT /api/clients/:id - Actualizează client
app.put("/api/clients/:id", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const clientId = req.params.id;
    const { 
      name, cui, group_name, location_name, 
      delivery_address, payment_terms, category,
      is_parent, parent_id 
    } = req.body;
    
    await db.q(
      `UPDATE clients 
       SET name = $1, cui = $2, group_name = $3, location_name = $4,
           delivery_address = $5, payment_terms = $6, category = $7,
           is_parent = $8, parent_id = $9
       WHERE id = $10`,
      [name, cui || null, group_name, location_name || null,
       delivery_address || null, payment_terms || 0, category || 'farmacie',
       is_parent || false, parent_id || null, clientId, companyId]
    );
    
    res.json({ success: true, message: "Client actualizat" });
  } catch (error) {
    console.error("Eroare actualizare client:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// GET /api/clients/:id/prices - Obține prețurile speciale ale unui client
app.get("/api/clients/:id/prices", requireAuth, requireCompany, async (req, res) => {
  try {
    const clientId = req.params.id;
    
    // Luăm prețurile clientului
    const clientRes = await db.q(
      `SELECT prices FROM clients WHERE id = $1`,
      [clientId]
    );
    
    if (clientRes.rows.length === 0) {
      return res.status(404).json({ error: "Client negăsit" });
    }
    
    const pricesObj = clientRes.rows[0].prices || {};
    const productIds = Object.keys(pricesObj);
    
    if (productIds.length === 0) {
      return res.json({ prices: [] });
    }
    
    // Luăm datele produselor din DB
    const productsRes = await db.q(
      `SELECT id, name, gtin, price as standard_price 
       FROM products 
       WHERE id = ANY($1::text[])`,
      [productIds]
    );
    
    // Construim array-ul final cu toate informațiile
    const pricesArray = productsRes.rows.map(product => ({
      product_id: product.id,
      product_name: product.name,
      gtin: product.gtin || '',
      standard_price: parseFloat(product.standard_price || 0),
      special_price: parseFloat(pricesObj[product.id] || 0)
    }));
    
    res.json({ prices: pricesArray });
    
  } catch (error) {
    console.error("Eroare la citire prețuri:", error);
    res.status(500).json({ error: "Eroare server: " + error.message });
  }
});

// POST /api/clients/:id/prices - Salvează prețurile speciale ale unui client
app.post("/api/clients/:id/prices", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const clientId = req.params.id;
    const { prices: pricesArray } = req.body;
    
    // Convertim array în obiect
    const pricesObj = {};
    if (Array.isArray(pricesArray)) {
      pricesArray.forEach(p => {
        pricesObj[p.product_id] = parseFloat(p.special_price);
      });
    }
    
    await db.q(
      `UPDATE clients SET prices = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(pricesObj), clientId]
    );
    
    res.json({ success: true, message: "Prețuri salvate" });
    
  } catch (error) {
    console.error("Eroare la salvare prețuri:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// POST /api/clients/:id/import-prices - Importă prețuri de la alt client
app.post("/api/clients/:id/import-prices", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = req.companyId;
    const targetClientId = req.params.id;
    const { sourceClientId } = req.body;
    
    if (!sourceClientId) {
      return res.status(400).json({ error: "Client sursă obligatoriu" });
    }
    
    // Verificăm că ambii clienți aparțin companiei
    const checkRes = await db.q(
      `SELECT id FROM clients WHERE id IN ($1, $2)`,
      [targetClientId, sourceClientId, companyId]
    );
    
    if (checkRes.rows.length !== 2) {
      return res.status(403).json({ error: "Clienți invalidi" });
    }
    
    // Copiem prețurile
    await db.q(
      `UPDATE clients 
       SET prices = (SELECT prices FROM clients WHERE id = $1),
           updated_at = NOW()
       WHERE id = $2`,
      [sourceClientId, targetClientId]
    );
    
    res.json({ success: true, message: "Prețuri importate cu succes" });
  } catch (error) {
    console.error("Eroare import prețuri:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// ===== COMPANY SETTINGS API =====

// GET /api/company-settings - Obține setările companiei curente
app.get("/api/company-settings", requireAuth, async (req, res) => {
  try {
    // Use company from subdomain middleware
    if (!req.company) {
      return res.status(404).json({ error: "Companie necunoscută" });
    }
    
    const companyId = req.company.id;
    
    // Get company info from master DB
    const companyResult = await db.masterQuery(
      `SELECT name, cui, plan, subscription_status, subscription_expires_at, max_users
       FROM companies WHERE id = $1`,
      [companyId]
    );
    
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: "Companie negăsită" });
    }
    
    const companyInfo = companyResult.rows[0];
    
    // Get company settings from company DB
    let settings = null;
    try {
      const settingsResult = await db.q(
        `SELECT 
          name, cui, registration_number, vat_number,
          address, city, county, country, phone, email,
          bank_name, bank_iban, smartbill_series, smartbill_token,
          CASE WHEN smartbill_token IS NOT NULL AND smartbill_token != '' 
               THEN true ELSE false END as has_smartbill_token,
          updated_at
         FROM company_settings
         LIMIT 1`
      );
      if (settingsResult.rows.length > 0) {
        settings = settingsResult.rows[0];
      }
    } catch (e) {
      // company_settings table might not exist
      console.log("company_settings not found, using defaults");
    }
    
    // Merge company info with settings
    const response = {
      name: settings?.name || companyInfo.name || '',
      cui: settings?.cui || companyInfo.cui || '',
      plan: companyInfo.plan || 'starter',
      subscription_status: companyInfo.subscription_status || 'trial',
      subscription_expires_at: companyInfo.subscription_expires_at,
      max_users: companyInfo.max_users || 3,
      registration_number: settings?.registration_number || '',
      vat_number: settings?.vat_number || '',
      address: settings?.address || '',
      city: settings?.city || '',
      county: settings?.county || '',
      country: settings?.country || 'Romania',
      phone: settings?.phone || '',
      email: settings?.email || '',
      bank_name: settings?.bank_name || '',
      bank_iban: settings?.bank_iban || '',
      smartbill_series: settings?.smartbill_series || 'OB',
      has_smartbill_token: settings?.has_smartbill_token || false,
      updated_at: settings?.updated_at || null
    };
    
    res.json(response);
  } catch (error) {
    console.error("Eroare la citire setari companie:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// POST /api/company-settings - Actualizează setările companiei
app.post("/api/company-settings", requireAuth, async (req, res) => {
  try {
    const companyId = req.session.user.company_id;
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const userRole = req.session.user.role;
    
    // Doar admin sau superadmin pot modifica setările
    if (userRole !== 'admin' && userRole !== 'superadmin') {
      return res.status(403).json({ error: "Acces interzis. Doar administratorii pot modifica setările." });
    }
    
    // Superadmin poate modifica setările oricărei companii
    const targetCompanyId = isSuperAdmin && req.body.companyId ? req.body.companyId : companyId;
    
    const {
      name, cui, registration_number, vat_number,
      address, city, county, country, phone, email,
      bank_name, bank_iban, smartbill_series, smartbill_token,
      plan, subscription_status, subscription_expires_at
    } = req.body;
    
    // Construim query-ul dinamic
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (name !== undefined) { updates.push(`name = $${paramIndex++}`); values.push(name); }
    if (cui !== undefined) { updates.push(`cui = $${paramIndex++}`); values.push(cui); }
    if (registration_number !== undefined) { updates.push(`registration_number = $${paramIndex++}`); values.push(registration_number); }
    if (vat_number !== undefined) { updates.push(`vat_number = $${paramIndex++}`); values.push(vat_number); }
    if (address !== undefined) { updates.push(`address = $${paramIndex++}`); values.push(address); }
    if (city !== undefined) { updates.push(`city = $${paramIndex++}`); values.push(city); }
    if (county !== undefined) { updates.push(`county = $${paramIndex++}`); values.push(county); }
    if (country !== undefined) { updates.push(`country = $${paramIndex++}`); values.push(country); }
    if (phone !== undefined) { updates.push(`phone = $${paramIndex++}`); values.push(phone); }
    if (email !== undefined) { updates.push(`email = $${paramIndex++}`); values.push(email); }
    if (bank_name !== undefined) { updates.push(`bank_name = $${paramIndex++}`); values.push(bank_name); }
    if (bank_iban !== undefined) { updates.push(`bank_iban = $${paramIndex++}`); values.push(bank_iban); }
    if (smartbill_series !== undefined) { updates.push(`smartbill_series = $${paramIndex++}`); values.push(smartbill_series); }
    if (smartbill_token !== undefined && smartbill_token !== '') { 
      updates.push(`smartbill_token = $${paramIndex++}`); 
      values.push(encrypt(smartbill_token)); // Criptăm token-ul înainte de salvare
    }
    
    updates.push(`updated_at = NOW()`);
    
    // Adăugăm company_id la final pentru WHERE
    values.push(targetCompanyId);
    
    const query = `
      INSERT INTO company_settings (name, cui, updated_at)
      VALUES ($${paramIndex}, 'Firma Noua', 'RO00000000', NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        ${updates.join(', ')}
      RETURNING company_id
    `;
    
    await db.q(query, values);
    
    // Dacă e superadmin și trimite date de plan, actualizăm și tabela companies
    if (isSuperAdmin && (plan !== undefined || subscription_status !== undefined || subscription_expires_at !== undefined)) {
      const planUpdates = [];
      const planValues = [];
      let planParamIndex = 1;
      
      if (plan !== undefined && PLANS[plan]) {
        planUpdates.push(`plan = $${planParamIndex++}`);
        planValues.push(plan);
        // Actualizăm și max_users în funcție de plan
        planUpdates.push(`max_users = $${planParamIndex++}`);
        planValues.push(PLANS[plan].maxUsers);
      }
      if (subscription_status !== undefined) {
        planUpdates.push(`subscription_status = $${planParamIndex++}`);
        planValues.push(subscription_status);
      }
      if (subscription_expires_at !== undefined) {
        planUpdates.push(`subscription_expires_at = $${planParamIndex++}`);
        planValues.push(subscription_expires_at || null);
      }
      
      if (planUpdates.length > 0) {
        planUpdates.push(`updated_at = NOW()`);
        planValues.push(targetCompanyId);
        
        const planQuery = `
          UPDATE companies 
          SET ${planUpdates.join(', ')}
          WHERE id = $${planParamIndex}
        `;
        await db.q(planQuery, planValues);
        
        // Invalidăm cache-ul companiei
        companyCache.delete(targetCompanyId);
      }
    }
    
    // Log audit
    await logAudit(req, "COMPANY_SETTINGS_UPDATE", "company_settings", targetCompanyId, {
      updatedFields: Object.keys(req.body).filter(k => k !== 'smartbill_token')
    });
    
    res.json({ success: true, message: "Setarile au fost salvate" });
  } catch (error) {
    console.error("Eroare la salvare setari companie:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// ===== USER INVITATIONS API =====

// POST /api/invite-user - Admin trimite invitație (doar admin)
app.post("/api/invite-user", requireAuth, async (req, res) => {
  try {
    const companyId = req.session.user.company_id;
    const userRole = req.session.user.role;
    const { email, role = 'user' } = req.body;
    
    // Doar admin și superadmin pot invita
    if (userRole !== 'admin' && userRole !== 'superadmin') {
      return res.status(403).json({ error: "Doar administratorii pot invita utilizatori" });
    }
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: "Email invalid" });
    }
    
    // Verificăm dacă email-ul există deja
    const emailCheck = await db.q(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({ 
        emailExists: true,
        error: "Email-ul există deja în baza de date",
        message: "Acest email este deja înregistrat."
      });
    }
    
    // Verificăm limita de utilizatori
    const companyRes = await db.q(
      `SELECT max_users FROM companies WHERE id = $1`,
      []
    );
    
    if (companyRes.rows.length === 0) {
      return res.status(404).json({ error: "Companie negăsită" });
    }
    
    const maxUsers = companyRes.rows[0].max_users;
    const currentUsersRes = await db.q(
      `SELECT COUNT(*) as count FROM users WHERE active = true`,
      []
    );
    
    if (parseInt(currentUsersRes.rows[0].count) >= maxUsers) {
      return res.status(400).json({ 
        error: "Limită utilizatori atinsă", 
        message: `Planul tău permite maxim ${maxUsers} utilizatori. Fă upgrade pentru a adăuga mai mulți.`
      });
    }
    
    // Generăm token unic
    const inviteToken = generateToken(32);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Invitație valabilă 14 zile
    
    // Salvăm invitația
    await db.q(
      `INSERT INTO invitations (email, invite_token, role, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [email.toLowerCase(), inviteToken, role, req.session.user.id, expiresAt]
    );
    
    // Trimitem email cu link
    const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/join.html?token=${inviteToken}`;
    
    await emailService.sendMail({
      to: email,
      subject: 'Invitație OpenBill - Alătură-te echipei',
      html: `
        <h2>🎉 Ai fost invitat în OpenBill!</h2>
        <p>Utilizatorul <strong>${req.session.user.username}</strong> te-a invitat să te alături echipei.</p>
        <p>Click mai jos pentru a-ți crea contul:</p>
        <a href="${inviteLink}" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Creează contul</a>
        <p style="color: #666;">Link-ul este valabil 14 zile.</p>
        <p style="color: #666; font-size: 12px;">Dacă nu te așteptai la această invitație, poți ignora acest email.</p>
      `
    });
    
    res.json({ success: true, message: "Invitație trimisă cu succes" });
    
  } catch (error) {
    console.error("Eroare trimitere invitație:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// GET /api/invite-verify - Verifică dacă tokenul de invitație e valid
app.get("/api/invite-verify", async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: "Token lipsă" });
    }
    
    const result = await db.q(
      `SELECT i.*, c.name as company_name 
       FROM invitations i
       JOIN companies c ON i.company_id = c.id
       WHERE i.invite_token = $1 AND i.used = false AND i.expires_at > NOW()`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invitație invalidă sau expirată" });
    }
    
    res.json({
      valid: true,
      email: result.rows[0].email,
      companyName: result.rows[0].company_name,
      role: result.rows[0].role
    });
    
  } catch (error) {
    console.error("Eroare verificare invitație:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// POST /api/join-company - Utilizatorul își creează cont din invitație
app.post("/api/join-company", async (req, res) => {
  try {
    const { token, username, password, firstName, lastName, position } = req.body;
    
    if (!token || !username || !password) {
      return res.status(400).json({ error: "Toate câmpurile sunt obligatorii" });
    }
    
    // Validare parolă
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ 
        error: `Parola trebuie să conțină: ${passwordValidation.errors.join(', ')}` 
      });
    }
    
    // Verificăm invitația
    const inviteRes = await db.q(
      `SELECT * FROM invitations WHERE invite_token = $1 AND used = false AND expires_at > NOW()`,
      [token]
    );
    
    if (inviteRes.rows.length === 0) {
      return res.status(400).json({ error: "Invitație invalidă sau expirată" });
    }
    
    const invitation = inviteRes.rows[0];
    
    // Verificăm dacă username există deja în companie
    const existingUser = await db.q(
      `SELECT 1 FROM users WHERE username = $2`,
      [invitation.company_id, username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Username deja existent în această companie" });
    }
    
    // Creăm utilizatorul
    const passwordHash = await bcrypt.hash(password, 10);
    
    await db.q("BEGIN");
    
    try {
      const userResult = await db.q(
        `INSERT INTO users (username, password_hash, role, first_name, last_name, position, email, active, is_approved)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, true)
         RETURNING id`,
        [invitation.company_id, username, passwordHash, invitation.role, firstName, lastName, position, invitation.email]
      );
      
      // Marcăm invitația ca folosită
      await db.q(
        `UPDATE invitations SET used = true, used_by = $1 WHERE id = $2`,
        [userResult.rows[0].id, invitation.id]
      );
      
      await db.q("COMMIT");
      
      res.json({ success: true, message: "Cont creat cu succes! Te poți autentifica acum." });
      
    } catch (err) {
      await db.q("ROLLBACK");
      throw err;
    }
    
  } catch (error) {
    console.error("Eroare creare cont din invitație:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// ===== PASSWORD RESET API =====

// POST /api/forgot-password - Cere resetare parolă
app.post("/api/forgot-password", async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: "Username obligatoriu" });
    }
    
    // Căutăm utilizatorul (după username SAU email)
    const userRes = await db.q(
      `SELECT id, username, email, company_id FROM users 
       WHERE (username = $1 OR LOWER(email) = LOWER($1)) AND active = true`,
      [username]
    );
    
    if (userRes.rows.length === 0) {
      // Nu dezvăluim dacă utilizatorul există (securitate)
      return res.json({ success: true, message: "Dacă contul există, vei primi un email cu instrucțiuni." });
    }
    
    const user = userRes.rows[0];
    
    // Verificăm dacă are email
    if (!user.email) {
      return res.status(400).json({ 
        error: "Nu există email asociat acestui cont", 
        message: "Contactează administratorul companiei pentru resetarea parolei."
      });
    }
    
    // Generăm token
    const resetToken = generateToken(32);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Valabil 1 oră
    
    await db.q(
      `INSERT INTO password_resets (user_id, reset_token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, resetToken, expiresAt]
    );
    
    // Trimitem email
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password.html?token=${resetToken}`;
    
    await emailService.sendMail({
      to: user.email,
      subject: 'Resetare parolă OpenBill',
      html: `
        <h2>🔐 Resetare parolă</h2>
        <p>Ai cerut resetarea parolei pentru contul <strong>${user.username}</strong>.</p>
        <p>Click mai jos pentru a seta o parolă nouă:</p>
        <a href="${resetLink}" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Resetează parola</a>
        <p style="color: #666;">Link-ul este valabil 1 oră.</p>
        <p style="color: #666; font-size: 12px;">Dacă nu ai cerut resetarea parolei, poți ignora acest email.</p>
      `
    });
    
    res.json({ success: true, message: "Dacă contul există, vei primi un email cu instrucțiuni." });
    
  } catch (error) {
    console.error("Eroare forgot password:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// GET /api/verify-reset-token - Verifică dacă tokenul de resetare e valid
app.get("/api/verify-reset-token", async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: "Token lipsă" });
    }
    
    const result = await db.q(
      `SELECT pr.*, u.username 
       FROM password_resets pr
       JOIN users u ON pr.user_id = u.id
       WHERE pr.reset_token = $1 AND pr.used = false AND pr.expires_at > NOW()`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Link invalid sau expirat" });
    }
    
    res.json({ valid: true, username: result.rows[0].username });
    
  } catch (error) {
    console.error("Eroare verificare token resetare:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// POST /api/reset-password - Resetează parola
app.post("/api/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ error: "Token și parolă obligatorii" });
    }
    
    // Validare parolă
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ 
        error: `Parola trebuie să conțină: ${passwordValidation.errors.join(', ')}` 
      });
    }
    
    // Verificăm tokenul
    const resetRes = await db.q(
      `SELECT * FROM password_resets WHERE reset_token = $1 AND used = false AND expires_at > NOW()`,
      [token]
    );
    
    if (resetRes.rows.length === 0) {
      return res.status(400).json({ error: "Link invalid sau expirat" });
    }
    
    const reset = resetRes.rows[0];
    const passwordHash = await bcrypt.hash(password, 10);
    
    await db.q("BEGIN");
    
    try {
      // Actualizăm parola
      await db.q(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [passwordHash, reset.user_id]
      );
      
      // Marcăm tokenul ca folosit
      await db.q(
        `UPDATE password_resets SET used = true WHERE id = $1`,
        [reset.id]
      );
      
      await db.q("COMMIT");
      
      res.json({ success: true, message: "Parola a fost resetată cu succes!" });
      
    } catch (err) {
      await db.q("ROLLBACK");
      throw err;
    }
    
  } catch (error) {
    console.error("Eroare resetare parolă:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// ===== USER PROFILE API =====

// GET /api/profile - Obține profilul utilizatorului curent
app.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    const result = await db.q(
      `SELECT id, username, role, first_name, last_name, position, phone, email, created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Utilizator negăsit" });
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error("Eroare citire profil:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// POST /api/profile - Actualizează profilul
app.post("/api/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { firstName, lastName, position, phone, email } = req.body;
    
    await db.q(
      `UPDATE users 
       SET first_name = $1, last_name = $2, position = $3, phone = $4, email = $5
       WHERE id = $6`,
      [firstName, lastName, position, phone, email, userId]
    );
    
    // Actualizăm și sesiunea
    if (req.session.user) {
      req.session.user.first_name = firstName;
      req.session.user.last_name = lastName;
    }
    
    res.json({ success: true, message: "Profil actualizat cu succes" });
    
  } catch (error) {
    console.error("Eroare actualizare profil:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// POST /api/change-password - Schimbă parola (utilizator autentificat)
app.post("/api/change-password", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Parola curentă și nouă sunt obligatorii" });
    }
    
    // Validare parolă nouă
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ 
        error: `Parola nouă trebuie să conțină: ${passwordValidation.errors.join(', ')}` 
      });
    }
    
    // Verificăm parola curentă
    const userRes = await db.q(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId]
    );
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "Utilizator negăsit" });
    }
    
    const validPassword = await bcrypt.compare(currentPassword, userRes.rows[0].password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: "Parola curentă este incorectă" });
    }
    
    // Actualizăm parola
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await db.q(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [newPasswordHash, userId]
    );
    
    res.json({ success: true, message: "Parola a fost schimbată cu succes" });
    
  } catch (error) {
    console.error("Eroare schimbare parolă:", error);
    res.status(500).json({ error: "Eroare server" });
  }
});

// ----- RAPOARTE (Pro & Enterprise only) -----

// Raport: Cele mai vândute produse
app.get("/api/reports/top-products", requireAuth, requireCompany, requireSubscription, requireFeature('rapoarte'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const { start_date, end_date, period } = req.query;
    
    // Construire filtru dată
    let dateFilter = "";
    let params = [];
    
    if (period) {
      const now = new Date();
      let startDate;
      
      switch(period) {
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'last_week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'this_year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = null;
      }
      
      if (startDate) {
        dateFilter = "AND o.created_at >= $2";
        params.push(startDate.toISOString());
      }
    } else if (start_date && end_date) {
      dateFilter = "AND o.created_at >= $2 AND o.created_at <= $3";
      params.push(start_date, end_date + ' 23:59:59');
    }
    
    // Interogare pentru cele mai vândute produse
    const query = `
      WITH order_items_expanded AS (
        SELECT 
          (item->>'name') as product_name,
          (item->>'gtin') as gtin,
          COALESCE((item->>'qty')::int, 0) as quantity,
          o.created_at
        FROM orders o,
        LATERAL jsonb_array_elements(o.items) as item
        WHERE 1=1
          AND o.status NOT IN ('cancelled', 'anulata')
          ${dateFilter}
      )
      SELECT 
        product_name,
        gtin,
        SUM(quantity) as total_qty,
        COUNT(*) as order_count
      FROM order_items_expanded
      GROUP BY product_name, gtin
      ORDER BY total_qty DESC
      LIMIT 50
    `;
    
    const result = await db.q(query, params);
    
    res.json({
      success: true,
      data: result.rows,
      filters: { period, start_date, end_date }
    });
    
  } catch (error) {
    console.error("Eroare raport top produse:", error);
    res.status(500).json({ error: "Eroare la generarea raportului" });
  }
});

// Raport: Cei mai buni clienți
app.get("/api/reports/top-customers", requireAuth, requireCompany, requireSubscription, requireFeature('rapoarte'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const { start_date, end_date, period } = req.query;
    
    // Construire filtru dată
    let dateFilter = "";
    let params = [];
    
    if (period) {
      const now = new Date();
      let startDate;
      
      switch(period) {
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'last_week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'this_year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = null;
      }
      
      if (startDate) {
        dateFilter = "AND created_at >= $2";
        params.push(startDate.toISOString());
      }
    } else if (start_date && end_date) {
      dateFilter = "AND created_at >= $2 AND created_at <= $3";
      params.push(start_date, end_date + ' 23:59:59');
    }
    
    const query = `
      WITH order_totals AS (
        SELECT 
          client->>'name' as client_name,
          client->>'cui' as cui,
          id,
          created_at,
          COALESCE(
            (SELECT SUM(COALESCE((item->>'qty')::int, 0) * COALESCE((item->>'unitPrice')::numeric, 0))
             FROM jsonb_array_elements(items) as item),
            0
          ) as order_total
        FROM orders
        WHERE 1=1
          AND status NOT IN ('cancelled', 'anulata')
          ${dateFilter}
      )
      SELECT 
        client_name,
        cui,
        COUNT(*) as total_orders,
        COALESCE(SUM(order_total), 0) as total_value,
        COALESCE(AVG(order_total), 0) as avg_order_value,
        MIN(created_at) as first_order,
        MAX(created_at) as last_order
      FROM order_totals
      GROUP BY client_name, cui
      ORDER BY total_value DESC
      LIMIT 50
    `;
    
    const result = await db.q(query, params);
    
    // Log pentru debug
    console.log("Raport clienți - rows:", result.rows.length);
    if (result.rows.length > 0) {
      console.log("Primul client:", JSON.stringify(result.rows[0]));
    }
    
    res.json({
      success: true,
      data: result.rows,
      filters: { period, start_date, end_date }
    });
    
  } catch (error) {
    console.error("Eroare raport top clienți:", error);
    res.status(500).json({ error: "Eroare la generarea raportului" });
  }
});

// Raport: KM Mașini
app.get("/api/reports/vehicle-km", requireAuth, requireCompany, requireSubscription, requireFeature('rapoarte'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const { start_date, end_date, period, vehicle_id } = req.query;
    
    // Construire filtre
    let dateFilter = "";
    let vehicleFilter = "";
    let params = [];
    let paramIndex = 2;
    
    if (vehicle_id) {
      vehicleFilter = `AND t.vehicle_id = $${paramIndex}`;
      params.push(vehicle_id);
      paramIndex++;
    }
    
    if (period) {
      const now = new Date();
      let startDate;
      
      switch(period) {
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'last_week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'this_year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = null;
      }
      
      if (startDate) {
        dateFilter = `AND t.date >= $${paramIndex}`;
        params.push(startDate.toISOString().split('T')[0]);
        paramIndex++;
      }
    } else if (start_date && end_date) {
      dateFilter = `AND t.date >= $${paramIndex} AND t.date <= $${paramIndex + 1}`;
      params.push(start_date, end_date);
      paramIndex += 2;
    }
    
    // Lista de mașini pentru filtru
    const vehiclesQuery = `SELECT id, plate_number FROM vehicles WHERE active = true ORDER BY plate_number`;
    const vehiclesResult = await db.q(vehiclesQuery);
    
    // Raport KM pe mașini
    const query = `
      SELECT 
        v.plate_number,
        t.vehicle_id,
        COUNT(t.id) as total_trips,
        SUM(COALESCE(t.km_end - t.km_start, 0)) as total_km,
        AVG(COALESCE(t.km_end - t.km_start, 0)) as avg_km_per_trip,
        MIN(t.date) as first_trip,
        MAX(t.date) as last_trip,
        (SELECT (km_end - km_start) FROM trip_sheets 
         WHERE vehicle_id = t.vehicle_id AND km_end IS NOT NULL 
         ORDER BY date DESC, created_at DESC LIMIT 1) as last_trip_distance,
        MAX(t.km_end) as last_km_recorded
      FROM trip_sheets t
      JOIN vehicles v ON t.vehicle_id = v.id
      WHERE 1=1
        AND t.km_end IS NOT NULL
        ${vehicleFilter}
        ${dateFilter}
      GROUP BY v.plate_number, t.vehicle_id
      ORDER BY total_km DESC
    `;
    
    const result = await db.q(query, params);
    
    // Detalii pe zile pentru grafic
    const dailyQuery = `
      SELECT 
        t.date,
        v.plate_number,
        SUM(COALESCE(t.km_end - t.km_start, 0)) as daily_km
      FROM trip_sheets t
      JOIN vehicles v ON t.vehicle_id = v.id
      WHERE 1=1
        AND t.km_end IS NOT NULL
        ${vehicleFilter}
        ${dateFilter}
      GROUP BY t.date, v.plate_number
      ORDER BY t.date DESC
      LIMIT 100
    `;
    
    const dailyResult = await db.q(dailyQuery, params.slice(0, paramIndex - 1));
    
    res.json({
      success: true,
      data: result.rows,
      daily_data: dailyResult.rows,
      vehicles: vehiclesResult.rows,
      filters: { period, start_date, end_date, vehicle_id }
    });
    
  } catch (error) {
    console.error("Eroare raport KM mașini:", error);
    res.status(500).json({ error: "Eroare la generarea raportului" });
  }
});
