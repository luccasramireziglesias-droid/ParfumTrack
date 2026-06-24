// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /mp-subscription-status
// GET /mp-subscription-status?code=PT-XXXX&token=HMAC
// Returns estado actual de la suscripción para mostrar en Ajustes
//
// Auth: mismo HMAC-SHA256(code, LICENSE_SERVER_SECRET) que usa backup.js
// ══════════════════════════════════════════════════════════════

import { corsHeaders, json, checkRateLimit, verifyToken, hashIp } from './_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin  = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin, { methods: 'GET, OPTIONS' });
  const url     = new URL(request.url);

  const code  = url.searchParams.get('code')?.trim().toUpperCase();
  const token = url.searchParams.get('token')?.trim();

  if (!code || !token) {
    return json({ ok: false, error: 'Parámetros faltantes' }, 400, headers);
  }

  if (code.length > 64 || !/^[A-Z0-9_-]{1,64}$/.test(code)) {
    return json({ ok: false, error: 'Código inválido' }, 400, headers);
  }

  const ip = await hashIp(request);
  const rlErr = await checkRateLimit(env, `rl_substatus_ip_${ip}`, 30, 3600);
  if (rlErr) return json({ ok: false, error: rlErr }, 429, headers);

  const authError = await verifyToken(code, token, env);
  if (authError) return json({ ok: false, error: authError }, 401, headers);

  const licRaw = await env.PT_LICENSES?.get(`license:${code}`);
  if (!licRaw) return json({ ok: false, error: 'Licencia no encontrada' }, 404, headers);

  let lic;
  try { lic = JSON.parse(licRaw); }
  catch { return json({ ok: false, error: 'Error interno' }, 500, headers); }

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
  return new Response(null, { status: 204, headers: corsHeaders(origin, { methods: 'GET, OPTIONS' }) });
}
