// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /stripe-webhook
// POST /stripe-webhook — Webhooks de Stripe (pagos y suscripciones)
//
// Secrets requeridos (Cloudflare Dashboard → Workers → Settings):
//   STRIPE_WEBHOOK_SECRET — Signing secret del webhook en Stripe Dashboard
//   BREVO_API_KEY         — Para enviar emails de activación/renovación
//   FROM_EMAIL / FROM_NAME — Remitente de emails
//
// KV keys usadas:
//   stripe_sub:{subscriptionId}       → licenseCode           (TTL 3 años)
//   email_license:{sha256(email)}     → licenseCode           (TTL 3 años)
//   webhook_processed:stripe:{eventId} → "1"                  (TTL 30 días)
//   license:{code}                    → JSON licenseData
// ══════════════════════════════════════════════════════════════

export async function onRequestPost(context) {
  const { request, env, ctx } = context;

  // Stripe requiere el body raw (sin parsear) para verificar la firma
  const rawBody  = await request.text();
  const sigHeader = request.headers.get('stripe-signature') || '';

  const sigError = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (sigError) {
    console.warn('[stripe-webhook] Firma inválida:', sigError);
    return jsonResp({ ok: false, error: 'invalid_signature' }, 400);
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { return jsonResp({ ok: false, error: 'bad_request' }, 400); }

  console.log(`[stripe-webhook] event=${event.type} id=${event.id}`);

  if (!env.PT_LICENSES) {
    console.error('[stripe-webhook] PT_LICENSES KV no disponible');
    return jsonResp({ ok: true });
  }

  // Idempotencia: ignorar eventos ya procesados
  const idKey  = `webhook_processed:stripe:${event.id}`;
  const already = await env.PT_LICENSES.get(idKey);
  if (already) {
    console.log('[stripe-webhook] Ya procesado:', event.id);
    return jsonResp({ ok: true });
  }
  await env.PT_LICENSES.put(idKey, '1', { expirationTtl: 2592000 }); // 30 días

  ctx.waitUntil(processEvent(event, env));

  return jsonResp({ ok: true });
}

// ── Verificación de firma Stripe ──────────────────────────────────

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!secret) {
    console.warn('[stripe-webhook] STRIPE_WEBHOOK_SECRET no configurado — saltando verificación');
    return null; // En desarrollo permite sin firma; en producción SIEMPRE configurar el secret
  }
  if (!sigHeader) return 'Header stripe-signature ausente';

  let timestamp = '';
  const v1Sigs = [];
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') v1Sigs.push(v);
  }

  if (!timestamp || v1Sigs.length === 0) return 'stripe-signature malformado';

  // Anti-replay: máximo 5 minutos
  if (Math.abs(Date.now() - parseInt(timestamp, 10) * 1000) > 300_000) {
    return 'Timestamp muy viejo (posible replay)';
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const computed = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const matches = v1Sigs.some(v1 => {
    if (computed.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  });

  return matches ? null : 'Firma incorrecta';
}

// ── Dispatcher de eventos ─────────────────────────────────────────

async function processEvent(event, env) {
  try {
    const obj = event.data?.object;
    if (!obj) return;

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(obj, env);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(obj, env);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(obj, env);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(obj, env);
        break;
      default:
        console.log(`[stripe-webhook] Tipo no manejado: ${event.type}`);
    }
  } catch (e) {
    console.error(`[stripe-webhook] Error procesando ${event.type}:`, e.message, e.stack);
  }
}

// ── checkout.session.completed → crear licencia ───────────────────

