# Onboarding Client Nou în OpenBill

Ghid complet pentru experiența unui client care descoperă OpenBill online.

## 🎯 Fluxul Clientului Nou

```
1. Descoperă site-ul → 2. Vede prețurile → 3. Signup → 4. Trial 14 zile → 5. Plătește (sau pleacă)
```

---

## 📄 1. Landing Page

**URL:** `http://localhost:3000/index-landing.html`

Clientul vede:
- ✅ Prezentarea aplicației (features)
- ✅ Prețurile (Starter/Pro/Enterprise)
- ✅ CTA "Începe Gratuit 14 Zile"
- ✅ Buton login pentru cei cu cont

---

## 📝 2. Pagina de Înregistrare

**URL:** `http://localhost:3000/signup.html`

**Date cerute:**
- 🏢 Numele firmei (ex: "Fast Medical SRL")
- 📝 CUI (opțional, dar recomandat)
- 📧 Email (pentru notificări)
- 📞 Telefon (opțional)
- 👤 Username administrator
- 🔑 Parolă (minim 6 caractere)
- 📦 Selectare plan (Starter/Pro/Enterprise)

**Ce se întâmplă:**
1. Completează formularul
2. Apasă "Creează Cont Gratuit"
3. API creează automat:
   - Compania cu cod unic (ex: "FASTMEDICAL")
   - Utilizator admin
   - Perioadă trial 14 zile
4. Redirecționat la login cu mesaj de succes

---

## 🚀 3. Primul Login & Onboarding

După login, clientul vede **wizard de onboarding**:

### Pasul 1: Profil Companie
```
□ Confirmă numele firmei
□ Adaugă CUI (dacă nu l-a pus la signup)
□ Adaugă adresă
□ Adaugă logo (opțional)
```

### Pasul 2: Adaugă Primii Clienți
```
□ Import din Excel sau
□ Adaugă manual 2-3 clienți
```

### Pasul 3: Adaugă Produsele
```
□ Import din Excel sau
□ Adaugă manual câteva produse
□ Setează GTIN-uri pentru scanare
```

### Pasul 4: Adaugă Stoc Inițial
```
□ Introdu stocul curent
□ Setează locațiile (A, B, C...)
□ Adaugă termene de valabilitate
```

---

## 📧 4. Email-uri Automate

### Email 1: Bun venit (imediat după signup)
```
Subiect: 🎉 Bun venit în OpenBill! Contul tău e gata.

Bună [Nume],

Contul pentru [Numele Firmei] a fost creat cu succes!

🔗 ACCES APLICAȚIE:
https://openbill.ro/login.html

🔑 DATE DE AUTENTIFICARE:
Username: [username_ales]
Parolă: [cea_setată]

💰 DETALII ABONAMENT:
Plan: [Starter/Pro/Enterprise]
Perioadă de probă: 14 zile gratuite
Expiră: [data]

📚 RESURSE UTILE:
• Ghid de început rapid: https://openbill.ro/guida
• Video tutoriale: https://openbill.ro/video
• Support: support@openbill.ro

Începe configurarea adăugând primii clienți și produse.

Succes!
Echipa OpenBill
```

### Email 2: Reminder ziua 7 (jumătatea perioadei)
```
Subiect: ⏰ Mai ai 7 zile din perioada de probă

Cum merge cu OpenBill?

Ai adăugat deja [X] clienți și [Y] produse.

💡 SUGESTIE: Încearcă să creezi prima comandă de test.

Pentru întrebări, răspunde la acest email.
```

### Email 3: Reminder ziua 12 (urgent)
```
Subiect: ⏰ Perioada de probă expiră în 2 zile

Nu uita să activezi abonamentul!

Preț: [39.99€/lună] pentru planul Pro

Plătește acum: [link plăți]

Dacă nu plătești până pe [data], accesul va fi suspendat,
dar datele rămân salvate pentru 30 de zile.
```

### Email 4: Confirmare plată
```
Subiect: ✅ Abonament activat! Factura ta.

Plata a fost procesată cu succes.

📄 FACTURA: [descarcă PDF]

Abonament activ până la: [data + 1 lună]
```

---

## 💳 5. Plata Abonamentului

