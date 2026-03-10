# Flux Client Nou în OpenBill

Ghid vizual pentru parcursul unui client care descoperă OpenBill online.

---

## 🎯 Fluxul Complet

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT NOU pe Internet                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  1. LANDING PAGE                                                        │
│     URL: http://localhost:3000/index-landing.html                       │
│                                                                         │
│     • Vede prezentarea aplicației                                      │
│     • Compară planurile (Starter/Pro/Enterprise)                       │
│     • Citește beneficiile                                              │
│                                                                         │
│     ┌─────────────────┐    ┌─────────────────┐                         │
│     │ 🚀 Începe       │    │ 🔑 Am deja cont │                         │
│     │    Gratuit      │    │                 │                         │
│     └────────┬────────┘    └────────┬────────┘                         │
│              │                      │                                   │
│              ▼                      ▼                                   │
│         /signup.html           /login.html                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. PAGINA DE ÎNREGISTRARE                                              │
│     URL: http://localhost:3000/signup.html                              │
│                                                                         │
│     Completează formularul (30 secunde):                               │
│                                                                         │
│     ┌─────────────────────────────────────┐                            │
│     │ 🏢 Numele Firmei *                  │                            │
│     │    Ex: Fast Medical SRL             │                            │
│     │                                     │                            │
│     │ 📝 CUI (opțional)                   │                            │
│     │    Ex: RO12345678                   │                            │
│     │                                     │                            │
│     │ 📧 Email *                          │                            │
│     │    contact@fastmedical.ro           │                            │
│     │                                     │                            │
│     │ 📞 Telefon                          │                            │
│     │    0722-123-456                     │                            │
│     │                                     │                            │
│     │ 👤 Username Administrator *         │                            │
│     │    fastadmin                        │                            │
│     │                                     │                            │
│     │ 🔑 Parolă * (minim 6 caractere)    │                            │
│     │    ********                         │                            │
│     │                                     │                            │
│     │ 📦 Selectează Planul                │                            │
│     │    ○ Starter (29.99€)               │                            │
│     │    ● Pro (39.99€) ← Selectat        │                            │
│     │    ○ Enterprise (59.99€)            │                            │
│     │                                     │                            │
│     │  ┌─────────────────────────────┐   │                            │
│     │  │   🚀 Creează Cont Gratuit   │   │                            │
│     │  └─────────────────────────────┘   │                            │
│     └─────────────────────────────────────┘                            │
│                                                                         │
│     Ce se întâmplă în spate:                                           │
│     • API creează compania cu cod unic (ex: FASTMEDICAL)               │
│     • Creează utilizator admin                                         │
│     • Setează perioada de probă: 14 zile                               │
│     • Salvează toate datele în DB                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. PAGINA DE SUCCES                                                    │
│     (Afișată automat după înregistrare)                                 │
│                                                                         │
│                           🎉                                            │
│              Cont Creat cu Succes!                                      │
│                                                                         │
│     Bine ai venit în OpenBill! Contul tău este gata.                    │
│                                                                         │
│     ┌─────────────────────────────────────┐                             │
│     │  🏢 Companie: Fast Medical SRL      │                             │
│     │  👤 Username: fastadmin             │                             │
│     │  📅 Perioadă de probă: 14 zile      │                             │
│     └─────────────────────────────────────┘                             │
│                                                                         │
│     📧 Am trimis detaliile pe email.                                    │
│     ⏳ Vei fi redirecționat la login în 5 secunde...                    │
│                                                                         │
│           ┌──────────────────────────┐                                  │
│           │ Conectează-te Acum  →    │                                  │
│           └──────────────────────────┘                                  │
│                                                                         │
│     (Redirect automat la /login.html?new=true)                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. LOGIN                                                               │
│     URL: http://localhost:3000/login.html?new=true                      │
│                                                                         │
│     ┌─────────────────────────────────────┐                             │
│     │ 👤 Username: [fastadmin    ]        │                             │
│     │                                     │                             │
│     │ 🔑 Parolă:   [********     ]        │                             │
│     │                                     │                             │
│     │  ┌─────────────────────────────┐   │                             │
│     │  │      Conectează-te          │   │                             │
│     │  └─────────────────────────────┘   │                             │
│     └─────────────────────────────────────┘                             │
│                                                                         │
│     După login reușit → Redirect la Dashboard                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. DASHBOARD (Prima Dată)                                              │
│     URL: http://localhost:3000/index.html                               │
│                                                                         │
│     Afișează wizard de onboarding:                                      │
│                                                                         │
│     ┌─────────────────────────────────────┐                             │
│     │  🚀 Bun venit în OpenBill!          │                             │
│     │                                     │                             │
│     │  Să configurăm contul tău:          │                             │
│     │                                     │                             │
│     │  ☐ 1. Confirmă datele companiei    │                             │
│     │  ☐ 2. Adaugă primii clienți        │                             │
│     │  ☐ 3. Adaugă produsele             │                             │
│     │  ☐ 4. Configurează stocul          │                             │
│     │                                     │                             │
│     │  [ Începe Configurarea ]           │                             │
│     └─────────────────────────────────────┘                             │
│                                                                         │
│     Sau poate sări peste și să înceapă direct să folosească aplicația  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  6. APLICAȚIA COMPLETĂ                                                  │
│                                                                         │
│     Clientul poate acum să folosească TOATE funcționalitățile:         │
│                                                                         │
│     📦 Gestiune Stocuri        🛒 Comenzi & Facturare                  │
│     👥 Clienți & Prețuri       🚚 Foi de Parcurs                       │
│     📊 Rapoarte & Analize      ⚙️ Setări Companie                      │
│                                                                         │
│     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│     Perioada de probă: 14 zile gratuite                                │
│     După 14 zile → trebuie să plătească abonamentul                    │
│     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
└─────────────────────────────────────────────────────────────────────────┘


