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

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
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
    console.error("[sync] R2 write failed:", e.message);
    return json({ ok: false, error: "Storage write failed" }, 500, headers);
  }

  return json({ ok: true, savedAt }, 200, headers);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
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

  const authErr = await verifyToken(code, token, env);
  if (authErr) return json({ ok: false, error: authErr }, 401, headers);

  if (!env.PT_BACKUP) {
    return json({ ok: false, error: "Storage not configured" }, 500, headers);
  }

  let obj;
  try {
    obj = await env.PT_BACKUP.get(`sync/${code}`);
  } catch (e) {
    console.error("[sync] R2 read failed:", e.message);
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
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ── Helpers ───────────────────────────────────────────────────

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++)
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyToken(code, token, env) {
  const secret = env.LICENSE_SERVER_SECRET;
  if (!secret) return "Server misconfigured";
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token))
    return "Invalid token format";

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(code));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (!timingSafeEqual(token, expected)) return "Invalid token";
  return null;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

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
  } catch {
    return null;
  }
  if (count >= max) return "Too many requests, please try again later";
  try {
    await env.PT_LICENSES.put(windowKey, String(count + 1), {
      expirationTtl: windowSecs * 2,
    });
  } catch {
    /* non-blocking */
  }
  return null;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(origin) {
  const ok =
    /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/(parfumtrack\.pages\.dev|parfumtrack\.luccasramireziglesias\.workers\.dev))$/.test(
      origin,
    );
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-PT-Code, X-PT-Token",
  };
}
