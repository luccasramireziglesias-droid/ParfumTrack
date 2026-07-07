// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /mp-payment-status
// GET /mp-payment-status?paymentId=123456789&email=user@example.com
// Devuelve si la licencia asociada a un pago ya fue activada.
// Requiere email del pagador para autenticar (verificado contra Mercado Pago).
// Devuelve el código de licencia cuando el pago está activo y el email verificado.
// ══════════════════════════════════════════════════════════════

import { corsHeaders, json, checkRateLimit, isValidEmail, log, hashIp, requireJson, parseJsonBody, validateCsrfToken } from './_shared.js';

async function handlePaymentStatus(paymentId, email, env, request) {
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin, { methods: 'GET, POST, OPTIONS' });

  if (!paymentId || !/^\d+$/.test(paymentId) || paymentId.length > 20) {
    return json({ ok: false, error: 'paymentId inválido' }, 400, headers);
  }

  if (!isValidEmail(email)) {
    return json({ ok: false, error: 'email requerido' }, 400, headers);
  }

  if (!env.PT_LICENSES) {
    return json({ ok: false, status: 'pending' }, 200, headers);
  }

  const ip = await hashIp(request);
  const rlErr = await checkRateLimit(env, `rl_mpstatus_ip_${ip}`, 30, 3600);
  if (rlErr) return json({ ok: false, error: rlErr }, 429, headers);

  if (!env.MP_ACCESS_TOKEN) {
    log('error', 'mp-payment-status', 'MP_ACCESS_TOKEN not configured');
    return json({ ok: false, error: 'Server config error' }, 500, headers);
  }

  let payerEmail;
  try {
    const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
    });
    if (!mpResp.ok) {
      return json({ ok: true, status: 'pending' }, 200, headers);
    }
    const mpData = await mpResp.json();
    payerEmail = (mpData.payer?.email || '').toLowerCase().trim();
  } catch (e) {
    log('error', 'mp-payment-status', 'MP API error', { error: e.message });
    return json({ ok: false, error: 'Payment verification failed' }, 500, headers);
  }

  if (!payerEmail || payerEmail !== email) {
    return json({ ok: false, error: 'Unauthorized' }, 401, headers);
  }

  let licenseCode, licRaw;
  try {
    licenseCode = await env.PT_LICENSES.get(`mp_pay:${paymentId}`);
    if (!licenseCode) {
      return json({ ok: true, status: 'pending' }, 200, headers);
    }
    licRaw = await env.PT_LICENSES.get(`license:${licenseCode}`);
  } catch (e) {
    log('error', 'mp-payment-status', 'KV read failed', { error: e.message });
    return json({ ok: false, error: 'Storage error' }, 500, headers);
  }
  if (!licRaw) {
    return json({ ok: true, status: 'pending' }, 200, headers);
  }

  let lic;
  try { lic = JSON.parse(licRaw); }
  catch { return json({ ok: true, status: 'pending' }, 200, headers); }

  if (lic.status !== 'active') {
    return json({ ok: true, status: 'pending' }, 200, headers);
  }

  return json({
    ok:        true,
    status:    'active',
    code:      licenseCode,
    plan:      lic.plan,
    expiresAt: lic.expiresAt,
  }, 200, headers);
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const paymentId = url.searchParams.get('paymentId')?.trim();
  const email = url.searchParams.get('email')?.trim().toLowerCase();

  return handlePaymentStatus(paymentId, email, context.env, request);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin, { methods: 'GET, POST, OPTIONS' });

  const ctError = requireJson(request, 4096);
  if (ctError) return json({ ok: false, error: ctError }, ctError === 'Payload too large' ? 413 : 415, headers);

  const csrfError = validateCsrfToken(request, { optional: false });
  if (csrfError) return json({ ok: false, error: 'CSRF validation failed' }, 403, headers);

  const { data: body, error: parseError } = await parseJsonBody(request, 4096);
  if (parseError) return json({ ok: false, error: parseError === 'Payload too large' ? parseError : 'Bad request' }, parseError === 'Payload too large' ? 413 : 400, headers);

  const { paymentId, email } = body;
  return handlePaymentStatus(paymentId?.trim(), email?.trim().toLowerCase(), env, request);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin, { methods: 'GET, POST, OPTIONS' }) });
}
