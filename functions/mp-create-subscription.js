// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /mp-create-subscription
// POST /mp-create-subscription
// Body: { email: string, plan: "monthly" | "annual" }
// Returns: { ok: true, initPoint: "https://www.mercadopago.com/..." }
//
// Secrets requeridos (Cloudflare Dashboard → Workers → Settings):
//   MP_ACCESS_TOKEN — Access token de Mercado Pago (Bearer)
//
// Vars opcionales (wrangler.jsonc o Dashboard):
//   MP_CURRENCY_ID     — Moneda (ej: "ARS", "UYU", "CLP", "USD"). Default: "ARS"
//   MP_AMOUNT_MONTHLY  — Monto mensual en la moneda configurada. Default: 9.99
//   MP_AMOUNT_ANNUAL   — Monto anual en la moneda configurada. Default: 95.88
// ══════════════════════════════════════════════════════════════

const WA_NUMBER = '59894466577';

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin  = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  // Rate limit: máximo 5 intentos de checkout por IP por hora
  const ip       = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlError  = await checkRateLimit(env, `rl_mpsub_ip_${ip}`, 5, 3600);
  if (rlError) return json({ ok: false, error: rlError }, 429, headers);

  // Parsear body
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Bad request' }, 400, headers); }

  const { email, plan = 'monthly' } = body;

  // Validar email
  if (!email || typeof email !== 'string' || email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: 'Email inválido' }, 400, headers);
  }

  if (!['monthly', 'annual'].includes(plan)) {
    return json({ ok: false, error: 'Plan inválido' }, 400, headers);
  }

  // Verificar si el email ya tiene suscripción activa
  const emailHash    = await hashEmail(email);
  const existingCode = await env.PT_LICENSES?.get(`email_license:${emailHash}`);
  if (existingCode) {
    const licRaw = await env.PT_LICENSES.get(`license:${existingCode}`);
    if (licRaw) {
      const lic = JSON.parse(licRaw);
      if (lic.status === 'active' && (!lic.expiresAt || new Date(lic.expiresAt) > new Date())) {
        return json({
          ok: false,
          error: 'Ya tenés una suscripción activa con este email',
          code: existingCode,
        }, 409, headers);
      }
    }
  }

  if (!env.MP_ACCESS_TOKEN) {
    console.error('[mp-create-subscription] MP_ACCESS_TOKEN no configurado');
    return json({ ok: false, error: 'Servicio temporalmente no disponible' }, 503, headers);
  }

  // Configuración del plan
  const isAnnual   = plan === 'annual';
  const currency   = env.MP_CURRENCY_ID || 'ARS';
  const amount     = parseFloat(isAnnual
    ? (env.MP_AMOUNT_ANNUAL  || '95.88')
    : (env.MP_AMOUNT_MONTHLY || '9.99'));
  const reason     = `Parfum Track — Plan Básico Pro (${isAnnual ? 'Anual' : 'Mensual'})`;
  const frequency  = isAnnual ? 12 : 1; // en meses

  // Crear preapproval en MP
  let mpResp;
  try {
    mpResp = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        reason,
        back_url:  `${env.APP_URL || 'https://parfumtrack.workers.dev'}/checkout-success.html`,
        payer_email: email,
        auto_recurring: {
          frequency,
          frequency_type:     'months',
          transaction_amount: amount,
          currency_id:        currency,
        },
      }),
    });
  } catch (e) {
    console.error('[mp-create-subscription] Error llamando a MP:', e.message);
    return json({ ok: false, error: 'Error de conexión con Mercado Pago' }, 500, headers);
  }

  if (!mpResp.ok) {
    const errText = await mpResp.text();
    console.error('[mp-create-subscription] MP respondió', mpResp.status, errText);
    return json({ ok: false, error: 'Error al crear la suscripción en Mercado Pago' }, 500, headers);
  }

  const mpData = await mpResp.json();
  const { id: preapprovalId, init_point } = mpData;

  if (!init_point) {
    console.error('[mp-create-subscription] Sin init_point:', JSON.stringify(mpData));
    return json({ ok: false, error: 'Respuesta inesperada de Mercado Pago' }, 500, headers);
  }

  // Guardar pending: preapprovalId → { email, plan }  (TTL 1 hora)
  if (env.PT_LICENSES) {
    await env.PT_LICENSES.put(
      `pending_sub:${preapprovalId}`,
      JSON.stringify({ email, plan }),
      { expirationTtl: 3600 },
    );
  }

  console.log(`[mp-create-subscription] Creado preapproval ${preapprovalId} para ${email} (${plan})`);
  return json({ ok: true, initPoint: init_point }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ── Utilidades ────────────────────────────────────────────────────

async function hashEmail(email) {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkRateLimit(env, key, max, windowSecs) {
  if (!env.PT_LICENSES) return null;
  const now     = Math.floor(Date.now() / 1000);
  const wKey    = `${key}_${Math.floor(now / windowSecs)}`;
  let count     = 0;
  try { count = parseInt(await env.PT_LICENSES.get(wKey) || '0', 10); } catch { return null; }
  if (count >= max) return 'Demasiados intentos. Intentá de nuevo en unos minutos.';
  try { await env.PT_LICENSES.put(wKey, String(count + 1), { expirationTtl: windowSecs * 2 }); } catch { /* */ }
  return null;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(origin) {
  const ok = /^https?:\/\/(localhost|127\.0\.0\.1|parfumtrack\.pages\.dev|parfumtrack\.workers\.dev)(:\d+)?$/.test(origin);
  return {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
