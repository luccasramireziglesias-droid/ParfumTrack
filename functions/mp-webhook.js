// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /mp-webhook
// POST /mp-webhook  — Webhooks de Mercado Pago (pagos y suscripciones)
// GET  /mp-webhook  — Verificación de endpoint por MP (devuelve 200)
//
// Secrets requeridos (Cloudflare Dashboard → Workers → Settings):
//   MP_ACCESS_TOKEN    — Access token de producción MP
//   MP_WEBHOOK_SECRET  — Secreto para verificar firma X-Signature de MP
//   BREVO_API_KEY      — Para enviar emails de activación/renovación
//   FROM_EMAIL / FROM_NAME — Remitente de emails
//
// KV keys usadas:
//   pending_sub:{preapprovalId}      → JSON { email, plan }  (TTL 1h)
//   mp_sub:{preapprovalId}           → licenseCode           (TTL 3 años)
//   email_license:{sha256(email)}    → licenseCode           (TTL 3 años)
//   webhook_processed:{type}:{id}    → "1"                   (TTL 30 días)
//   license:{code}                   → JSON licenseData
// ══════════════════════════════════════════════════════════════

// APP_URL se configura en Cloudflare Dashboard → Workers → Settings → Variables
// Debe apuntar a la URL real del Worker (ej: https://parfumtrack.workers.dev)

// MP verifica el endpoint con un GET antes de empezar a enviar webhooks
export async function onRequestGet() {
  return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function onRequestPost(context) {
  const { request, env, ctx } = context;

  const url        = new URL(request.url);
  const xSig       = request.headers.get('x-signature');
  const bodyText   = await request.text();

  // 1. Verificar firma MP — fail closed: si el secreto no está configurado, rechazar siempre.
  if (!env.MP_WEBHOOK_SECRET) {
    console.error('[mp-webhook] FATAL: MP_WEBHOOK_SECRET no configurado — rechazando webhook');
    return jsonResp({ ok: false, error: 'server_misconfigured' }, 500);
  }
  if (!xSig) {
    console.warn('[mp-webhook] Sin x-signature — rechazando');
    return jsonResp({ ok: false, error: 'missing_signature' }, 401);
  }
  const sigError = await verifyMPSignatureFromText(bodyText, xSig, url, env, request);
  if (sigError) {
    console.warn('[mp-webhook] Firma inválida:', sigError);
    return jsonResp({ ok: false, error: 'invalid_signature' }, 401);
  }

  // 2. Parsear tipo e ID del evento (JSON nuevo o query params IPN antiguo)
  let type, resourceId;

  if (bodyText.trim().startsWith('{')) {
    try {
      const body = JSON.parse(bodyText);
      type       = body.type;
      resourceId = body.data?.id?.toString();
    } catch { /* */ }
  }
  // Fallback a query params IPN: ?type=payment&data.id=123 o ?topic=payment&id=123
  if (!type)       type       = url.searchParams.get('type') || url.searchParams.get('topic');
  if (!resourceId) resourceId = url.searchParams.get('data.id') || url.searchParams.get('id');

  console.log(`[mp-webhook] type=${type} id=${resourceId}`);

  // Sin datos útiles (posible ping de MP al configurar webhook)
  if (!type || !resourceId) return jsonResp({ ok: true });

  if (!env.PT_LICENSES) {
    console.error('[mp-webhook] FATAL: PT_LICENSES KV no disponible — retornando 500 para que MP reintente');
    return jsonResp({ ok: false, error: 'kv_unavailable' }, 500);
  }

  // 3. Idempotencia: ignorar si ya fue procesado o está en proceso
  const idKey = `webhook_processed:${type}:${resourceId}`;
  const already = await env.PT_LICENSES.get(idKey);
  if (already === 'done' || already === 'processing') {
    console.log('[mp-webhook] Ya procesado/en proceso:', idKey, already);
    return jsonResp({ ok: true });
  }

  // Marcar como "en proceso" con TTL corto para evitar ejecuciones simultáneas
  await env.PT_LICENSES.put(idKey, 'processing', { expirationTtl: 300 });

  // 4. Procesar en background; marcar 'done' solo si tiene éxito
  ctx.waitUntil(processEvent({ type, resourceId, env, idKey }));

  return jsonResp({ ok: true });
}

// ── Verificación de firma MP ──────────────────────────────────────

async function verifyMPSignatureFromText(bodyText, xSignature, url, env, request) {
  const secret = env.MP_WEBHOOK_SECRET;
  if (!secret) return 'MP_WEBHOOK_SECRET no configurado';

  const xRequestId = request.headers.get('x-request-id') || '';
  const dataId     = url.searchParams.get('id') || '';

  const parts = {};
  for (const part of xSignature.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k && v) parts[k.trim()] = v.trim();
  }
  const { ts, v1 } = parts;
  if (!ts || !v1) return 'Falta ts o v1 en x-signature';

  if (Math.abs(Date.now() - parseInt(ts, 10) * 1000) > 300_000) {
    return 'Timestamp muy viejo (posible replay attack)';
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(manifest));
  const computed = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  if (computed.length !== v1.length) return 'Longitud de firma incorrecta';
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
  if (diff !== 0) return 'Firma incorrecta';

  return null;
}

