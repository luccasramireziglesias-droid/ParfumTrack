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

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin  = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  const ip      = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlError = await checkRateLimit(env, `rl_mppref_${ip}`, 5, 3600);
  if (rlError) return json({ ok: false, error: rlError }, 429, headers);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Bad request' }, 400, headers); }

  const { email, plan = 'monthly' } = body;

  if (!email || typeof email !== 'string' || email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: 'Email inválido' }, 400, headers);
  }

  if (!['monthly', 'annual'].includes(plan)) {
    return json({ ok: false, error: 'Plan inválido' }, 400, headers);
  }

  // Verificar que el email está registrado (trial o licencia)
  if (env.PT_LICENSES) {
    const emailLower = email.toLowerCase().trim();
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(emailLower));
    const emailHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const [trialRec, licenseRec] = await Promise.all([
      env.PT_LICENSES.get(`trial_email:${emailHash}`),
      env.PT_LICENSES.get(`email_license:${emailHash}`),
    ]);
    if (!trialRec && !licenseRec) {
      return json({ ok: false, error: 'Email no registrado' }, 403, headers);
    }
  }

  if (!env.MP_ACCESS_TOKEN) {
    console.error('[mp-create-preference] MP_ACCESS_TOKEN no configurado');
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
    console.error('[mp-create-preference] Error llamando a MP:', e.message);
    return json({ ok: false, error: 'Error de conexión con Mercado Pago' }, 500, headers);
  }

  if (!mpResp.ok) {
    const errText = await mpResp.text();
    console.error('[mp-create-preference] MP respondió', mpResp.status, errText);
    let msg = `Error MP ${mpResp.status}`;
    try { const e = JSON.parse(errText); msg = e.message || e.error || msg; } catch { /* */ }
    return json({ ok: false, error: msg }, 500, headers);
  }

  const mpData = await mpResp.json();
  const { id: preferenceId, init_point, sandbox_init_point } = mpData;
  const checkoutUrl = init_point || sandbox_init_point;

  if (!checkoutUrl) {
    console.error('[mp-create-preference] Sin init_point:', JSON.stringify(mpData));
    return json({ ok: false, error: 'Respuesta inesperada de Mercado Pago' }, 500, headers);
  }

  console.log(`[mp-create-preference] Preferencia ${preferenceId} para ${email.split('@')[0].slice(0,2)}***@${email.split('@')[1]} (${plan}) → ${checkoutUrl}`);
  return json({ ok: true, initPoint: checkoutUrl }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ── Utilidades ────────────────────────────────────────────────────

async function checkRateLimit(env, key, max, windowSecs) {
  if (!env.PT_LICENSES) {
    console.error('[rate-limit] CRITICAL: PT_LICENSES KV no configurado — requests blocked');
    return 'Service temporarily unavailable';
  }
  const now  = Math.floor(Date.now() / 1000);
  const wKey = `${key}_${Math.floor(now / windowSecs)}`;
  let count  = 0;
  try { count = parseInt(await env.PT_LICENSES.get(wKey) || '0', 10); } catch { return 'Rate limit check failed, please try again later'; }
  if (count >= max) return 'Demasiados intentos. Intentá de nuevo en unos minutos.';
  try { await env.PT_LICENSES.put(wKey, String(count + 1), { expirationTtl: windowSecs * 2 }); } catch { return 'Rate limit write failed'; }
  return null;
}

function corsHeaders(origin) {
  const ok = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/(parfumtrack\.luccasramireziglesias\.workers\.dev))$/.test(origin);
  return {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}
