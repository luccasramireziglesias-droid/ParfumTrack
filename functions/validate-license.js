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

import { corsHeaders, json, checkRateLimit, timingSafeEqual, delay, log, requireJson, parseJsonBody, hashIp, validateCsrfToken } from './_shared.js';

const DELAY_ON_INVALID = 2000;

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  // Rate limit by IP: max 10 attempts per 15 minutes
  const ip = await hashIp(request);
  const ipLimitError = await checkRateLimit(env, `rl_lic_ip_${ip}`, 10, 900);
  if (ipLimitError) {
    return json({ ok: false, valid: false, error: "Too many requests, please try again later" }, 429, headers);
  }

  const ctError = requireJson(request, 4096);
  if (ctError) return json({ ok: false, valid: false, error: ctError }, ctError === 'Payload too large' ? 413 : 415, headers);

  const csrfError = validateCsrfToken(request, { optional: true });
  if (csrfError) return json({ ok: false, valid: false, error: 'CSRF validation failed' }, 403, headers);

  let code;
  const { data: bodyData, error: parseError } = await parseJsonBody(request, 4096);
  if (parseError) return json({ ok: false, valid: false, error: parseError === 'Payload too large' ? parseError : 'Bad request' }, parseError === 'Payload too large' ? 413 : 400, headers);
  code = bodyData.code;

  if (!code || typeof code !== "string" || code.length > 64) {
    return json({ ok: false, valid: false, error: "Invalid code" }, 400, headers);
  }

  const normalizedCode = code.trim().toUpperCase();
  const secret = env.LICENSE_SERVER_SECRET;

  if (!secret) {
    log('error', 'validate-license', 'LICENSE_SERVER_SECRET not configured');
    return json({ ok: false, valid: false, error: "Server misconfigured" }, 500, headers);
  }

  // Per-code rate limiting: max 3 failed attempts per hour (prevent enumeration)
  const now = Math.floor(Date.now() / 1000);
  const codeWindow = Math.floor(now / 3600); // 1-hour window
  const codeWindowKey = `rl_lic_code_${normalizedCode}_${codeWindow}`;
  let codeAttempts = 0;
  try {
    const stored = await env.PT_LICENSES.get(codeWindowKey);
    codeAttempts = stored ? (parseInt(stored, 10) || 0) : 0;
  } catch {
    log('warn', 'validate-license', 'Failed to check per-code rate limit', { code: normalizedCode.slice(0, 7) + '***' });
  }

  if (codeAttempts >= 3) {
    await delay(DELAY_ON_INVALID);
    log('warn', 'validate-license', 'Per-code rate limit exceeded (enumeration prevention)', { code: normalizedCode.slice(0, 7) + '***', attempts: codeAttempts });
    return json({ ok: true, valid: false, error: "Too many failed attempts for this code" }, 200, headers);
  }

  const ownerCode = (env.LICENSE_OWNER_CODE || "").trim().toUpperCase();
  const isOwner = ownerCode.length > 0 && timingSafeEqual(normalizedCode, ownerCode);

  if (!isOwner) {
    // Validación normal vía KV
    if (!env.PT_LICENSES) {
      log('error', 'validate-license', 'KV binding PT_LICENSES not found');
      return json({ ok: false, valid: false, error: "Server misconfigured" }, 500, headers);
    }

    const licenseRaw = await env.PT_LICENSES.get(`license:${normalizedCode}`);
    if (!licenseRaw) {
      // Increment failed attempt counter
      try {
        await env.PT_LICENSES.put(codeWindowKey, String(codeAttempts + 1), { expirationTtl: 3600 });
      } catch {
        log('warn', 'validate-license', 'Failed to increment per-code rate limit counter', { code: normalizedCode.slice(0, 7) + '***' });
      }
      await delay(DELAY_ON_INVALID);
      return json({ ok: true, valid: false }, 200, headers);
    }

    let license;
    try {
      license = JSON.parse(licenseRaw);
    } catch {
      log('error', 'validate-license', 'invalid JSON for license', { code: normalizedCode.slice(0, 7) + '***' });
      return json({ ok: false, valid: false, error: "Invalid license data" }, 500, headers);
    }

    // Verificar estado de suscripción MP (suspendida o cancelada y vencida)
    if (license.status === 'payment_failed') {
      // Acceso suspendido por fallo de pago reiterado
      await delay(200);
      return json({ ok: true, valid: false, error: "payment_failed" }, 200, headers);
    }

    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      await delay(DELAY_ON_INVALID);
      return json({ ok: true, valid: false, error: "expired" }, 200, headers);
    }

    if (
      license.maxUses !== null &&
      (license.usedCount || 0) >= license.maxUses
    ) {
      await delay(DELAY_ON_INVALID);
      return json({ ok: true, valid: false, error: "limit_reached" }, 200, headers);
    }

    license.usedCount = (license.usedCount || 0) + 1;
    license.lastActivatedAt = new Date().toISOString();
    const putOpts = {};
    if (license.expiresAt) {
      const ttl = Math.floor((new Date(license.expiresAt).getTime() - Date.now()) / 1000) + 86400 * 30;
      if (ttl > 60) putOpts.expirationTtl = ttl;
    }
    try {
      await env.PT_LICENSES.put(
        `license:${normalizedCode}`,
        JSON.stringify(license),
        putOpts,
      );
    } catch (e) {
      log('error', 'validate-license', 'KV write failed', { error: e.message });
      return json({ ok: false, valid: false, error: 'Storage error' }, 500, headers);
    }

    log('info', 'validate-license', 'license activated', { code: normalizedCode.slice(0, 7) + '***', use: `${license.usedCount}/${license.maxUses ?? '∞'}` });
  } else {
    log('info', 'validate-license', 'owner code activated');
  }

  const encoder = new TextEncoder();

  // Generate unique nonce for this token (prevents replay attacks)
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Token with timestamp + nonce (format: "timestamp:nonce:signature")
  const timestamp = Math.floor(Date.now() / 1000);
  const tokenPayload = `${normalizedCode}:${timestamp}:${nonce}`;

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
    encoder.encode(tokenPayload),
  );
  const signature = Array.from(new Uint8Array(hmacBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Final token format: timestamp:nonce:signature
  const token = `${timestamp}:${nonce}:${signature}`;

  // ECDSA P-256 signature (for client-side verification via embedded public key)
  const signingKeyRaw = env.LICENSE_SIGNING_PRIVATE_KEY;
  if (!signingKeyRaw) {
    log('error', 'validate-license', 'LICENSE_SIGNING_PRIVATE_KEY not configured');
    return json({ ok: false, valid: false, error: "Server misconfigured" }, 500, headers);
  }
  let sig;
  try {
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
    sig = btoa(String.fromCharCode(...new Uint8Array(ecdsaBytes)));
  } catch (e) {
    log('error', 'validate-license', 'ECDSA signing failed', { error: e.message });
    return json({ ok: false, valid: false, error: "Server misconfigured" }, 500, headers);
  }

  return json({ ok: true, valid: true, token, sig }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