// ── Dispatcher de eventos ─────────────────────────────────────────

async function processEvent({ type, resourceId, env, idKey }) {
  try {
    if (type === 'payment') {
      await handlePaymentEvent(resourceId, env);
    } else {
      console.log(`[mp-webhook] Tipo no manejado: ${type}`);
    }
    // Marcar como procesado con éxito (TTL 30 días)
    await env.PT_LICENSES.put(idKey, 'done', { expirationTtl: 2592000 });
  } catch (e) {
    console.error(`[mp-webhook] Error procesando ${type}:${resourceId}:`, e.message, e.stack);
    // Eliminar la marca 'processing' para permitir retry en el próximo webhook de MP
    await env.PT_LICENSES.delete(idKey).catch(() => {});
    // Notificar al dueño del error para que pueda intervenir manualmente
    const ownerEmail = env.OWNER_EMAIL || env.FROM_EMAIL;
    if (ownerEmail && env.BREVO_API_KEY) {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
        body: JSON.stringify({
          sender: { name: env.FROM_NAME || 'Parfum Track', email: env.FROM_EMAIL || 'hola@parfumtrack.com' },
          to: [{ email: ownerEmail }],
          subject: `⚠ Error en webhook MP — ${type}:${resourceId}`,
          textContent: `Error procesando pago.\nTipo: ${type}\nID: ${resourceId}\nError: ${e.message}\n\nRevisar Cloudflare Workers Logs para más detalles.`,
        }),
      }).catch(() => {});
    }
  }
}

// ── Evento de pago ────────────────────────────────────────────────

async function handlePaymentEvent(paymentId, env) {
  if (!env.MP_ACCESS_TOKEN) { console.error('[mp-webhook] MP_ACCESS_TOKEN falta'); return; }

  const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  if (!resp.ok) {
    console.error(`[mp-webhook] Error obteniendo pago ${paymentId}:`, resp.status, await resp.text());
    return;
  }

  const payment = await resp.json();
  console.log(`[mp-webhook] Pago ${paymentId}: status=${payment.status}`);
  await handleSinglePayment(paymentId, payment, env);
}

// ── Pago único via Checkout Pro ───────────────────────────────────