---

## 📧 Email-uri Automate (Ce primește clientul)

### Email 1: Confirmare Înregistrare (trimis imediat)
```
Subiect: 🎉 Cont OpenBill Creat - Fast Medical

Bună,

Contul pentru Fast Medical a fost creat cu succes!

🔗 Acces: http://localhost:3000/login.html
👤 Username: fastadmin
📅 Trial: 14 zile gratuite

Poți începe să folosești aplicația imediat.

Succes!
Echipa OpenBill
```

### Email 2: Reminder Ziua 7 (la jumătatea perioadei)
```
Subiect: ⏰ Mai ai 7 zile din perioada de probă

Cum funcționează OpenBill pentru tine?

Ai adăugat deja clienți și produse?

[Buton: Deschide Aplicația]
```

### Email 3: Notificare Expirare Ziua 12
```
Subiect: ⏰ Perioada de probă expiră în 2 zile

Nu uita să activezi abonamentul!

Plan Pro: 39.99€/lună
[Plătește Acum]

Dacă nu plătești, contul va fi suspendat.
```

---

## 🔑 Ce se Creează în DB pentru Client Nou

| Entitate | Valoare | Exemplu |
|----------|---------|---------|
| **Companie** | ID unic | `550e8400-e29b-41d4-a716-446655440000` |
| | Cod | `FASTMEDICAL` |
| | Nume | `Fast Medical SRL` |
| | Plan | `pro` |
| | Preț | `39.99` |
| | Status | `trial` |
| | Expiră | `+14 zile` |
| | Max Users | `10` |
| **Utilizator** | Username | `fastadmin` |
| | Rol | `admin` |
| | Company ID | (legat de mai sus) |
| | Aprobat | `true` |

---

## 🧪 Testare Flux Client Nou

### Testează local:
```bash
# 1. Pornește serverul
node server.js

# 2. Deschide în browser
http://localhost:3000/index-landing.html

# 3. Completează signup cu date de test:
#    Companie: Test SRL
#    Email: test@test.com
#    Username: testadmin
#    Parolă: test123

# 4. Verifică în DB:
#    SELECT * FROM companies WHERE code = 'TEST';
#    SELECT * FROM users WHERE username = 'testadmin';
```

---

## 🚨 Troubleshooting

### "Pagina signup nu funcționează"
Verifică că serverul rulează:
```bash
curl http://localhost:3000/api/public-plans
```

### "Eroare la creare cont"
Verifică log-urile serverului pentru detalii.

### "Nu primesc email"
Email-urile sunt opționale în configurația de bază. Pentru producție, configurează SMTP în `.env`.

---

## 💡 Îmbunătățiri Viitoare

- [ ] Onboarding wizard interactiv (tour ghidat)
- [ ] Video tutoriale integrate
- [ ] Template-uri predefinite pentru diferite industrii
- [ ] Import bulk din Excel/CSV la onboarding
- [ ] Chat support live în aplicație
