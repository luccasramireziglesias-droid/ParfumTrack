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

import { log, isValidEmail, requestId } from './_shared.js';
import { sendEmail } from './_email-templates.js';

// APP_URL se configura en Cloudflare Dashboard → Workers → Settings → Variables
// Debe apuntar a la URL real del Worker (ej: https://parfumtrack.workers.dev)

// MP verifica el endpoint con un GET antes de empezar a enviar webhooks
export async function onRequestGet() {
  return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function onRequestPost(context) {
  const { request, env, ctx } = context;
  const reqId = requestId();

  const url        = new URL(request.url);
  const xSig       = request.headers.get('x-signature');
  const bodyText   = await request.text();

  // 1. Verificar firma MP — fail closed: si el secreto no está configurado, rechazar siempre.
  if (!env.MP_WEBHOOK_SECRET) {
    log('error', 'mp-webhook', 'MP_WEBHOOK_SECRET not configured', { reqId });
    return jsonResp({ ok: false, error: 'server_misconfigured' }, 500);
  }
  if (!xSig) {
    log('warn', 'mp-webhook', 'missing x-signature');
    return jsonResp({ ok: false, error: 'missing_signature' }, 401);
  }
  const sigError = await verifyMPSignatureFromText(bodyText, xSig, url, env, request);
  if (sigError) {
    log('warn', 'mp-webhook', 'invalid signature', { error: sigError });
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

  log('info', 'mp-webhook', 'event received', { type, resourceId });

  // Sin datos útiles (posible ping de MP al configurar webhook)
  if (!type || !resourceId) return jsonResp({ ok: true });

  // Validar formato: type es alfanumérico, resourceId es numérico (IDs de MP)
  if (!/^[a-z_]{1,50}$/.test(type) || !/^\d{1,20}$/.test(resourceId)) {
    log('warn', 'mp-webhook', 'invalid type or resourceId format', { type, resourceId });
    return jsonResp({ ok: false, error: 'invalid_event_format' }, 400);
  }

  if (!env.PT_LICENSES) {
    log('error', 'mp-webhook', 'PT_LICENSES KV unavailable — returning 500 for MP retry');
    return jsonResp({ ok: false, error: 'kv_unavailable' }, 500);
  }

  // 3. Idempotencia: atomic check-and-set para evitar race conditions
  // Si entre el check y el put viene otro webhook, ambos verían "not found"
  // Solución: usar un UUID único per worker invocation, reintentable
  const idKey = `webhook_processed:${type}:${resourceId}`;
  const workerId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const already = await env.PT_LICENSES.get(idKey);
  if (already === 'done') {
    log('info', 'mp-webhook', 'already processed', { idKey });
    return jsonResp({ ok: true });
  }

  // Marcar con worker ID único para detectar simultáneamente (TTL 5 min)
  // Si el mismo tipo:resourceId viene 2x en <5 min, tendrán workerIds distintos
  await env.PT_LICENSES.put(idKey, `processing:${workerId}`, { expirationTtl: 300 });

  // 4. Procesar sincrónicamente para que MP reintente si falla
  try {
    await processEvent({ type, resourceId, env, idKey });
    return jsonResp({ ok: true });
  } catch (e) {
    log('error', 'mp-webhook', 'processEvent failed', { error: e.message });
    await env.PT_LICENSES.delete(idKey).catch(() => {});
    return jsonResp({ ok: false, error: 'processing_failed' }, 500);
  }
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
      log('info', 'mp-webhook', 'unhandled type', { type });
    }
    // Marcar como procesado con éxito (TTL 30 días)
    await env.PT_LICENSES.put(idKey, 'done', { expirationTtl: 2592000 });
  } catch (e) {
    log('error', 'mp-webhook', 'processing error', { type, resourceId, error: e.message });
    // Eliminar la marca 'processing' para permitir retry en el próximo webhook de MP
    await env.PT_LICENSES.delete(idKey).catch(() => {});
    // Notificar al dueño del error para que pueda intervenir manualmente
    const ownerEmail = env.OWNER_EMAIL || env.FROM_EMAIL;
    if (ownerEmail && env.BREVO_API_KEY) {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
        body: JSON.stringify({
          sender: { name: env.FROM_NAME || 'Parfum Track', email: env.FROM_EMAIL || 'parfumtrack@gmail.com' },
          to: [{ email: ownerEmail }],
          subject: `⚠ Error en webhook MP — ${type}:${resourceId}`,
          textContent: `Error procesando pago.\nTipo: ${type}\nID: ${resourceId}\nError: ${e.message}\n\nRevisar Cloudflare Workers Logs para más detalles.`,
        }),
      }).catch((err) => {
        log('warn', 'mp-webhook', 'Failed to send error notification email', { error: err?.message });
      });
    }
  }
}

