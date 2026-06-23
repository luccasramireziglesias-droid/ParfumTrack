// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /mp-payment-status
// GET /mp-payment-status?paymentId=123456789&email=user@example.com
// Devuelve si la licencia asociada a un pago ya fue activada.
// Requiere email del pagador para autenticar (verificado contra Mercado Pago).
// No devuelve el código de licencia — solo el estado (activo/pendiente).
// ══════════════════════════════════════════════════════════════

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin  = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);
  const url     = new URL(request.url);

  const paymentId = url.searchParams.get('paymentId')?.trim();
  const email = url.searchParams.get('email')?.trim().toLowerCase();

  if (!paymentId || !/^\d+$/.test(paymentId) || paymentId.length > 20) {
    return json({ ok: false, error: 'paymentId inválido' }, 400, headers);
  }

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: 'email requerido' }, 400, headers);
  }

  if (!env.PT_LICENSES) {
    return json({ ok: false, status: 'pending' }, 200, headers);
  }

  // Rate limit: 30 requests per hour per IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlErr = await checkRateLimit(env, `rl_mpstatus_ip_${ip}`, 30, 3600);
  if (rlErr) return json({ ok: false, error: rlErr }, 429, headers);

  // Verify email matches the payment's payer email via Mercado Pago API
  if (!env.MP_ACCESS_TOKEN) {
    console.error('[mp-payment-status] MP_ACCESS_TOKEN not configured');
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
    console.error('[mp-payment-status] MP API error:', e.message);
    return json({ ok: false, error: 'Payment verification failed' }, 500, headers);
  }

  if (!payerEmail || payerEmail !== email) {
    return json({ ok: false, error: 'Unauthorized' }, 401, headers);
  }

  const licenseCode = await env.PT_LICENSES.get(`mp_pay:${paymentId}`);
  if (!licenseCode) {
    return json({ ok: true, status: 'pending' }, 200, headers);
  }

  const licRaw = await env.PT_LICENSES.get(`license:${licenseCode}`);
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
    plan:      lic.plan,
    expiresAt: lic.expiresAt,
  }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function checkRateLimit(env, key, max, windowSecs) {
  if (!env.PT_LICENSES) return 'Service temporarily unavailable';
  const now = Math.floor(Date.now() / 1000);
  const windowKey = `${key}_${Math.floor(now / windowSecs)}`;
  let count = 0;
  try {
    const stored = await env.PT_LICENSES.get(windowKey);
    count = stored ? parseInt(stored, 10) : 0;
  } catch { return 'Rate limit check failed, please try again later'; }
  if (count >= max) return 'Too many requests, please try again later';
  try {
    await env.PT_LICENSES.put(windowKey, String(count + 1), { expirationTtl: windowSecs * 2 });
  } catch { return 'Rate limit write failed'; }
  return null;
}

function corsHeaders(origin) {
  const ok = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/(parfumtrack\.luccasramireziglesias\.workers\.dev))$/.test(origin);
  return {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