async function handleSinglePayment(paymentId, payment, env) {
  if (payment.status !== 'approved') {
    console.log(`[mp-webhook] Pago único no aprobado: status=${payment.status}`);
    return;
  }

  // Obtener email y plan desde external_reference
  let email, plan;
  if (payment.external_reference) {
    try {
      const ref = JSON.parse(payment.external_reference);
      email = ref.email;
      plan  = ref.plan || 'monthly';
    } catch { /* JSON inválido — usar fallback */ }
  }
  if (!email) email = payment.payer?.email;
  if (!plan)  plan  = 'monthly';

  if (!email) {
    console.error('[mp-webhook] Pago único sin email, paymentId:', paymentId);
    return;
  }

  // Validar monto contra el esperado según el plan
  const expectedAmount = parseFloat(plan === 'annual'
    ? (env.MP_AMOUNT_ANNUAL  || '95.88')
    : (env.MP_AMOUNT_MONTHLY || '9.99'));
  const paidAmount = parseFloat(payment.transaction_amount || 0);
  if (Math.abs(paidAmount - expectedAmount) > 0.01) {
    console.error(`[mp-webhook] Monto incorrecto: pagado=${paidAmount} esperado=${expectedAmount} plan=${plan} paymentId=${paymentId}`);
    return;
  }

  const TTL_3Y    = 94608000;
  const emailHash = await hashEmail(email);

  // Secondary idempotency: check if this payment already created a license
  const existingPayLicense = await env.PT_LICENSES.get(`mp_pay:${paymentId}`);
  if (existingPayLicense) {
    console.log(`[mp-webhook] Payment ${paymentId} already processed — license: ${existingPayLicense}`);
    return;
  }

  // Si ya tiene licencia activa, renovar
  const existingCode = await env.PT_LICENSES.get(`email_license:${emailHash}`);
  if (existingCode) {
    const licRaw = await env.PT_LICENSES.get(`license:${existingCode}`);
    if (licRaw) {
      const lic      = JSON.parse(licRaw);
      const isAnnual = plan === 'annual' || lic.plan === 'basic_annual';
      const base     = new Date(Math.max(Date.now(), new Date(lic.expiresAt || Date.now()).getTime()));
      base.setDate(base.getDate() + (isAnnual ? 366 : 31));
      const expiresAt = base.toISOString().split('T')[0];

      lic.expiresAt   = expiresAt;
      lic.renewsAt    = expiresAt;
      lic.status      = 'active';
      lic.suspendedAt = null;

      await env.PT_LICENSES.put(`license:${existingCode}`, JSON.stringify(lic));
      await env.PT_LICENSES.put(`mp_pay:${paymentId}`, existingCode, { expirationTtl: TTL_3Y });
      console.log(`[mp-webhook] Licencia renovada (pago único): ${existingCode} hasta ${expiresAt}`);

      const ownerEmail = env.OWNER_EMAIL || env.FROM_EMAIL;
      if (lic.clientEmail) {
        await sendEmail(env, lic.clientEmail, 'subscription_renewed', { expiresAt });
      }
      if (ownerEmail) {
        await sendEmail(env, ownerEmail, 'owner_payment_notification', {
          clientEmail: lic.clientEmail,
          code:        existingCode,
          plan:        lic.plan,
          expiresAt,
          paymentId,
          type:        'renewal',
        });
      }
      return;
    }
  }

  // Primera licencia para este email
  const code     = await generateLicenseCode(env);
  const isAnnual = plan === 'annual';
  const now      = new Date();
  const expiry   = new Date(now);
  expiry.setDate(expiry.getDate() + (isAnnual ? 366 : 31));
  const expiresAt = expiry.toISOString().split('T')[0];

  const licenseData = {
    clientName:      email.split('@')[0],
    clientEmail:     email,
    expiresAt,
    maxUses:         null,
    usedCount:       0,
    createdAt:       now.toISOString().split('T')[0],
    lastActivatedAt: null,
    plan:            isAnnual ? 'basic_annual' : 'basic_monthly',
    status:          'active',
    mpPaymentId:     paymentId,
    renewsAt:        expiresAt,
    suspendedAt:     null,
    cancelledAt:     null,
  };

  await env.PT_LICENSES.put(`license:${code}`, JSON.stringify(licenseData));
  await env.PT_LICENSES.put(`email_license:${emailHash}`, code, { expirationTtl: TTL_3Y });
  await env.PT_LICENSES.put(`mp_pay:${paymentId}`, code, { expirationTtl: TTL_3Y });

  console.log(`[mp-webhook] Licencia creada (pago único): ${code} para ${email.split('@')[0].slice(0,2)}***@${email.split('@')[1]}`);
  await sendEmail(env, email, 'subscription_activated', { code, expiresAt });

  const ownerEmail = env.OWNER_EMAIL || env.FROM_EMAIL;
  if (ownerEmail) {
    await sendEmail(env, ownerEmail, 'owner_payment_notification', {
      clientEmail: email,
      code,
      plan:     isAnnual ? 'basic_annual' : 'basic_monthly',
      expiresAt,
      paymentId,
      type:     'new',
    });
  }
}

