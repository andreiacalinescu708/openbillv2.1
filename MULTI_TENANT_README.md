# OpenBill - Multi-Tenant Setup

Această versiune a aplicației OpenBill suportă arhitectură **multi-tenant**, ceea ce înseamnă că mai mulți clienți (companii) pot folosi aceeași aplicație cu date complet izolate.

## 🏗️ Arhitectura Multi-Tenant

Fiecare companie are:
- **Company ID** unic - identificator în toate tabelele
- **Company Code** - cod scurt pentru referință (ex: "DEMO", "CLIENT2")
- **Plan de abonament**: Starter (29.99€), Pro (39.99€), Enterprise (59.99€)
- **Limită de utilizatori** - în funcție de plan
- **Date izolate** - clienți, produse, stoc, comenzi, etc.

## 🚀 Setup Inițial

### 1. Instalare dependențe
```bash
npm install
```

### 2. Setare variabile de mediu (.env)
```env
DATABASE_URL=postgresql://user:pass@host:port/dbname
SESSION_SECRET=cheie-secreta-lunga-si-complexa
ADMIN_USER=admin
ADMIN_PASS=parola-admin
```

### 3. Migrare date existente (dacă ai date vechi)
```bash
node migrate_multi_tenant.js
```

Acest script va:
- Crea o companie default pentru datele existente
- Adăuga `company_id` la toate înregistrările existente
- Păstra toate datele intacte

### 4. Creare al doilea client pentru testare
```bash
node seed_second_company.js
```

Acest script va crea:
- Compania "CLIENT2" cu plan Pro
- Utilizator `admin2` / `parola123`
- Clienți, produse și stoc de test

## 🔑 Autentificare

### Prima companie (default):
- **Username:** `admin`
- **Password:** `admin` (sau ce ai în .env)
- **Company:** DEMO

### A doua companie (de test):
- **Username:** `admin2`
- **Password:** `parola123`
- **Company:** CLIENT2

## 📡 API Endpoints

### Companii
```
GET    /api/companies              - Lista companiilor utilizatorului
POST   /api/companies              - Creează companie nouă (admin)
POST   /api/companies/switch       - Schimbă compania activă
```

### Autentificare
```
POST   /api/register               - Înregistrare cu company_code opțional
POST   /api/login                  - Login (returnează și company_id)
POST   /api/logout                 - Logout
GET    /api/me                     - Info utilizator logat + companie
```

### Toate celelalte endpoint-uri filtrează automat după `company_id`
- `/api/clients-*`
- `/api/products-*`
- `/api/orders-*`
- `/api/stock-*`
- `/api/drivers-*`
- `/api/vehicles-*`
- `/api/trip-sheets-*`
- etc.

## 🛡️ Securitate

1. **Izolare completă** - fiecare utilizator vede DOAR datele companiei sale
2. **Middleware multi-nivel**:
   - `requireAuth` - verifică autentificarea
   - `requireCompany` - extrage și validează company_id
   - `requireSubscription` - verifică abonament activ

3. **Toate query-urile includ** `WHERE company_id = $1`

## 💰 Planuri și Prețuri

| Plan | Preț | Max Utilizatori | Feature-uri |
|------|------|-----------------|-------------|
| Starter | 29.99€/lună | 3 | Comenzi, Stoc, Clienți, Produse |
| Pro | 39.99€/lună | 10 | + Rapoarte, Foi parcurs, Șoferi |
| Enterprise | 59.99€/lună | Nelimitat | + API Access, Support prioritar |

## 🧪 Testare Multi-Tenant

1. **Login ca admin** (prima companie):
   ```
   POST /api/login
   { "username": "admin", "password": "admin" }
   ```

2. **Verifică datele** - ar trebui să vezi clienții și produsele din prima companie

3. **Logout** și **login ca admin2** (a doua companie):
   ```
   POST /api/login
   { "username": "admin2", "password": "parola123" }
   ```

4. **Verifică datele** - ar trebui să vezi clienții și produsele COMPLET DIFERITE

5. **Verificare izolare**:
   - Clienții din compania 1 NU apar în compania 2
   - Produsele din compania 1 NU apar în compania 2
   - Comenzile sunt separate complet

## 🗃️ Structura Bazei de Date

### Tabela `companies`
```sql
- id (UUID)
- code (TEXT UNIQUE) - cod scurt
- name (TEXT)
- cui (TEXT)
- plan (TEXT) - starter/pro/enterprise
- plan_price (NUMERIC)
- max_users (INTEGER)
- subscription_status (TEXT)
- subscription_expires_at (TIMESTAMPTZ)
```

### Toate tabelele de date au `company_id`
- `users.company_id`
- `clients.company_id`
- `products.company_id`
- `orders.company_id`
- `stock.company_id`
- `drivers.company_id`
- `vehicles.company_id`
- `trip_sheets.company_id`
- `fuel_receipts.company_id`
- `stock_transfers.company_id`
- `audit.company_id`
- `client_balances.company_id`

## 📝 Creare Manuală Companie Nouă

```javascript
// Ca admin, folosește POST /api/companies
{
  "code": "NOUACLIENT",
  "name": "Noua Client SRL",
  "cui": "RO98765432",
  "plan": "pro"
}
```

Apoi creează un utilizator pentru acea companie:
```javascript
// POST /api/register
{
  "username": "user_nou",
  "password": "parola",
  "companyCode": "NOUACLIENT"
}
```

Și aprobă-l din admin panel.

## 🔧 Troubleshooting

### "Companie necunoscută"
- Verifică că utilizatorul are `company_id` setat în baza de date
- Rulează `node migrate_multi_tenant.js`

### "Nu aveți acces la această companie"
- Sesiuena nu are `company_id` corect
- Re-autentifică-te

### Datele nu sunt izolate
- Verifică că middleware-urile sunt aplicate pe rute
- Toate query-urile trebuie să includă `WHERE company_id = $1`

## 📞 Suport

Pentru probleme sau întrebări, verifică:
1. Log-urile serverului
2. Endpoint `/api/debug-db` pentru status DB
3. Endpoint `/api/test` pentru testare rapidă
