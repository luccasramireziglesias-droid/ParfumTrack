// Email templates y envío para mp-webhook
import { log } from './_shared.js';

function sanitizeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export async function sendEmail(env, to, template, data) {
  if (!env.BREVO_API_KEY) { log('warn', 'mp-webhook', 'BREVO_API_KEY not configured'); return; }
  const tpl = EMAIL_TEMPLATES[template];
  if (!tpl) { log('warn', 'mp-webhook', 'unknown template', { template }); return; }

  const appUrl = env.APP_URL || 'https://parfumtrack.luccasramireziglesias.workers.dev';
  const safeData = {};
  for (const [k, v] of Object.entries({ ...data, appUrl })) {
    safeData[k] = typeof v === 'string' ? sanitizeHtml(v) : v;
  }
  const { subject, html, text } = tpl(safeData);
  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: env.FROM_NAME || 'Parfum Track', email: env.FROM_EMAIL || 'parfumtrack@gmail.com' },
        to: [{ email: to }],
        subject, htmlContent: html, textContent: text,
        headers: {
          'List-Unsubscribe': '<mailto:parfumtrack@gmail.com?subject=unsubscribe>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (resp.ok) log('info', 'mp-webhook', 'email sent', { template });
    else log('error', 'mp-webhook', 'Brevo error', { status: resp.status });
  } catch (e) {
    log('error', 'mp-webhook', 'email send failed', { error: e.message });
  }
}

