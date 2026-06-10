// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Worker Function: /validate-license
// POST /validate-license  →  { code: "PT-XXXXXX-YYYYYY" }
//
// Variables de entorno (Cloudflare Dashboard → Workers → Settings):
//   LICENSE_SERVER_SECRET  — string secreto largo y aleatorio (nunca publicar)
//
// KV Binding (wrangler.jsonc → kv_namespaces):
//   binding: "PT_LICENSES"  — namespace donde se guardan los códigos
//
// Estructura de cada entrada en KV:
//   key:   "license:PT-XXXXXX-YYYYYY"
//   value: { clientName, expiresAt, maxUses, usedCount, createdAt, lastActivatedAt }
// ══════════════════════════════════════════════════════════════

const DELAY_ON_INVALID = 600; // ms — frena brute-force

// Código permanente del dueño — siempre válido, sin KV ni límites.
const OWNER_CODE = 'PT-B3FF19-C75C55';

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  let code;
  try {
    ({ code } = await request.json());
  } catch {
    return new Response(JSON.stringify({ valid: false, error: 'Bad request' }), { status: 400, headers });
  }

  if (!code || typeof code !== 'string' || code.length > 64) {
    return new Response(JSON.stringify({ valid: false }), { status: 400, headers });
  }

  const normalizedCode = code.trim().toUpperCase();
  const secret = env.LICENSE_SERVER_SECRET;

  if (!secret) {
    console.error('[validate-license] FATAL: LICENSE_SERVER_SECRET no configurada');
    return new Response(JSON.stringify({ valid: false, error: 'Server misconfigured' }), { status: 500, headers });
  }

  const isOwner = normalizedCode === OWNER_CODE;

  if (!isOwner) {
    // Validación normal vía KV
    if (!env.PT_LICENSES) {
      console.error('[validate-license] FATAL: KV binding PT_LICENSES no encontrado');
      return new Response(JSON.stringify({ valid: false, error: 'Server misconfigured' }), { status: 500, headers });
    }

    const licenseRaw = await env.PT_LICENSES.get(`license:${normalizedCode}`);
    if (!licenseRaw) {
      await delay(DELAY_ON_INVALID);
      return new Response(JSON.stringify({ valid: false }), { headers });
    }

    let license;
    try {
      license = JSON.parse(licenseRaw);
    } catch {
      console.error(`[validate-license] JSON inválido para ${normalizedCode}`);
      return new Response(JSON.stringify({ valid: false }), { status: 500, headers });
    }

    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      await delay(200);
      return new Response(JSON.stringify({ valid: false, reason: 'expired' }), { headers });
    }

    if (license.maxUses !== null && (license.usedCount || 0) >= license.maxUses) {
      await delay(200);
      return new Response(JSON.stringify({ valid: false, reason: 'limit_reached' }), { headers });
    }

    license.usedCount = (license.usedCount || 0) + 1;
    license.lastActivatedAt = new Date().toISOString();
    await env.PT_LICENSES.put(`license:${normalizedCode}`, JSON.stringify(license));

    console.log(`[validate-license] Activada: ${normalizedCode.slice(0, 7)}*** (uso ${license.usedCount}/${license.maxUses ?? '∞'}, cliente: ${license.clientName})`);
  } else {
    console.log('[validate-license] Activada: código del dueño');
  }

  // Generar token: HMAC-SHA256(code, secret) → 64 hex chars
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(normalizedCode));
  const token = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return new Response(JSON.stringify({ valid: true, token }), { headers });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function corsHeaders(origin) {
  const ok = /^https?:\/\/(localhost|127\.0\.0\.1|.*\.netlify\.app|.*\.pages\.dev|.*\.workers\.dev)(:\d+)?$/.test(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