// ── Utilidades ────────────────────────────────────────────────────

async function generateLicenseCode(env) {
  const toHex = arr => Array.from(arr).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  for (let i = 0; i < 10; i++) {
    const code = `PT-${toHex(crypto.getRandomValues(new Uint8Array(3)))}-${toHex(crypto.getRandomValues(new Uint8Array(3)))}`;
    if (!(await env.PT_LICENSES.get(`license:${code}`))) return code;
  }
  throw new Error('No se pudo generar código único tras 10 intentos');
}

async function hashEmail(email) {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Envía email directo via Brevo (sin pasar por /send-email para evitar rate limit)
async function sendEmail(env, to, template, data) {
  if (!env.BREVO_API_KEY) { console.warn('[mp-webhook] BREVO_API_KEY no configurado'); return; }
  const tpl = EMAIL_TEMPLATES[template];
  if (!tpl) { console.warn('[mp-webhook] Template desconocido:', template); return; }

  const appUrl = env.APP_URL || 'https://parfumtrack.pages.dev';
  const { subject, html, text } = tpl({ ...data, appUrl });
  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: env.FROM_NAME || 'Parfum Track', email: env.FROM_EMAIL || 'hola@parfumtrack.com' },
        to: [{ email: to }],
        subject, htmlContent: html, textContent: text,
      }),
    });
    if (resp.ok) console.log(`[mp-webhook] Email "${template}" → ${to.split('@')[0].slice(0,2)}***@${to.split('@')[1]}`);
    else console.error('[mp-webhook] Error Brevo:', resp.status, await resp.text());
  } catch (e) {
    console.error('[mp-webhook] Error enviando email:', e.message);
  }
}

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Email templates ───────────────────────────────────────────────

