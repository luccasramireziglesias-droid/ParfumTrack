// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Pages Function: validate-license
// POST /validate-license
// Body: { code: "PT-XXXX-YYYY" }
//
// Variables de entorno en Cloudflare Pages → Settings → Environment variables:
//   VALID_LICENSE_CODES   = "PT-AAAA-1111,PT-BBBB-2222"
//   LICENSE_SERVER_SECRET = "un-secreto-largo"
// ══════════════════════════════════════════════════════════════

const DELAY_ON_INVALID = 600;

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
  const rawCodes = env.VALID_LICENSE_CODES || '';

  if (!secret) {
    console.error('[validate-license] FATAL: LICENSE_SERVER_SECRET no configurada');
    return new Response(JSON.stringify({ valid: false, error: 'Server configuration error' }), { status: 500, headers });
  }

  const validCodes = rawCodes.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

  if (!validCodes.includes(normalizedCode)) {
    await delay(DELAY_ON_INVALID);
    return new Response(JSON.stringify({ valid: false }), { status: 200, headers });
  }

  // Generar token firmado con Web Crypto API (compatible con Cloudflare Workers)
  const activatedAt = Date.now().toString();
  const payload = `${normalizedCode}:${activatedAt}`;
  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const token = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

  console.log(`[validate-license] Licencia activada: ${normalizedCode.slice(0, 5)}...`);

  return new Response(JSON.stringify({ valid: true, token, activatedAt }), { status: 200, headers });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function corsHeaders(origin) {
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1|.*\.netlify\.app|.*\.pages\.dev|.*\.workers\.dev)(:\d+)?$/.test(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