### Opțiuni de plată:

1. **Card (Stripe)** - Automat, instant
2. **OP (Ordin de Plată)** - Manual, confirmare în 24h
3. **Transfer Bancar** - Pentru Enterprise

### Pagina de Billing:
```
URL: /billing.html

Afișează:
• Status abonament (Trial/Activ/Suspendat)
• Zile rămase
• Metodă de plată
• Istoric facturi
• Buton "Extinde Abonamentul"
```

---

## 🔧 6. Admin Panel (pentru tine ca administrator)

### Vezi toate companiile:
```bash
# Query direct în DB
SELECT 
  c.code,
  c.name,
  c.plan,
  c.subscription_status,
  c.subscription_expires_at,
  COUNT(u.id) as users
FROM companies c
LEFT JOIN users u ON c.id = u.company_id
GROUP BY c.id
ORDER BY c.created_at DESC;
```

### API Admin:
```
GET /api/admin/companies         - Lista tuturor companiilor
GET /api/admin/company/:id       - Detalii companie
PUT /api/admin/company/:id       - Modifică companie
POST /api/admin/extend-trial/:id - Extinde perioada trial
```

---

## 📊 7. Metrici de Urmărit

Pentru fiecare client nou, monitorizează:

| Metrică | Țintă |
|---------|-------|
| Signup → First Login | > 80% |
| First Login → Add Client | > 60% |
| Add Client → Add Product | > 50% |
| Trial → Paid | > 30% |
| Churn (pleacă după trial) | < 70% |

---

## 🛠️ 8. Setup Tehnic (pentru dezvoltator)

### Activează landing page:
```javascript
// În server.js, schimbă ruta default
app.get("/", (req, res) => {
  // Dacă nu e logat, arată landing
  if (!req.session.user) {
    return res.sendFile(path.join(__dirname, "public", "index-landing.html"));
  }
  // Dacă e logat, arată dashboard
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
```

### Configurează email (SMTP):
```javascript
// .env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=support@openbill.ro
SMTP_PASS=parola_app
```

### Cron job pentru reminder-e:
```javascript
// Rulează zilnic la 9:00 AM
// Verifică trial-uri care expiră în 7, 3, 1 zile
// Trimite email-uri automate
```

---

## 🚨 9. Handling Probleme

### "Nu primesc email-ul de confirmare"
- Verifică spam/junk
- Resend email: buton în UI
- Contact support direct

### "Am uitat parola"
- Link "Resetare parolă" pe login
- Email cu token de reset
- Formular nouă parolă

### "Vreau să schimb planul"
- Din billing, upgrade/downgrade
- Calcul pro-rata pentru diferență
- Instant sau la următoarea facturare

### "Vreau să anulez"
- Buton "Anulează Abonamentul" în setări
- Datele păstrate 30 de zile
- Export date înainte de ștergere

---

## ✅ 10. Checklist Lansare

- [ ] Landing page design atractiv
- [ ] Formular signup funcțional
- [ ] Email-uri automate configurate
- [ ] Proces plată testat (Stripe sandbox)
- [ ] Onboarding wizard creat
- [ ] Documentație help center
- [ ] Support chat/email activ
- [ ] Analytics tracking (Google Analytics)
- [ ] GDPR compliance (cookies, privacy)
- [ ] Terms & Conditions pagini

---

## 💡 Tips pentru Creștere Conversie

1. **Signup rapid** - Maxim 5 câmpuri obligatorii
2. **Social proof** - Logo clienți existenți pe landing
3. **Demo video** - 2 min prezentare aplicație
4. **Live chat** - Intercom sau similar pe landing
5. **Garanție** - "30 zile banii înapoi"
6. **Discount anual** - "Plătești 10 luni, primești 12"
7. **Referral program** - "Recomandă și primești 1 lună gratis"

---

## 📞 Contact Support

Pentru clienți:
- Email: support@openbill.ro
- Telefon: 0722-XXX-XXX (L-V 9:00-18:00)
- Chat: Widget pe site

Pentru tine (admin):
- Vezi toți clienții în panoul admin
- Poți intra "peste" orice cont (impersonate)
- Poți modifica date, reseta parole, extinde trial-uri
