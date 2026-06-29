// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /backup
//
// POST /backup  → { code, token, data }   — guardar backup
// GET  /backup?code=XXX&token=YYY         — restaurar backup
//
// Variables de entorno (compartidas con validate-license):
//   LICENSE_SERVER_SECRET  — mismo secreto HMAC
//
// R2 Binding (wrangler.jsonc):
//   binding: "PT_BACKUP"  — bucket "parfumtrack-backups"
//
// KV Binding para rate limiting:
//   binding: "PT_LICENSES"  — reutilizado para contadores
//
// Clave R2: backup/{NORMALIZED_CODE}
// Auth: HMAC-SHA256(code, secret) debe coincidir con token enviado
// Rate limit: 10 requests/hora por IP, 4 backups/día por código
// ══════════════════════════════════════════════════════════════

import { corsHeaders, json, checkRateLimit, verifyToken, log, requireJson, parseJsonBody, hashIp } from './_shared.js';

const CORS_OPTS = { methods: 'GET, POST, OPTIONS', allowHeaders: 'Content-Type, X-PT-Code, X-PT-Token' };

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin, CORS_OPTS);

  // Rate limit by IP
  const ip = await hashIp(request);
  const ipLimitError = await checkRateLimit(env, `rl_ip_${ip}`, 10, 3600);
  if (ipLimitError) return json({ ok: false, error: ipLimitError }, 429, headers);

  const ctError = requireJson(request, 5_242_880);
  if (ctError) return json({ ok: false, error: ctError }, ctError === 'Payload too large' ? 413 : 415, headers);

  const { data: body, error: parseError } = await parseJsonBody(request, 5_242_880);
  if (parseError) return json({ ok: false, error: parseError === 'Payload too large' ? parseError : 'Bad request' }, parseError === 'Payload too large' ? 413 : 400, headers);

  const { code, token, data } = body;
  if (!code || !token || !data) {
    return json({ ok: false, error: 'Missing fields' }, 400, headers);
  }

  if (typeof code !== 'string' || code.length > 64) {
    return json({ ok: false, error: 'Invalid code' }, 400, headers);
  }

  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(normalized)) {
    return json({ ok: false, error: 'Invalid code format' }, 400, headers);
  }
  const authError = await verifyToken(normalized, token, env);
  if (authError) return json({ ok: false, error: authError }, 401, headers);

  // Rate limit by code (4 saves per day)
  const codeLimitError = await checkRateLimit(env, `rl_code_${normalized}`, 4, 86400);
  if (codeLimitError) return json({ ok: false, error: 'Too many backups today, try again tomorrow' }, 429, headers);

  if (!env.PT_BACKUP) {
    log('error', 'backup', 'PT_BACKUP R2 binding not configured');
    return json({ ok: false, error: 'Storage not configured' }, 500, headers);
  }

  const savedAt = new Date().toISOString();
  const payload = JSON.stringify({ data, savedAt });

  // Limit payload size to 5 MB
  if (payload.length > 5 * 1024 * 1024) {
    return json({ ok: false, error: 'Backup too large (max 5 MB)' }, 413, headers);
  }

  try {
    await env.PT_BACKUP.put(`backup/${normalized}`, payload, {
      httpMetadata: { contentType: 'application/json' }
    });
  } catch (e) {
    log('error', 'backup', 'R2 write failed', { error: e.message });
    return json({ ok: false, error: 'Storage write failed' }, 500, headers);
  }

  log('info', 'backup', 'saved', { code: normalized.slice(0, 7) + '***', sizeKB: (payload.length / 1024).toFixed(1) });
  return json({ ok: true, savedAt }, 200, headers);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin, CORS_OPTS);

  // Rate limit by IP
  const ip = await hashIp(request);
  const ipLimitError = await checkRateLimit(env, `rl_ip_${ip}`, 10, 3600);
  if (ipLimitError) return json({ ok: false, error: ipLimitError }, 429, headers);

  const code = request.headers.get('X-PT-Code');
  const token = request.headers.get('X-PT-Token');

  if (!code || !token) {
    return json({ ok: false, error: 'Missing params' }, 400, headers);
  }

  if (typeof code !== 'string' || code.length > 64) {
    return json({ ok: false, error: 'Invalid code' }, 400, headers);
  }

  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(normalized)) {
    return json({ ok: false, error: 'Invalid code format' }, 400, headers);
  }
  const authError = await verifyToken(normalized, token, env);
  if (authError) return json({ ok: false, error: authError }, 401, headers);

  if (!env.PT_BACKUP) {
    return json({ ok: false, error: 'Storage not configured' }, 500, headers);
  }

  let obj;
  try {
    obj = await env.PT_BACKUP.get(`backup/${normalized}`);
  } catch (e) {
    log('error', 'backup', 'R2 read failed', { error: e.message });
    return json({ ok: false, error: 'Storage read failed' }, 500, headers);
  }

  if (!obj) {
    return json({ ok: false, error: 'No backup found' }, 404, headers);
  }

  let parsed;
  try {
    parsed = JSON.parse(await obj.text());
  } catch {
    return json({ ok: false, error: 'Backup data corrupted' }, 500, headers);
  }

  const { data, savedAt } = parsed;
  log('info', 'backup', 'restored', { code: normalized.slice(0, 7) + '***', savedAt });
  return json({ ok: true, data, savedAt }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin, CORS_OPTS) });
}
