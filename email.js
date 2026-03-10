// email.js - Serviciu de trimitere email-uri
const nodemailer = require('nodemailer');

// Configurare transport (SMTP)
// Pentru Gmail: https://support.google.com/accounts/answer/185833
// Pentru alte servicii: configurează host, port, user, pass

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false, // true pentru port 465, false pentru altele
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS, // Pentru Gmail, folosește "App Password"
  },
  tls: {
    rejectUnauthorized: false // Acceptă certificate self-signed
  }
});

// Verifică conexiunea la startup
async function verifyConnection() {
  try {
    await transporter.verify();
    console.log('✅ Email service ready');
    return true;
  } catch (error) {
    console.warn('⚠️ Email service not configured:', error.message);
    console.warn('   Emails will be logged to console instead.');
    return false;
  }
}

// Trimite email de bun venit după signup
async function sendWelcomeEmail({ to, companyName, username, password, plan, companyCode, trialDays = 14 }) {
  const planNames = {
    starter: 'Starter (29.99€/lună)',
    pro: 'Pro (39.99€/lună)',
    enterprise: 'Enterprise (59.99€/lună)'
  };

  const mailOptions = {
    from: `"OpenBill" <${process.env.SMTP_USER || 'support@openbill.ro'}>`,
    to: to,
    subject: `🎉 Cont OpenBill Creat - ${companyName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .credentials { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
    .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Bun venit în OpenBill!</h1>
      <p>Contul tău a fost creat cu succes</p>
    </div>
    
    <div class="content">
      <p>Bună,</p>
      
      <p>Contul pentru <strong>${companyName}</strong> a fost activat în OpenBill.</p>
      
      <div class="credentials">
        <h3>🔑 Date de Autentificare</h3>
        <p><strong>🔗 Link Acces:</strong><br>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login.html">
          ${process.env.FRONTEND_URL || 'http://localhost:3000'}/login.html
        </a></p>
        
        <p><strong>🏢 Companie:</strong> ${companyName} (${companyCode})</p>
        <p><strong>👤 Username:</strong> ${username}</p>
        <p><strong>🔑 Parolă:</strong> ${password}</p>
      </div>
      
      <div class="credentials">
        <h3>💰 Detalii Abonament</h3>
        <p><strong>Plan:</strong> ${planNames[plan] || plan}</p>
        <p><strong>Perioadă de probă:</strong> ${trialDays} zile gratuite</p>
        <p><strong>Expiră:</strong> ${new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toLocaleDateString('ro-RO')}</p>
      </div>
      
      <center>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login.html" class="button">
          Conectează-te Acum
        </a>
      </center>
      
      <p><strong>📚 Resurse utile:</strong></p>
      <ul>
        <li><a href="#">Ghid de început rapid</a></li>
        <li><a href="#">Video tutoriale</a></li>
        <li><a href="#">Documentație</a></li>
      </ul>
      
      <p><strong>⚠️ Important:</strong> Schimbă parola la primul login pentru securitate.</p>
      
      <p>Dacă ai întrebări, răspunde la acest email sau contactează-ne la 
      <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@openbill.ro'}">
        ${process.env.SUPPORT_EMAIL || 'support@openbill.ro'}
      </a>.</p>
      
      <p>Succes!<br>Echipa OpenBill</p>
    </div>
    
    <div class="footer">
      <p>Acest email a fost trimis automat. Nu răspunde la acest mesaj.</p>
      <p>&copy; 2024 OpenBill. Toate drepturile rezervate.</p>
    </div>
  </div>
</body>
</html>
    `,
    text: `
Bun venit în OpenBill!

Contul pentru ${companyName} a fost creat cu succes.

DATE DE AUTENTIFICARE:
- Link: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/login.html
- Username: ${username}
- Parolă: ${password}

DETALII ABONAMENT:
- Plan: ${planNames[plan] || plan}
- Perioadă de probă: ${trialDays} zile gratuite

IMPORTANT: Schimbă parola la primul login!

Suport: ${process.env.SUPPORT_EMAIL || 'support@openbill.ro'}
    `
  };

  try {
    // Încearcă să trimită email real
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const info = await transporter.sendMail(mailOptions);
      console.log('📧 Email trimis:', info.messageId);
      return { success: true, messageId: info.messageId };
    } else {
      // Fallback: loghează în consolă
      console.log('\n' + '='.repeat(60));
      console.log('📧 EMAIL (Mod Dezvoltare - SMTP neconfigurat)');
      console.log('='.repeat(60));
      console.log('Către:', to);
      console.log('Subiect:', mailOptions.subject);
      console.log('\nConținut text:');
      console.log(mailOptions.text);
      console.log('='.repeat(60) + '\n');
      return { success: true, simulated: true };
    }
  } catch (error) {
    console.error('❌ Eroare trimitere email:', error.message);
    // Nu returnăm eroare - signup-ul a mers, doar emailul nu
    return { success: false, error: error.message };
  }
}

// Funcție generică de trimitere email
async function sendMail({ to, subject, html, text }) {
  const mailOptions = {
    from: `"OpenBill" <${process.env.SMTP_USER || 'support@openbill.ro'}>`,
    to: to,
    subject: subject,
    html: html,
    text: text || ''
  };

  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const info = await transporter.sendMail(mailOptions);
      console.log('📧 Email trimis:', info.messageId);
      return { success: true, messageId: info.messageId };
    } else {
      console.log('\n' + '='.repeat(60));
      console.log('📧 EMAIL (Mod Dezvoltare - SMTP neconfigurat)');
      console.log('='.repeat(60));
      console.log('Catre:', to);
      console.log('Subiect:', subject);
      console.log('=', '='.repeat(60) + '\n');
      return { success: true, simulated: true };
    }
  } catch (error) {
    console.error('❌ Eroare trimitere email:', error.message);
    return { success: false, error: error.message };
  }
}

// Email de reminder pentru expirare trial
async function sendTrialReminderEmail({ to, companyName, daysLeft, plan, paymentLink }) {
  const mailOptions = {
    from: `"OpenBill" <${process.env.SMTP_USER || 'support@openbill.ro'}>`,
    to: to,
    subject: `⏰ Perioada de probă expiră în ${daysLeft} zile`,
    html: `
      <h1>⏰ Nu uita să activezi abonamentul!</h1>
      <p>Bună,</p>
      <p>Perioada de probă pentru <strong>${companyName}</strong> expiră în <strong>${daysLeft} zile</strong>.</p>
      <p>Pentru a continua să folosești OpenBill, trebuie să activezi abonamentul.</p>
      <p><strong>Plan selectat:</strong> ${plan}</p>
      <a href="${paymentLink}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0;">Activează Abonamentul</a>
      <p>Dacă nu activezi abonamentul, contul va fi suspendat, dar datele rămân salvate 30 de zile.</p>
      <p>Întrebări? Contactează-ne la ${process.env.SUPPORT_EMAIL || 'support@openbill.ro'}</p>
    `
  };

  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const info = await transporter.sendMail(mailOptions);
      console.log('📧 Email reminder trimis:', info.messageId);
      return { success: true };
    } else {
      console.log('📧 Email reminder (simulat):', to, '-', daysLeft, 'zile rămase');
      return { success: true, simulated: true };
    }
  } catch (error) {
    console.error('❌ Eroare trimitere reminder:', error.message);
    return { success: false };
  }
}

module.exports = {
  verifyConnection,
  sendWelcomeEmail,
  sendTrialReminderEmail,
  sendMail,
  sendMail
};