const EMAIL_TEMPLATES = {
  subscription_activated: ({ code, expiresAt, appUrl }) => ({
    subject: '🌸 Tu plan Básico Pro está activo — acá está tu código',
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
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">¡Tu plan está activo! ✅</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Tu plan <strong style="color:#e8cc7a;">Básico Pro</strong> fue procesado exitosamente.
      Acá está tu código de activación:
    </p>
    <div style="background:#13132a;border:1.5px solid #e8cc7a;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="color:#7a7870;font-size:11px;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">Tu código</p>
      <p style="color:#e8cc7a;font-size:26px;font-weight:800;letter-spacing:3px;margin:0;font-family:'Courier New',monospace;">${code}</p>
      <p style="color:#7a7870;font-size:11px;margin:8px 0 0;">Ingresalo en la app → Ajustes → Licencia</p>
    </div>
    <p style="color:#b8b4a8;font-size:13px;line-height:1.8;margin:0 0 20px;">
      ✓ Válido hasta: <strong style="color:#f0eee8;">${expiresAt}</strong><br>
      ✓ Tu plan está activo hasta ${expiresAt}. Cuando se acerque el vencimiento, te avisamos para que decidas si renovar.<br>
      ✓ Podés cancelar cuando querás escribiéndonos por WhatsApp
    </p>
    <a href="${appUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      Abrir Parfum Track y activar →
    </a>
  </div>
  <p style="color:#7a7870;font-size:11px;text-align:center;margin-top:24px;line-height:1.6;">
    Parfum Track — parfumtrack@gmail.com<br>
    <a href="${appUrl}" style="color:#c9a84c;">${appUrl}</a><br>
    Si no querés recibir más emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
    text: `¡Tu plan Básico Pro de Parfum Track está activo! Tu código: ${code}. Ingresalo en Ajustes → Licencia. Válido hasta: ${expiresAt}. Abrí la app: ${appUrl} | Parfum Track — parfumtrack@gmail.com | Si no querés recibir más emails, escribinos a parfumtrack@gmail.com`,
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
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">Renovación exitosa ✓</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Tu plan <strong style="color:#e8cc7a;">Básico Pro</strong> fue renovado exitosamente. Seguís con acceso completo.
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
    Si no querés recibir más emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
    text: `Tu plan Básico Pro de Parfum Track fue renovado exitosamente. Activo hasta: ${expiresAt}. ${appUrl} | Parfum Track — parfumtrack@gmail.com | Si no querés recibir más emails, escribinos a parfumtrack@gmail.com`,
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
      No pudimos procesar tu pago. Si querés renovar tu plan, podés hacerlo desde la app o escribinos por WhatsApp.
    </p>
    <a href="https://wa.me/59894466577?text=Hola!%20Tuve%20un%20problema%20con%20el%20pago%20de%20Parfum%20Track%20🌸"
       style="display:block;text-align:center;background:linear-gradient(135deg,#25d366,#1da851);color:#fff;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      📲 Escribirnos por WhatsApp
    </a>
  </div>
  <p style="color:#7a7870;font-size:11px;text-align:center;margin-top:24px;line-height:1.6;">
    Parfum Track — parfumtrack@gmail.com<br>
    <a href="${appUrl}" style="color:#c9a84c;">${appUrl}</a><br>
    Si no querés recibir más emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
    text: `No pudimos procesar tu pago. Si querés renovar tu plan, podés hacerlo desde la app o escribinos por WhatsApp: https://wa.me/59894466577 | Parfum Track — parfumtrack@gmail.com | Si no querés recibir más emails, escribinos a parfumtrack@gmail.com`,
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
      Tu plan Básico Pro fue cancelado. Seguís teniendo acceso hasta
      <strong style="color:#e8cc7a;">${expiresAt}</strong>, después la app pasa automáticamente al plan Free.
    </p>
    <p style="color:#b8b4a8;font-size:14px;margin:0 0 20px;">
      Tus datos están guardados en tu dispositivo y nunca se borran. Podés reactivar tu plan cuando quieras.
    </p>
    <a href="https://wa.me/59894466577?text=Hola!%20Quiero%20reactivar%20mi%20plan%20de%20Parfum%20Track%20🌸"
       style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      Reactivar plan →
    </a>
  </div>
  <p style="color:#7a7870;font-size:11px;text-align:center;margin-top:24px;line-height:1.6;">
    Parfum Track — parfumtrack@gmail.com<br>
    <a href="${appUrl}" style="color:#c9a84c;">${appUrl}</a><br>
    Si no querés recibir más emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
    text: `Tu plan de Parfum Track fue cancelado. Seguís con acceso hasta ${expiresAt}. Después pasás al plan Free. Podés reactivar cuando quieras. ${appUrl} | Parfum Track — parfumtrack@gmail.com | Si no querés recibir más emails, escribinos a parfumtrack@gmail.com`,
  }),

  owner_payment_notification: ({ clientEmail, code, plan, expiresAt, paymentId, type }) => {
    const isNew     = type === 'new';
    const planLabel = plan === 'basic_annual' ? 'Anual (95.88 USD)' : 'Mensual (9.99 USD)';
    const title     = isNew ? '💰 Nuevo pago recibido' : '🔄 Renovación recibida';
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
      <tr><td style="color:#7a7870;padding:6px 0;">Tipo</td><td style="color:${isNew ? '#70c9a0' : '#c9a84c'};font-weight:700;">${isNew ? 'NUEVA LICENCIA' : 'RENOVACIÓN'}</td></tr>
    </table>
  </div>
  <p style="color:#7a7870;font-size:11px;text-align:center;margin-top:16px;line-height:1.6;">
    Parfum Track — parfumtrack@gmail.com<br>
    Notificación automática<br>
    Si no querés recibir más emails, escribinos a parfumtrack@gmail.com
  </p>
</div>
</body>
</html>`,
      text: `${title}\nCliente: ${clientEmail}\nPlan: ${planLabel}\nLicencia: ${code}\nVence: ${expiresAt}\nPayment ID: ${paymentId}\nTipo: ${isNew ? 'NUEVA LICENCIA' : 'RENOVACIÓN'}`,
    };
  },
};