async function handleCheckoutCompleted(session, env) {
  if (session.mode !== 'subscription') return;

  const email          = session.customer_email || session.metadata?.email;
  const plan           = session.metadata?.plan || 'monthly';
  const subscriptionId = session.subscription;

  if (!email) {
    console.error('[stripe-webhook] checkout.session.completed sin email:', session.id);
    return;
  }
  if (!subscriptionId) {
    console.error('[stripe-webhook] checkout.session.completed sin subscription:', session.id);
    return;
  }

  // Evitar crear licencia duplicada si ya existe para esta suscripción
  const existing = await env.PT_LICENSES.get(`stripe_sub:${subscriptionId}`);
  if (existing) {
    console.log(`[stripe-webhook] Licencia ya existe para sub ${subscriptionId}: ${existing}`);
    return;
  }

  const code = await generateLicenseCode(env);

  const now      = new Date();
  const isAnnual = plan === 'annual';
  const expiry   = new Date(now);
  expiry.setDate(expiry.getDate() + (isAnnual ? 366 : 31));
  const expiresAt = expiry.toISOString().split('T')[0];

  const licenseData = {
    clientName:       email.split('@')[0],
    clientEmail:      email,
    expiresAt,
    maxUses:          null,
    usedCount:        0,
    createdAt:        now.toISOString().split('T')[0],
    lastActivatedAt:  null,
    plan:             isAnnual ? 'basic_annual' : 'basic_monthly',
    status:           'active',
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: session.customer,
    renewsAt:         expiresAt,
    suspendedAt:      null,
    cancelledAt:      null,
  };

  const TTL_3Y    = 94608000;
  const emailHash = await hashEmail(email);

  await env.PT_LICENSES.put(`license:${code}`, JSON.stringify(licenseData));
  await env.PT_LICENSES.put(`stripe_sub:${subscriptionId}`, code, { expirationTtl: TTL_3Y });
  await env.PT_LICENSES.put(`email_license:${emailHash}`, code, { expirationTtl: TTL_3Y });

  console.log(`[stripe-webhook] Licencia creada: ${code} para ${email} (${plan})`);
  await sendEmail(env, email, 'subscription_activated', { code, expiresAt });
}

// ── invoice.paid → renovar licencia ──────────────────────────────

async function handleInvoicePaid(invoice, env) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  // El primer invoice coincide con checkout.session.completed; ignorar si billingReason es subscription_create
  if (invoice.billing_reason === 'subscription_create') {
    console.log('[stripe-webhook] invoice.paid de tipo subscription_create — manejado por checkout.session.completed');
    return;
  }

  const code = await env.PT_LICENSES.get(`stripe_sub:${subscriptionId}`);
  if (!code) {
    console.log('[stripe-webhook] invoice.paid sin licencia asociada:', subscriptionId);
    return;
  }

  const licRaw = await env.PT_LICENSES.get(`license:${code}`);
  if (!licRaw) { console.error('[stripe-webhook] Licencia no encontrada:', code); return; }

  const lic      = JSON.parse(licRaw);
  const isAnnual = lic.plan === 'basic_annual';
  const base     = new Date(Math.max(Date.now(), new Date(lic.expiresAt || Date.now()).getTime()));
  base.setDate(base.getDate() + (isAnnual ? 366 : 31));
  const expiresAt = base.toISOString().split('T')[0];

  lic.expiresAt   = expiresAt;
  lic.renewsAt    = expiresAt;
  lic.status      = 'active';
  lic.suspendedAt = null;

  await env.PT_LICENSES.put(`license:${code}`, JSON.stringify(lic));
  console.log(`[stripe-webhook] Renovada: ${code} hasta ${expiresAt}`);

  if (lic.clientEmail) {
    await sendEmail(env, lic.clientEmail, 'subscription_renewed', { expiresAt });
  }
}

// ── invoice.payment_failed → marcar fallo ────────────────────────

async function handleInvoicePaymentFailed(invoice, env) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const code = await env.PT_LICENSES.get(`stripe_sub:${subscriptionId}`);
  if (!code) return;

  const licRaw = await env.PT_LICENSES.get(`license:${code}`);
  if (!licRaw) return;

  const lic  = JSON.parse(licRaw);
  lic.status = 'payment_failed';
  await env.PT_LICENSES.put(`license:${code}`, JSON.stringify(lic));
  console.log(`[stripe-webhook] Pago fallido para: ${code}`);

  if (lic.clientEmail) {
    await sendEmail(env, lic.clientEmail, 'payment_failed', {});
  }
}