const EMAIL_TEMPLATES = {
  subscription_activated: ({ code, expiresAt, appUrl }) => ({
    subject: '🌸 Tu plan Basico Pro esta activo — aca esta tu codigo',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="font-size:36px;margin-bottom:8px;">🌸</div>
    <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
  </div>
  <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(201,168,76,0.3);">
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">¡Tu plan esta activo! ✅</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Tu plan <strong style="color:#e8cc7a;">Basico Pro</strong> fue procesado exitosamente.
      Aca esta tu codigo de activacion:
    </p>
    <div style="background:#13132a;border:1.5px solid #e8cc7a;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="color:#7a7870;font-size:11px;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">Tu codigo</p>
      <p style="color:#e8cc7a;font-size:26px;font-weight:800;letter-spacing:3px;margin:0;font-family:'Courier New',monospace;">${code}</p>
      <p style="color:#7a7870;font-size:11px;margin:8px 0 0;">Ingresalo en la app → Ajustes → Licencia</p>
    </div>
    <p style="color:#b8b4a8;font-size:13px;line-height:1.8;margin:0 0 20px;">
      ✓ Valido hasta: <strong style="color:#f0eee8;">${expiresAt}</strong><br>
      ✓ Tu plan esta activo hasta ${expiresAt}. Cuando se acerque el vencimiento, te avisamos para que decidas si renovar.<br>
      ✓ Podes cancelar cuando quieras escribiendonos por WhatsApp
    </p>
    <a href="${appUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      Abrir Parfum Track y activar →
    </a>
  </div>
  <p style="color:#7a7870;font-size:11px;text-align:center;margin-top:24px;line-height:1.6;">
    Parfum Track — parfumtrack@gmail.com<br>
    <a href="${appUrl}" style="color:#c9a84c;">${appUrl}</a><br>
    Si no queres recibir mas emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
    text: `¡Tu plan Basico Pro de Parfum Track esta activo! Tu codigo: ${code}. Ingresalo en Ajustes → Licencia. Valido hasta: ${expiresAt}. Abri la app: ${appUrl} | Parfum Track — parfumtrack@gmail.com | Si no queres recibir mas emails, escribinos a parfumtrack@gmail.com`,
  }),

  subscription_renewed: ({ expiresAt, appUrl }) => ({
    subject: '✅ Tu plan de Parfum Track fue renovado',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="font-size:36px;margin-bottom:8px;">🌸</div>
    <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
  </div>
  <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(112,201,160,0.3);">
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">Renovacion exitosa ✓</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Tu plan <strong style="color:#e8cc7a;">Basico Pro</strong> fue renovado exitosamente. Seguis con acceso completo.
    </p>
    <div style="background:rgba(112,201,160,0.1);border:0.5px solid rgba(112,201,160,0.3);border-radius:10px;padding:14px;margin-bottom:20px;">
      <p style="color:#70c9a0;margin:0;">✓ Activo hasta: <strong>${expiresAt}</strong></p>
    </div>
    <a href="${appUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      Abrir Parfum Track →
    </a>
  </div>
  <p style="color:#7a7870;font-size:11px;text-align:center;margin-top:24px;line-height:1.6;">
    Parfum Track — parfumtrack@gmail.com<br>
    <a href="${appUrl}" style="color:#c9a84c;">${appUrl}</a><br>
    Si no queres recibir mas emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
    text: `Tu plan Basico Pro de Parfum Track fue renovado exitosamente. Activo hasta: ${expiresAt}. ${appUrl} | Parfum Track — parfumtrack@gmail.com | Si no queres recibir mas emails, escribinos a parfumtrack@gmail.com`,
  }),

  payment_failed: ({ appUrl } = {}) => ({
    subject: '⚠ Problema con el pago de Parfum Track',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="font-size:36px;margin-bottom:8px;">🌸</div>
    <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
  </div>
  <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(224,112,112,0.3);">
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">Problema con tu pago ⚠</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
      No pudimos procesar tu pago. Si queres renovar tu plan, podes hacerlo desde la app o escribinos por WhatsApp.
    </p>
    <a href="https://wa.me/59894466577?text=Hola!%20Tuve%20un%20problema%20con%20el%20pago%20de%20Parfum%20Track%20🌸"
       style="display:block;text-align:center;background:linear-gradient(135deg,#25d366,#1da851);color:#fff;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      📲 Escribirnos por WhatsApp
    </a>
  </div>
  <p style="color:#7a7870;font-size:11px;text-align:center;margin-top:24px;line-height:1.6;">
    Parfum Track — parfumtrack@gmail.com<br>
    <a href="${appUrl}" style="color:#c9a84c;">${appUrl}</a><br>
    Si no queres recibir mas emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
    text: `No pudimos procesar tu pago. Si queres renovar tu plan, podes hacerlo desde la app o escribinos por WhatsApp: https://wa.me/59894466577 | Parfum Track — parfumtrack@gmail.com | Si no queres recibir mas emails, escribinos a parfumtrack@gmail.com`,
  }),

  subscription_cancelled: ({ expiresAt, appUrl }) => ({
    subject: 'Tu plan de Parfum Track fue cancelado',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="font-size:36px;margin-bottom:8px;">🌸</div>
    <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
  </div>
  <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(255,255,255,0.1);">
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">Plan cancelado</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Tu plan Basico Pro fue cancelado. Seguis teniendo acceso hasta
      <strong style="color:#e8cc7a;">${expiresAt}</strong>, despues la app pasa automaticamente al plan Free.
    </p>
    <p style="color:#b8b4a8;font-size:14px;margin:0 0 20px;">
      Tus datos estan guardados en tu dispositivo y nunca se borran. Podes reactivar tu plan cuando quieras.
    </p>
    <a href="https://wa.me/59894466577?text=Hola!%20Quiero%20reactivar%20mi%20plan%20de%20Parfum%20Track%20🌸"
       style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      Reactivar plan →
    </a>
  </div>
  <p style="color:#7a7870;font-size:11px;text-align:center;margin-top:24px;line-height:1.6;">
    Parfum Track — parfumtrack@gmail.com<br>
    <a href="${appUrl}" style="color:#c9a84c;">${appUrl}</a><br>
    Si no queres recibir mas emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
    text: `Tu plan de Parfum Track fue cancelado. Seguis con acceso hasta ${expiresAt}. Despues pasas al plan Free. Podes reactivar cuando quieras. ${appUrl} | Parfum Track — parfumtrack@gmail.com | Si no queres recibir mas emails, escribinos a parfumtrack@gmail.com`,
  }),

  owner_payment_notification: ({ clientEmail, code, plan, expiresAt, paymentId, type }) => {
    const isNew     = type === 'new';
    const planLabel = plan === 'basic_annual' ? 'Anual (95.88 USD)' : 'Mensual (9.99 USD)';
    const title     = isNew ? '💰 Nuevo pago recibido' : '🔄 Renovacion recibida';
    return {
      subject: `${title} — ${clientEmail}`,
      html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:24px;">
  <div style="background:#1e1e35;border:1px solid rgba(201,168,76,0.3);border-radius:14px;padding:24px;">
    <h2 style="color:#e8cc7a;font-size:18px;font-weight:700;margin:0 0 16px;">${title}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="color:#7a7870;padding:6px 0;width:120px;">Cliente</td><td style="color:#f0eee8;font-weight:600;">${clientEmail}</td></tr>
      <tr><td style="color:#7a7870;padding:6px 0;">Plan</td><td style="color:#f0eee8;">${planLabel}</td></tr>
      <tr><td style="color:#7a7870;padding:6px 0;">Licencia</td><td style="color:#e8cc7a;font-family:monospace;font-weight:700;letter-spacing:1px;">${code}</td></tr>
      <tr><td style="color:#7a7870;padding:6px 0;">Vence</td><td style="color:#f0eee8;">${expiresAt}</td></tr>
      <tr><td style="color:#7a7870;padding:6px 0;">Payment ID</td><td style="color:#b8b4a8;font-size:12px;">${paymentId}</td></tr>
      <tr><td style="color:#7a7870;padding:6px 0;">Tipo</td><td style="color:${isNew ? '#70c9a0' : '#c9a84c'};font-weight:700;">${isNew ? 'NUEVA LICENCIA' : 'RENOVACION'}</td></tr>
    </table>
  </div>
  <p style="color:#7a7870;font-size:11px;text-align:center;margin-top:16px;line-height:1.6;">
    Parfum Track — parfumtrack@gmail.com<br>
    Notificacion automatica<br>
    Si no queres recibir mas emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
      text: `${title}\nCliente: ${clientEmail}\nPlan: ${planLabel}\nLicencia: ${code}\nVence: ${expiresAt}\nPayment ID: ${paymentId}\nTipo: ${isNew ? 'NUEVA LICENCIA' : 'RENOVACION'}`,
    };
  },
};
