# Backup OpenBill

## Data backup: 2026-03-07 20:48

### Conținut
- `server.js.backup` - Cod sursă server
- `db.js.backup` - Modul bază de date
- `email.js.backup` - Modul email
- `.env.backup` - Variabile de mediu (fără parole reale)
- `public_backup/` - Fișiere frontend
- `backup-data.json` - Export date din baza de date
- `backup-complete.zip` - Arhivă completă

### Date exportate
- ✅ 8 companii
- ✅ 10 utilizatori
- ✅ 104 clienți
- ✅ 430 produse
- ✅ 8 comenzi
- ✅ 55 înregistrări stoc
- ✅ 3 șoferi
- ✅ 6 mașini
- ✅ 9 foi de parcurs
- ✅ 109 solduri clienți
- ✅ 16 categorii
- ✅ 7 setări companii

### Restaurare

#### Restaurare fișiere:
```bash
# Dezarhivare
cd backups/2026-03-07_20-48
unzip backup-complete.zip

# Copiere fișiere
cp server.js.backup ../../server.js
cp db.js.backup ../../db.js
cp email.js.backup ../../email.js
```

#### Restaurare bază de date:
```bash
# Import date JSON (necesită script Node.js)
node import-data.js
```

### Contact
Pentru probleme cu backup-ul: support@openbill.ro
