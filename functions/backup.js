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
// Clave R2: backup/{NORMALIZED_CODE}
// Auth: HMAC-SHA256(code, secret) debe coincidir con token enviado
// ══════════════════════════════════════════════════════════════

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Bad request' }, 400, headers); }

  const { code, token, data } = body;
  if (!code || !token || !data) {
    return json({ ok: false, error: 'Missing fields' }, 400, headers);
  }

  const normalized = code.trim().toUpperCase();
  const authError = await verifyToken(normalized, token, env);
  if (authError) return json({ ok: false, error: authError }, 401, headers);

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

  await env.PT_BACKUP.put(`backup/${normalized}`, payload, {
    httpMetadata: { contentType: 'application/json' }
  });

  console.log(`[backup] Saved: ${normalized.slice(0, 7)}*** (${(payload.length / 1024).toFixed(1)} KB)`);
  return json({ ok: true, savedAt }, 200, headers);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const token = url.searchParams.get('token');

  if (!code || !token) {
    return json({ ok: false, error: 'Missing params' }, 400, headers);
  }

  const normalized = code.trim().toUpperCase();
  const authError = await verifyToken(normalized, token, env);
  if (authError) return json({ ok: false, error: authError }, 401, headers);

  if (!env.PT_BACKUP) {
    return json({ ok: false, error: 'Storage not configured' }, 500, headers);
  }

  const obj = await env.PT_BACKUP.get(`backup/${normalized}`);
  if (!obj) {
    return json({ ok: false, error: 'No backup found' }, 404, headers);
  }

  const { data, savedAt } = JSON.parse(await obj.text());
  console.log(`[backup] Restored: ${normalized.slice(0, 7)}*** saved ${savedAt}`);
  return json({ ok: true, data, savedAt }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ── Helpers ──────────────────────────────────────────────────

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

  if (token !== expected) return 'Invalid token';
  return null;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(origin) {
  const ok = /^https?:\/\/(localhost|127\.0\.0\.1|.*\.netlify\.app|.*\.pages\.dev|.*\.workers\.dev)(:\d+)?$/.test(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