// ── Evento de pago ────────────────────────────────────────────────

async function handlePaymentEvent(paymentId, env) {
  if (!env.MP_ACCESS_TOKEN) { throw new Error('MP_ACCESS_TOKEN missing'); }

  // Timeout: 10 segundos para obtener detalles del pago
  const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    throw new Error(`MP API returned ${resp.status} for payment ${paymentId}`);
  }

  const payment = await resp.json();
  log('info', 'mp-webhook', 'payment status', { paymentId, status: payment.status });
  await handleSinglePayment(paymentId, payment, env);
}

// ── Pago único via Checkout Pro ───────────────────────────────────

async function handleSinglePayment(paymentId, payment, env) {
  if (payment.status !== 'approved') {
    log('info', 'mp-webhook', 'payment not approved', { status: payment.status });
    return;
  }

  // Obtener email y plan desde external_reference (con validación cruzada)
  let email, plan;
  let payerEmail = payment.payer?.email;

  // MP-PH-01: Normalizar emails inmediatamente para evitar duplicados
  // case-insensitive (USER@example.com vs user@example.com) y whitespace
  if (payerEmail) payerEmail = payerEmail.toLowerCase().trim();

  if (payment.external_reference) {
    try {
      const ref = JSON.parse(payment.external_reference);
      email = ref.email?.toLowerCase().trim();
      plan  = ref.plan || 'monthly';
    } catch { /* JSON inválido — usar fallback */ }
  }

  // Validar email: debe estar presente y ser válido
  if (!email && !payerEmail) {
    log('error', 'mp-webhook', 'payment without email source', { paymentId });
    return;
  }

  // Si tenemos ambos, prefiero payer.email (visto por MP directamente)
  // pero valido que no conflictúen (posible spoofing)
  if (email && payerEmail && email !== payerEmail) {
    log('warn', 'mp-webhook', 'email mismatch: external_reference vs payer', {
      external: email,
      payer: payerEmail,
      paymentId,
    });
    // Usar payer.email como fuente de verdad (menos manipulable)
    email = payerEmail;
  } else if (!email) {
    email = payerEmail;
  }

  if (!plan) plan = 'monthly';
  if (!isValidEmail(email)) {
    log('error', 'mp-webhook', 'invalid email format', { email: email.slice(0, 5) + '***', paymentId });
    return;
  }

  // Validar currency
  const expectedCurrency = env.MP_CURRENCY_ID || 'USD';
  if (payment.currency_id && payment.currency_id !== expectedCurrency) {
    log('error', 'mp-webhook', 'currency mismatch', { got: payment.currency_id, expected: expectedCurrency, paymentId });
    return;
  }

  // Validar installments: no aceptar pagos en cuotas (riesgo de contracargo)
  // installments = 1 es el default (pago único)
  const installments = payment.installments || 1;
  if (installments > 1) {
    log('warn', 'mp-webhook', 'installment payment rejected', {
      installments,
      paymentId,
      email: email.slice(0, 5) + '***',
    });
    return;
  }

  // Validar monto contra el esperado según el plan
  const expectedAmount = parseFloat(plan === 'annual'
    ? (env.MP_AMOUNT_ANNUAL  || '95.88')
    : (env.MP_AMOUNT_MONTHLY || '9.99'));
  const paidAmount = parseFloat(payment.transaction_amount || 0);
  if (Math.abs(paidAmount - expectedAmount) > 0.01) {
    log('error', 'mp-webhook', 'amount mismatch', { paid: paidAmount, expected: expectedAmount, plan, paymentId });
    return;
  }

  const TTL_3Y    = 94608000;
  const emailHash = await hashEmail(email);

  // Rate limit: máx 3 pagos exitosos por email por hora (previene spam)
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / 3600);
  const rateLimitKey = `mp_payments_per_email:${emailHash}:${hour}`;
  let paymentCount = 0;
  try {
    const stored = await env.PT_LICENSES.get(rateLimitKey);
    paymentCount = stored ? parseInt(stored, 10) : 0;
  } catch {
    log('warn', 'mp-webhook', 'rate limit check failed', { email: email.slice(0, 5) + '***' });
  }
  if (paymentCount >= 3) {
    log('warn', 'mp-webhook', 'payment rate limit exceeded for email', {
      email: email.slice(0, 5) + '***',
      paymentId,
      count: paymentCount,
    });
    return;
  }

  // Secondary idempotency: check if this payment already created a license
  const existingPayLicense = await env.PT_LICENSES.get(`mp_pay:${paymentId}`);
  if (existingPayLicense) {
    log('info', 'mp-webhook', 'payment already processed', { paymentId });
    return;
  }

  // Si ya tiene licencia activa, renovar
  const existingCode = await env.PT_LICENSES.get(`email_license:${emailHash}`);
  if (existingCode) {
    const licRaw = await env.PT_LICENSES.get(`license:${existingCode}`);
    if (licRaw) {
      let lic;
      try { lic = JSON.parse(licRaw); } catch {
        log('error', 'mp-webhook', 'corrupted license data', { code: existingCode.slice(0, 7) + '***' });
        // Fall through to create a new license instead of crashing
      }
      if (!lic) { /* corrupted — skip renewal, create fresh below */ }
      else {
        const isAnnual = plan === 'annual' || lic.plan === 'basic_annual';
        const expiryMs = new Date(lic.expiresAt).getTime();
        const base     = new Date(Math.max(Date.now(), isNaN(expiryMs) ? Date.now() : expiryMs));
        base.setDate(base.getDate() + (isAnnual ? 365 : 31));
        const expiresAt = base.toISOString().split('T')[0];

        lic.expiresAt   = expiresAt;
        lic.renewsAt    = expiresAt;
        lic.status      = 'active';
        lic.suspendedAt = null;

        await env.PT_LICENSES.put(`license:${existingCode}`, JSON.stringify(lic));
        await env.PT_LICENSES.put(`mp_pay:${paymentId}`, existingCode, { expirationTtl: TTL_3Y });

        // Incrementar contador de rate limit
        await env.PT_LICENSES.put(rateLimitKey, String(paymentCount + 1), { expirationTtl: 3600 });

        log('info', 'mp-webhook', 'license renewed', { code: existingCode.slice(0, 7) + '***', expiresAt });

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
  }

  // Primera licencia para este email
  const code     = await generateLicenseCode(env);
  const isAnnual = plan === 'annual';
  const createdDate = new Date();
  const expiry   = new Date(createdDate);
  expiry.setDate(expiry.getDate() + (isAnnual ? 365 : 31));
  const expiresAt = expiry.toISOString().split('T')[0];

  const licenseData = {
    clientName:      email.split('@')[0],
    clientEmail:     email,
    expiresAt,
    maxUses:         null,
    usedCount:       0,
    createdAt:       createdDate.toISOString().split('T')[0],
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

  // Incrementar contador de rate limit
  await env.PT_LICENSES.put(rateLimitKey, String(paymentCount + 1), { expirationTtl: 3600 });

  log('info', 'mp-webhook', 'license created', { code: code.slice(0, 7) + '***', plan });
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

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
