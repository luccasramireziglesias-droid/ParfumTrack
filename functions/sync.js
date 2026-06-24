// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /sync
//
// POST /sync { code, token, data } — guardar datos en nube
// GET  /sync?code=X&token=Y       — cargar datos desde nube
//
// Auth: HMAC-SHA256(code, LICENSE_SERVER_SECRET) — mismo mecanismo que /backup
// R2 key: sync/{code}
// Rate limits: 120 guardados/hr por código, 60 cargas/hr por IP
//
// Bindings requeridos:
//   PT_BACKUP          — R2 bucket (compartido con /backup)
//   PT_LICENSES        — KV namespace (para rate limiting)
//   LICENSE_SERVER_SECRET — secreto HMAC (compartido con /backup)
// ══════════════════════════════════════════════════════════════

import { corsHeaders, json, checkRateLimit, verifyToken, sha256, log } from './_shared.js';

const CORS_OPTS = { methods: 'GET, POST, OPTIONS', allowHeaders: 'Content-Type, X-PT-Code, X-PT-Token' };

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin, CORS_OPTS);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  // Rate limit: 120 saves per hour per IP
  const ipErr = await checkRateLimit(
    env,
    `rl_sync_ip_${await sha256(ip)}`,
    120,
    3600,
  );
  if (ipErr) return json({ ok: false, error: ipErr }, 429, headers);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request" }, 400, headers);
  }

  let { code, token, data } = body;
  if (!code || !token || data === undefined) {
    return json({ ok: false, error: "Missing fields" }, 400, headers);
  }
  if (typeof code !== "string" || code.length > 64) {
    return json({ ok: false, error: "Invalid code" }, 400, headers);
  }
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(code)) {
    return json({ ok: false, error: "Invalid code format" }, 400, headers);
  }

  const authErr = await verifyToken(code, token, env);
  if (authErr) return json({ ok: false, error: authErr }, 401, headers);

  // Rate limit: 120 saves per hour per code (auto-sync needs higher limit than /backup)
  const codeErr = await checkRateLimit(env, `rl_sync_code_${code}`, 120, 3600);
  if (codeErr)
    return json(
      { ok: false, error: "Too many syncs. Try again later." },
      429,
      headers,
    );

  if (!env.PT_BACKUP) {
    return json({ ok: false, error: "Storage not configured" }, 500, headers);
  }

  const savedAt = new Date().toISOString();
  const payload = JSON.stringify({ data, savedAt });

  if (payload.length > 5 * 1024 * 1024) {
    return json(
      { ok: false, error: "Data too large (max 5 MB)" },
      413,
      headers,
    );
  }

  try {
    await env.PT_BACKUP.put(`sync/${code}`, payload, {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (e) {
    log('error', 'sync', 'R2 write failed', { error: e.message });
    return json({ ok: false, error: "Storage write failed" }, 500, headers);
  }

  return json({ ok: true, savedAt }, 200, headers);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin, CORS_OPTS);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  // Rate limit: 60 loads per hour per IP
  const ipErr = await checkRateLimit(
    env,
    `rl_sync_load_ip_${await sha256(ip)}`,
    60,
    3600,
  );
  if (ipErr) return json({ ok: false, error: ipErr }, 429, headers);

  let code = request.headers.get("X-PT-Code") || new URL(request.url).searchParams.get("code");
  const token = request.headers.get("X-PT-Token") || new URL(request.url).searchParams.get("token");

  if (!code || !token) {
    return json({ ok: false, error: "Missing params" }, 400, headers);
  }
  if (typeof code !== "string" || code.length > 64) {
    return json({ ok: false, error: "Invalid code" }, 400, headers);
  }
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(code)) {
    return json({ ok: false, error: "Invalid code format" }, 400, headers);
  }

  const authErr = await verifyToken(code, token, env);
  if (authErr) return json({ ok: false, error: authErr }, 401, headers);

  if (!env.PT_BACKUP) {
    return json({ ok: false, error: "Storage not configured" }, 500, headers);
  }

  let obj;
  try {
    obj = await env.PT_BACKUP.get(`sync/${code}`);
  } catch (e) {
    log('error', 'sync', 'R2 read failed', { error: e.message });
    return json({ ok: false, error: "Storage read failed" }, 500, headers);
  }

  if (!obj) {
    return json({ ok: false, error: "No data found" }, 404, headers);
  }

  let parsed;
  try {
    parsed = JSON.parse(await obj.text());
  } catch {
    return json({ ok: false, error: "Data corrupted" }, 500, headers);
  }

  return json(
    { ok: true, data: parsed.data, savedAt: parsed.savedAt },
    200,
    headers,
  );
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin, CORS_OPTS) });
}
