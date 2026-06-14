// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /stripe-create-checkout
// POST /stripe-create-checkout
// Body: { email: string, plan: "monthly" | "annual" }
// Returns: { ok: true, url: "https://checkout.stripe.com/..." }
//
// Secrets requeridos (Cloudflare Dashboard → Workers → Settings):
//   STRIPE_SECRET_KEY — Secret key de Stripe (sk_test_... o sk_live_...)
//
// Vars opcionales (wrangler.jsonc o Dashboard):
//   STRIPE_PRICE_ID_MONTHLY — Price ID del plan mensual (price_...)
//   STRIPE_PRICE_ID_ANNUAL  — Price ID del plan anual  (price_...)
// ══════════════════════════════════════════════════════════════

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin  = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  // Rate limit: 5 intentos por IP por hora
  const ip      = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlError = await checkRateLimit(env, `rl_stripe_${ip}`, 5, 3600);
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

  if (!env.STRIPE_SECRET_KEY) {
    console.error('[stripe-checkout] STRIPE_SECRET_KEY no configurado');
    return json({ ok: false, error: 'Servicio temporalmente no disponible' }, 503, headers);
  }

  const priceId = plan === 'annual'
    ? (env.STRIPE_PRICE_ID_ANNUAL  || env.STRIPE_PRICE_ID_MONTHLY)
    : (env.STRIPE_PRICE_ID_MONTHLY);

  if (!priceId) {
    console.error('[stripe-checkout] STRIPE_PRICE_ID_MONTHLY no configurado');
    return json({ ok: false, error: 'Precio no configurado' }, 503, headers);
  }

  const appUrl = env.APP_URL || 'https://parfumtrack.luccasramireziglesias.workers.dev';

  let resp;
  try {
    resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        mode:                        'subscription',
        customer_email:              email,
        'line_items[0][price]':      priceId,
        'line_items[0][quantity]':   '1',
        success_url:                 `${appUrl}/checkout-success.html`,
        cancel_url:                  `${appUrl}/landing.html`,
        'subscription_data[metadata][plan]':  plan,
        'metadata[email]':           email,
        'metadata[plan]':            plan,
      }).toString(),
    });
  } catch (e) {
    console.error('[stripe-checkout] Error llamando a Stripe:', e.message);
    return json({ ok: false, error: 'Error de conexión con Stripe' }, 500, headers);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[stripe-checkout] Stripe respondió', resp.status, errText);
    let msg = `Error Stripe ${resp.status}`;
    try { const e = JSON.parse(errText); msg = e.error?.message || msg; } catch { /* */ }
    return json({ ok: false, error: msg }, 500, headers);
  }

  const session = await resp.json();
  console.log(`[stripe-checkout] Sesión creada: ${session.id} para ${email} (${plan})`);
  return json({ ok: true, url: session.url }, 200, headers);
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get('Origin') || '') });
}

// ── Utilidades ────────────────────────────────────────────────────

async function checkRateLimit(env, key, max, windowSecs) {
  if (!env.PT_LICENSES) return null;
  const now  = Math.floor(Date.now() / 1000);
  const wKey = `${key}_${Math.floor(now / windowSecs)}`;
  let count  = 0;
  try { count = parseInt(await env.PT_LICENSES.get(wKey) || '0', 10); } catch { return null; }
  if (count >= max) return 'Demasiados intentos. Intentá de nuevo en unos minutos.';
  try { await env.PT_LICENSES.put(wKey, String(count + 1), { expirationTtl: windowSecs * 2 }); } catch { /* */ }
  return null;
}

function corsHeaders(origin) {
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1|parfumtrack\.pages\.dev|[a-z0-9-]+\.workers\.dev)(:\d+)?$/.test(origin) ? origin : 'null';
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}
