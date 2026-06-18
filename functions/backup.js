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

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  // Rate limit by IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipLimitError = await checkRateLimit(env, `rl_ip_${ip}`, 10, 3600);
  if (ipLimitError) return json({ ok: false, error: ipLimitError }, 429, headers);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Bad request' }, 400, headers); }

  const { code, token, data } = body;
  if (!code || !token || !data) {
    return json({ ok: false, error: 'Missing fields' }, 400, headers);
  }

  // Validate code length to prevent abuse
  if (typeof code !== 'string' || code.length > 64) {
    return json({ ok: false, error: 'Invalid code' }, 400, headers);
  }

  const normalized = code.trim().toUpperCase();
  const authError = await verifyToken(normalized, token, env);
  if (authError) return json({ ok: false, error: authError }, 401, headers);

  // Rate limit by code (4 saves per day)
  const codeLimitError = await checkRateLimit(env, `rl_code_${normalized}`, 4, 86400);
  if (codeLimitError) return json({ ok: false, error: 'Too many backups today, try again tomorrow' }, 429, headers);

  if (!env.PT_BACKUP) {
    console.error('[backup] PT_BACKUP R2 binding not configured');
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
    console.error('[backup] R2 write failed:', e.message);
    return json({ ok: false, error: 'Storage write failed' }, 500, headers);
  }

  console.log(`[backup] Saved: ${normalized.slice(0, 7)}*** (${(payload.length / 1024).toFixed(1)} KB)`);
  return json({ ok: true, savedAt }, 200, headers);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  // Rate limit by IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipLimitError = await checkRateLimit(env, `rl_ip_${ip}`, 10, 3600);
  if (ipLimitError) return json({ ok: false, error: ipLimitError }, 429, headers);

  const code = request.headers.get('X-PT-Code') || new URL(request.url).searchParams.get('code');
  const token = request.headers.get('X-PT-Token') || new URL(request.url).searchParams.get('token');

  if (!code || !token) {
    return json({ ok: false, error: 'Missing params' }, 400, headers);
  }

  if (typeof code !== 'string' || code.length > 64) {
    return json({ ok: false, error: 'Invalid code' }, 400, headers);
  }

  const normalized = code.trim().toUpperCase();
  const authError = await verifyToken(normalized, token, env);
  if (authError) return json({ ok: false, error: authError }, 401, headers);

  if (!env.PT_BACKUP) {
    return json({ ok: false, error: 'Storage not configured' }, 500, headers);
  }

  let obj;
  try {
    obj = await env.PT_BACKUP.get(`backup/${normalized}`);
  } catch (e) {
    console.error('[backup] R2 read failed:', e.message);
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
  console.log(`[backup] Restored: ${normalized.slice(0, 7)}*** saved ${savedAt}`);
  return json({ ok: true, data, savedAt }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ── Helpers ──────────────────────────────────────────────────

// Constant-time string comparison to prevent timing attacks
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifyToken(code, token, env) {
  const secret = env.LICENSE_SERVER_SECRET;
  if (!secret) return 'Server misconfigured';
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return 'Invalid token format';

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(code));
  const expected = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  if (!timingSafeEqual(token, expected)) return 'Invalid token';
  return null;
}

// KV-based rate limiter: allows `max` requests per `windowSecs` seconds
async function checkRateLimit(env, key, max, windowSecs) {
  if (!env.PT_LICENSES) {
    console.error('[rate-limit] CRITICAL: PT_LICENSES KV no configurado — rate limiting desactivado');
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const windowKey = `${key}_${Math.floor(now / windowSecs)}`;

  let count = 0;
  try {
    const stored = await env.PT_LICENSES.get(windowKey);
    count = stored ? parseInt(stored, 10) : 0;
  } catch { return null; }

  if (count >= max) return 'Too many requests, please try again later';

  try {
    await env.PT_LICENSES.put(windowKey, String(count + 1), { expirationTtl: windowSecs * 2 });
  } catch { /* non-blocking */ }

  return null;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(origin) {
  const ok = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/(parfumtrack\.pages\.dev|parfumtrack\.luccasramireziglesias\.workers\.dev))$/.test(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-PT-Code, X-PT-Token',
  };
}
