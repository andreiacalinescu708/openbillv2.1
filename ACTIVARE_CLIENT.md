# Activare Client în OpenBill (Multi-Tenant)

Ghid pentru activarea unui client care plătește abonamentul.

## 🎯 Scenarii

### Scenariul 1: Datele sunt deja în OpenBill (Compania DEFAULT)

Dacă Fast Medical are deja datele în aplicație (dinainte de multi-tenant):

```bash
# Opțiunea A: Setup interactiv (te întreabă tot)
node setup_existing_company.js

# Opțiunea B: Activare rapidă (direct din cod)
node activate_company.js
```

**Ce face:**
1. ✅ Schimbă numele din "DEFAULT" în "Fast Medical"
2. ✅ Setează CUI, adresă, contact
3. ✅ Activează abonamentul (Pro/Enterprise) 
4. ✅ Setează perioada (ex: 12 luni)
5. ✅ Creează utilizatorii pentru client

---

## 🔧 Opțiunea A: Setup Interactiv (Recomandat)

```bash
node setup_existing_company.js
```

**Flux:**
1. Afișează companiile existente
2. Selectezi compania (ex: DEFAULT)
3. Introduci datele noi:
   - Nume firmă: "Fast Medical SRL"
   - Cod: "FASTMEDICAL"
   - CUI: "RO12345678"
   - Contact, adresă, etc.
4. Selectezi planul (Starter/Pro/Enterprise)
5. Selectezi perioada (1/3/6/12 luni)
6. Creezi utilizatorii (admin + user)

**Avantaje:**
- Nu modifici codul
- Flexibil pentru fiecare client
- Validează datele

---

## ⚡ Opțiunea B: Activare Rapidă

Editează fișierul `activate_company.js` și modifică secțiunea `CONFIG`:

```javascript
const CONFIG = {
  companyCode: 'FASTMEDICAL',      // Cod unic
  companyName: 'Fast Medical SRL', // Numele firmei
  cui: 'RO12345678',               // CUI real
  address: 'Str. Medicală nr. 10, București',
  phone: '0722-123-456',
  email: 'contact@fastmedical.ro',
  
  plan: 'pro',      // starter / pro / enterprise
  months: 12,       // perioada în luni
  
  users: [
    { username: 'fastadmin', password: 'Parola2024!', role: 'admin' },
    { username: 'fastuser', password: 'Parola2024!', role: 'user' },
  ]
};
```

Apoi rulează:
```bash
node activate_company.js
```

**Sau direct cu argumente:**
```bash
node activate_company.js FASTMEDICAL contact@fastmedical.ro pro 12
```

---

## 🆕 Scenariul 2: Client Complet Nou

Dacă vrei să creezi o companie nouă goală:

```bash
node seed_second_company.js
```

Acesta creează compania "CLIENT2" cu date de test.

**Pentru client real, folosește:**
```bash
node activate_company.js
```

---

## 📋 Ce primește clientul (Fast Medical)

După activare, trimite clientului:

```
Subiect: Cont OpenBill Activat - Fast Medical

Bună ziua,

Contul dvs. OpenBill a fost activat cu succes.

🔗 LINK ACCES:
https://openbill.ro (sau IP-ul/domeniul tău)

👑 ADMINISTRATOR:
   Username: fastadmin
   Parolă: Parola2024!

👤 UTILIZATOR:
   Username: fastuser  
   Parolă: Parola2024!

💰 DETALII ABONAMENT:
   Plan: Pro (39.99€/lună)
   Perioada: 12 luni
   Valabil până la: 06.03.2027
   Max utilizatori: 10

📞 SUPORT:
   Email: support@openbill.ro
   Telefon: 0722-XXX-XXX

IMPORTANT: Schimbați parolele la primul login!

Cu stimă,
Echipa OpenBill
```

---

## 🔒 Securitate

1. **Parolele** trebuie schimbate la primul login
2. **Doar utilizatorii aprobați** pot accesa datele
3. **Datele sunt izolate** - alți clienți nu văd nimic
4. **Abonamentul expiră** automat - accesul e blocat

---

## 📊 Verificare Activare

După activare, verifică în baza de date:

```sql
-- Status companie
SELECT code, name, plan, subscription_status, subscription_expires_at 
FROM companies WHERE code = 'FASTMEDICAL';

-- Utilizatori
SELECT username, role, is_approved FROM users 
WHERE company_id = (SELECT id FROM companies WHERE code = 'FASTMEDICAL');

-- Datele sunt izolate?
SELECT COUNT(*) as nr_clienti FROM clients 
WHERE company_id = (SELECT id FROM companies WHERE code = 'FASTMEDICAL');
```

---

## 🔄 Reînnoire Abonament

Când clientul reînnoiește abonamentul:

```bash
node setup_existing_company.js
```

Selectează compania și setează noua perioadă de expirare.

**Sau direct în SQL:**
```sql
UPDATE companies 
SET subscription_expires_at = '2027-12-31',
    subscription_status = 'active'
WHERE code = 'FASTMEDICAL';
```

---

## ❌ Dezactivare Client

Dacă clientul nu mai plătește:

```sql
-- Suspendare (păstrează datele)
UPDATE companies 
SET subscription_status = 'suspended'
WHERE code = 'FASTMEDICAL';

-- Sau ștergere completă (ATENȚIE!)
DELETE FROM companies WHERE code = 'FASTMEDICAL';
-- Aceasta șterge în cascadă toate datele (clienți, produse, comenzi...)
```

---

## 💡 Recomandări

1. **Folosește coduri unice** pentru fiecare client (ex: FASTMEDICAL, MEDIMAX, etc.)
2. **Salvează parolele** într-un loc sigur (password manager)
3. **Setează reminder** pentru expirarea abonamentelor
4. **Fă backup** înainte de modificări majore

---

## 🆘 Troubleshooting

### "Compania nu există"
```bash
# Verifică companiile existente
node -e "require('dotenv').config(); const {Pool} = require('pg'); const p = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}}); p.query('SELECT code, name FROM companies').then(r => console.log(r.rows)).then(() => p.end());"
```

### "Username deja existent"
- Folosește prefixe: `fastadmin`, `medimax_admin`
- Sau șterge userul vechi din baza de date

### "Datele nu sunt izolate"
- Verifică că `company_id` este setat peste tot
- Rulează `node migrate_multi_tenant.js` dacă e cazul
