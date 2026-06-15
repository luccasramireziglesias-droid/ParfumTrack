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

const DELAY_ON_INVALID = 2000; // ms — frena brute-force

// Código del dueño leído desde env var LICENSE_OWNER_CODE (Cloudflare Dashboard → Workers → Settings)

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  // Rate limit by IP: max 10 attempts per 15 minutes
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipLimitError = await checkRateLimit(env, `rl_lic_ip_${ip}`, 10, 900);
  if (ipLimitError) {
    return new Response(
      JSON.stringify({
        valid: false,
        error: "Too many requests, please try again later",
      }),
      {
        status: 429,
        headers,
      },
    );
  }

  let code;
  try {
    ({ code } = await request.json());
  } catch {
    return new Response(
      JSON.stringify({ valid: false, error: "Bad request" }),
      { status: 400, headers },
    );
  }

  if (!code || typeof code !== "string" || code.length > 64) {
    return new Response(JSON.stringify({ valid: false }), {
      status: 400,
      headers,
    });
  }

  const normalizedCode = code.trim().toUpperCase();
  const secret = env.LICENSE_SERVER_SECRET;

  if (!secret) {
    console.error(
      "[validate-license] FATAL: LICENSE_SERVER_SECRET no configurada",
    );
    return new Response(
      JSON.stringify({ valid: false, error: "Server misconfigured" }),
      { status: 500, headers },
    );
  }

  const ownerCode = (env.LICENSE_OWNER_CODE || "").trim().toUpperCase();
  const isOwner = ownerCode.length > 0 && timingSafeEqual(normalizedCode, ownerCode);

  if (!isOwner) {
    // Validación normal vía KV
    if (!env.PT_LICENSES) {
      console.error(
        "[validate-license] FATAL: KV binding PT_LICENSES no encontrado",
      );
      return new Response(
        JSON.stringify({ valid: false, error: "Server misconfigured" }),
        { status: 500, headers },
      );
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
      return new Response(JSON.stringify({ valid: false }), {
        status: 500,
        headers,
      });
    }

    // Verificar estado de suscripción MP (suspendida o cancelada y vencida)
    if (license.status === 'payment_failed') {
      // Acceso suspendido por fallo de pago reiterado
      await delay(200);
      return new Response(JSON.stringify({ valid: false, reason: "payment_failed" }), { headers });
    }

    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      await delay(DELAY_ON_INVALID);
      return new Response(JSON.stringify({ valid: false, reason: "expired" }), {
        headers,
      });
    }

    if (
      license.maxUses !== null &&
      (license.usedCount || 0) >= license.maxUses
    ) {
      await delay(DELAY_ON_INVALID);
      return new Response(
        JSON.stringify({ valid: false, reason: "limit_reached" }),
        { headers },
      );
    }

    license.usedCount = (license.usedCount || 0) + 1;
    license.lastActivatedAt = new Date().toISOString();
    await env.PT_LICENSES.put(
      `license:${normalizedCode}`,
      JSON.stringify(license),
    );

    console.log(
      `[validate-license] Activada: ${normalizedCode.slice(0, 7)}*** (uso ${license.usedCount}/${license.maxUses ?? "∞"}, cliente: ${license.clientName})`,
    );
  } else {
    console.log("[validate-license] Activada: código del dueño");
  }

  const encoder = new TextEncoder();

  // HMAC-SHA256 token (for backup.js authentication — server-side only)
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hmacBytes = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encoder.encode(normalizedCode),
  );
  const token = Array.from(new Uint8Array(hmacBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // ECDSA P-256 signature (for client-side verification via embedded public key)
  const signingKeyRaw = env.LICENSE_SIGNING_PRIVATE_KEY;
  if (!signingKeyRaw) {
    console.error(
      "[validate-license] FATAL: LICENSE_SIGNING_PRIVATE_KEY no configurada",
    );
    return new Response(
      JSON.stringify({ valid: false, error: "Server misconfigured" }),
      { status: 500, headers },
    );
  }
  const signingKeyDer = Uint8Array.from(atob(signingKeyRaw), (c) =>
    c.charCodeAt(0),
  );
  const ecdsaKey = await crypto.subtle.importKey(
    "pkcs8",
    signingKeyDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const ecdsaBytes = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    ecdsaKey,
    encoder.encode(normalizedCode),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(ecdsaBytes)));

  return new Response(JSON.stringify({ valid: true, token, sig }), { headers });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// KV-based rate limiter: allows `max` requests per `windowSecs` seconds
async function checkRateLimit(env, key, max, windowSecs) {
  if (!env.PT_LICENSES) return null;

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

function corsHeaders(origin) {
  const ok =
    /^https?:\/\/(localhost|127\.0\.0\.1|parfumtrack\.pages\.dev|parfumtrack\.workers\.dev)(:\d+)?$/.test(
      origin,
    );
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