// ── customer.subscription.deleted → cancelar ─────────────────────

async function handleSubscriptionDeleted(subscription, env) {
  const subscriptionId = subscription.id;
  if (!subscriptionId) return;

  const code = await env.PT_LICENSES.get(`stripe_sub:${subscriptionId}`);
  if (!code) { console.log('[stripe-webhook] Cancelación sin licencia:', subscriptionId); return; }

  const licRaw = await env.PT_LICENSES.get(`license:${code}`);
  if (!licRaw) return;

  const lic       = JSON.parse(licRaw);
  lic.status      = 'cancelled';
  lic.cancelledAt = new Date().toISOString().split('T')[0];
  await env.PT_LICENSES.put(`license:${code}`, JSON.stringify(lic));
  console.log(`[stripe-webhook] Suscripción cancelada: ${code}`);

  if (lic.clientEmail) {
    await sendEmail(env, lic.clientEmail, 'subscription_cancelled', { expiresAt: lic.expiresAt });
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

async function sendEmail(env, to, template, data) {
  if (!env.BREVO_API_KEY) { console.warn('[stripe-webhook] BREVO_API_KEY no configurado'); return; }
  const tpl = EMAIL_TEMPLATES[template];
  if (!tpl) { console.warn('[stripe-webhook] Template desconocido:', template); return; }

  const appUrl = env.APP_URL || 'https://parfumtrack.luccasramireziglesias.workers.dev';
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
    if (resp.ok) console.log(`[stripe-webhook] Email "${template}" → ${to}`);
    else console.error('[stripe-webhook] Error Brevo:', resp.status, await resp.text());
  } catch (e) {
    console.error('[stripe-webhook] Error enviando email:', e.message);
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
    subject: '✅ Tu plan Básico Pro está activo — acá está tu código',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <img src="${appUrl}/icon-192.png" alt="Parfum Track" style="width:56px;height:56px;border-radius:14px;margin-bottom:8px;">
    <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
  </div>
  <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(201,168,76,0.3);">
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">Tu plan está activo ✅</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Tu suscripción al plan <strong style="color:#e8cc7a;">Básico Pro</strong> fue procesada exitosamente.
      Acá está tu código de activación:
    </p>
    <div style="background:#13132a;border:1.5px solid #e8cc7a;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="color:#7a7870;font-size:11px;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">Tu código</p>
      <p style="color:#e8cc7a;font-size:26px;font-weight:800;letter-spacing:3px;margin:0;font-family:'Courier New',monospace;">${code}</p>
      <p style="color:#7a7870;font-size:11px;margin:8px 0 0;">Ingresalo en la app → Ajustes → Licencia</p>
    </div>
    <p style="color:#b8b4a8;font-size:13px;line-height:1.8;margin:0 0 20px;">
      ✓ Válido hasta: <strong style="color:#f0eee8;">${expiresAt}</strong><br>
      ✓ Se renueva automáticamente cada mes via Stripe<br>
      ✓ Podés cancelar cuando querás desde tu portal de Stripe o escribiéndonos por WhatsApp
    </p>
    <a href="${appUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      Abrir Parfum Track y activar →
    </a>
  </div>
  <p style="color:#4a4848;font-size:12px;text-align:center;margin-top:24px;">
    <a href="${appUrl}" style="color:#c9a84c;">parfumtrack.workers.dev</a>
  </p>
</div>
</body>
</html>`,
    text: `¡Tu plan Básico Pro de Parfum Track está activo! Tu código: ${code}. Ingresalo en Ajustes → Licencia. Válido hasta: ${expiresAt}. Abrí la app: ${appUrl}`,
  }),

  subscription_renewed: ({ expiresAt, appUrl }) => ({
    subject: '✅ Tu suscripción a Parfum Track se renovó',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <img src="${appUrl}/icon-192.png" alt="Parfum Track" style="width:56px;height:56px;border-radius:14px;margin-bottom:8px;">
    <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
  </div>
  <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(112,201,160,0.3);">
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">Renovación exitosa ✓</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Tu plan <strong style="color:#e8cc7a;">Básico Pro</strong> se renovó automáticamente. Seguís con acceso completo.
    </p>
    <div style="background:rgba(112,201,160,0.1);border:0.5px solid rgba(112,201,160,0.3);border-radius:10px;padding:14px;margin-bottom:20px;">
      <p style="color:#70c9a0;margin:0;">✓ Activo hasta: <strong>${expiresAt}</strong></p>
    </div>
    <a href="${appUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      Abrir Parfum Track →
    </a>
  </div>
  <p style="color:#4a4848;font-size:12px;text-align:center;margin-top:24px;">
    <a href="${appUrl}" style="color:#c9a84c;">parfumtrack.workers.dev</a>
  </p>
</div>
</body>
</html>`,
    text: `Tu plan Básico Pro de Parfum Track se renovó. Activo hasta: ${expiresAt}. ${appUrl}`,
  }),

  payment_failed: ({ appUrl } = {}) => ({
    subject: '⚠ Problema con el pago de Parfum Track',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <img src="${appUrl}/icon-192.png" alt="Parfum Track" style="width:56px;height:56px;border-radius:14px;margin-bottom:8px;">
    <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
  </div>
  <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(224,112,112,0.3);">
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">Problema con tu pago ⚠</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
      No pudimos procesar el pago de tu suscripción. Stripe reintentará el cobro automáticamente.
      Tu acceso sigue activo mientras tanto.
    </p>
    <p style="color:#b8b4a8;font-size:14px;margin:0 0 20px;">
      Si querés actualizar tu método de pago, podés hacerlo directamente desde el portal de Stripe
      o escribirnos por WhatsApp.
    </p>
    <a href="https://wa.me/59894466577?text=Hola!%20Tuve%20un%20problema%20con%20el%20pago%20de%20Parfum%20Track"
       style="display:block;text-align:center;background:linear-gradient(135deg,#25d366,#1da851);color:#fff;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      📲 Escribirnos por WhatsApp
    </a>
  </div>
  <p style="color:#4a4848;font-size:12px;text-align:center;margin-top:24px;">
    <a href="${appUrl}" style="color:#c9a84c;">parfumtrack.workers.dev</a>
  </p>
</div>
</body>
</html>`,
    text: `Hubo un problema con el pago de tu suscripción a Parfum Track. Stripe reintentará el cobro. ¿Necesitás ayuda? Escribinos: https://wa.me/59894466577`,
  }),

  subscription_cancelled: ({ expiresAt, appUrl }) => ({
    subject: 'Tu suscripción a Parfum Track fue cancelada',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <img src="${appUrl}/icon-192.png" alt="Parfum Track" style="width:56px;height:56px;border-radius:14px;margin-bottom:8px;">
    <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
  </div>
  <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(255,255,255,0.1);">
    <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">Suscripción cancelada</h2>
    <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Tu suscripción al plan Básico Pro fue cancelada. Seguís teniendo acceso hasta
      <strong style="color:#e8cc7a;">${expiresAt}</strong>, después la app pasa automáticamente al plan Free.
    </p>
    <p style="color:#b8b4a8;font-size:14px;margin:0 0 20px;">
      Tus datos están guardados en tu dispositivo y nunca se borran. Podés reactivar tu suscripción cuando quieras.
    </p>
    <a href="https://wa.me/59894466577?text=Hola!%20Quiero%20reactivar%20mi%20suscripci%C3%B3n%20a%20Parfum%20Track"
       style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
      Reactivar suscripción →
    </a>
  </div>
  <p style="color:#4a4848;font-size:12px;text-align:center;margin-top:24px;">
    <a href="${appUrl}" style="color:#c9a84c;">parfumtrack.workers.dev</a>
  </p>
</div>
</body>
</html>`,
    text: `Tu suscripción a Parfum Track fue cancelada. Seguís con acceso hasta ${expiresAt}. Después pasás al plan Free. Podés reactivar cuando quieras. ${appUrl}`,
  }),
};
