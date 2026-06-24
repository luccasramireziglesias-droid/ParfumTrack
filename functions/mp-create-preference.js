// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /mp-create-preference
// POST /mp-create-preference
// Body: { email: string, plan: "monthly" | "annual" }
// Returns: { ok: true, initPoint: "https://www.mercadopago.com/..." }
//
// Secrets requeridos (Cloudflare Dashboard → Workers → Settings):
//   MP_ACCESS_TOKEN — Access token de Mercado Pago
//
// Usa Checkout Pro (preferencias) — no requiere permiso de suscripciones.
// ══════════════════════════════════════════════════════════════

import { corsHeaders, json, checkRateLimit, sha256, isValidEmail, log, requireJson } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin  = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  const ip      = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlError = await checkRateLimit(env, `rl_mppref_${ip}`, 5, 3600);
  if (rlError) return json({ ok: false, error: rlError }, 429, headers);

  const ctError = requireJson(request, 4096);
  if (ctError) return json({ ok: false, error: ctError }, ctError === 'Payload too large' ? 413 : 415, headers);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Bad request' }, 400, headers); }

  const { email, plan = 'monthly' } = body;

  if (!isValidEmail(email)) {
    return json({ ok: false, error: 'Email inválido' }, 400, headers);
  }

  if (!['monthly', 'annual'].includes(plan)) {
    return json({ ok: false, error: 'Plan inválido' }, 400, headers);
  }

  if (env.PT_LICENSES) {
    const emailHash = await sha256(email.toLowerCase().trim());
    const [trialRec, licenseRec] = await Promise.all([
      env.PT_LICENSES.get(`trial_email:${emailHash}`),
      env.PT_LICENSES.get(`email_license:${emailHash}`),
    ]);
    if (!trialRec && !licenseRec) {
      return json({ ok: false, error: 'Email no registrado' }, 403, headers);
    }
  }

  if (!env.MP_ACCESS_TOKEN) {
    log('error', 'mp-create-preference', 'MP_ACCESS_TOKEN not configured');
    return json({ ok: false, error: 'Servicio temporalmente no disponible' }, 503, headers);
  }

  const isAnnual = plan === 'annual';
  const currency = env.MP_CURRENCY_ID || 'USD';
  const amount   = parseFloat(isAnnual
    ? (env.MP_AMOUNT_ANNUAL  || '95.88')
    : (env.MP_AMOUNT_MONTHLY || '9.99'));
  const title    = `Parfum Track — Plan Básico Pro (${isAnnual ? 'Anual' : 'Mensual'})`;
  const appUrl   = env.APP_URL || 'https://parfumtrack.luccasramireziglesias.workers.dev';

  let mpResp;
  try {
    mpResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [{ title, quantity: 1, unit_price: amount, currency_id: currency }],
        payer:              { email },
        back_urls: {
          success: `${appUrl}/checkout-success.html`,
          failure: `${appUrl}/landing.html`,
          pending: `${appUrl}/checkout-success.html`,
        },
        auto_return:        'approved',
        external_reference: JSON.stringify({ email, plan }),
      }),
    });
  } catch (e) {
    log('error', 'mp-create-preference', 'MP API call failed', { error: e.message });
    return json({ ok: false, error: 'Error de conexión con Mercado Pago' }, 500, headers);
  }

  if (!mpResp.ok) {
    const errText = await mpResp.text();
    log('error', 'mp-create-preference', 'MP error response', { status: mpResp.status });
    let msg = `Error MP ${mpResp.status}`;
    try { const e = JSON.parse(errText); msg = e.message || e.error || msg; } catch { /* */ }
    return json({ ok: false, error: msg }, 500, headers);
  }

  const mpData = await mpResp.json();
  const { id: preferenceId, init_point, sandbox_init_point } = mpData;
  const checkoutUrl = init_point || sandbox_init_point;

  if (!checkoutUrl) {
    log('error', 'mp-create-preference', 'missing init_point in MP response');
    return json({ ok: false, error: 'Respuesta inesperada de Mercado Pago' }, 500, headers);
  }

  log('info', 'mp-create-preference', 'preference created', { preferenceId, plan });
  return json({ ok: true, initPoint: checkoutUrl }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
