// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /mp-subscription-status
// GET /mp-subscription-status?code=PT-XXXX&token=HMAC
// Returns estado actual de la suscripción para mostrar en Ajustes
//
// Auth: mismo HMAC-SHA256(code, LICENSE_SERVER_SECRET) que usa backup.js
// ══════════════════════════════════════════════════════════════

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin  = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);
  const url     = new URL(request.url);

  const code  = url.searchParams.get('code')?.trim().toUpperCase();
  const token = url.searchParams.get('token')?.trim();

  if (!code || !token) {
    return json({ ok: false, error: 'Parámetros faltantes' }, 400, headers);
  }

  // Rate limit: 30 requests per hour per IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlErr = await checkRateLimit(env, `rl_substatus_ip_${ip}`, 30, 3600);
  if (rlErr) return json({ ok: false, error: rlErr }, 429, headers);

  // Verificar HMAC token
  const authError = await verifyToken(code, token, env);
  if (authError) return json({ ok: false, error: authError }, 401, headers);

  // Leer licencia
  const licRaw = await env.PT_LICENSES?.get(`license:${code}`);
  if (!licRaw) return json({ ok: false, error: 'Licencia no encontrada' }, 404, headers);

  let lic;
  try { lic = JSON.parse(licRaw); }
  catch { return json({ ok: false, error: 'Error interno' }, 500, headers); }

  // Devolver solo campos relevantes (no exponer datos internos)
  return json({
    ok:          true,
    status:      lic.status,
    plan:        lic.plan,
    expiresAt:   lic.expiresAt,
    renewsAt:    lic.renewsAt,
    cancelledAt: lic.cancelledAt,
    suspendedAt: lic.suspendedAt,
  }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

async function verifyToken(code, token, env) {
  const secret = env.LICENSE_SERVER_SECRET;
  if (!secret) return 'Servidor mal configurado';

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(code));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected.length !== token.length) return 'Token inválido';
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0 ? null : 'Token inválido';
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function checkRateLimit(env, key, max, windowSecs) {
  if (!env.PT_LICENSES) {
    console.error('[rate-limit] CRITICAL: PT_LICENSES KV no configurado — requests blocked');
    return 'Service temporarily unavailable';
  }
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
  } catch { /* non-blocking */ }
  return null;
}

function corsHeaders(origin) {
  const ok = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/(parfumtrack\.pages\.dev|parfumtrack\.luccasramireziglesias\.workers\.dev))$/.test(origin);
  return {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
