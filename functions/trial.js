// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /trial (v2 — email OTP)
//
// POST /trial { step: "register", email, deviceId }
//   → Generate 6-digit OTP, store in KV (10 min TTL), send via Brevo
//   → Returns { sent: true }
//
// POST /trial { step: "verify", email, otp, deviceId }
//   → Verify OTP, anchor trial by email + device + IP
//   → Returns { startAt: number, verified: true }
//
// POST /trial { deviceId }  (legacy — no step)
//   → Backward compat: anchor by device + IP only
//   → Returns { startAt: number }
//
// KV keys:
//   trial_otp:{email_hash}   → JSON { otp, attempts, createdAt }  10 min TTL
//   trial_email:{email_hash} → plain timestamp string              90 day TTL
//   trial_dev:{device_hash}  → plain timestamp string              90 day TTL
//   trial_ip:{ip_hash}       → plain timestamp string              90 day TTL
//
// Env vars (Cloudflare Dashboard → Workers → Settings):
//   BREVO_API_KEY  — same as send-email.js
//   FROM_EMAIL     — verified sender address
//   FROM_NAME      — sender display name
//   PT_LICENSES    — KV binding
// ══════════════════════════════════════════════════════════════

import { corsHeaders, json, checkRateLimit, sha256, delay, isValidEmail, log, requireJson } from './_shared.js';

const KV_TTL_SECS = 90 * 24 * 60 * 60;
const OTP_TTL_SECS = 10 * 60;
const DELAY_MS = 1500; // anti-brute-force on wrong OTP

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (!env.PT_LICENSES) {
    return json({ ok: false, error: "KV not configured" }, 500, headers);
  }

  const ctError = requireJson(request, 4096);
  if (ctError) return json({ ok: false, error: ctError }, ctError === 'Payload too large' ? 413 : 415, headers);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request" }, 400, headers);
  }

  const step = body.step;

  if (step === "register") return handleRegister(body, ip, env, headers);
  if (step === "verify") return handleVerify(body, ip, env, headers);

  // Legacy path: { deviceId } sin step → deprecado, requiere OTP
  if (body.deviceId && !step) {
    return json({ ok: false, error: 'Verificación por email requerida. Actualizá la app.' }, 410, headers);
  }

  return json({ ok: false, error: "Invalid request" }, 400, headers);
}

// ── Step 1: Request OTP ───────────────────────────────────────

async function handleRegister(body, ip, env, headers) {
  const { email, deviceId } = body;

  if (!email || typeof email !== "string" || !isValidEmail(email)) {
    return json({ ok: false, error: "Email inválido" }, 400, headers);
  }

  const emailLower = email.toLowerCase().trim();
  const emailHash = await sha256(emailLower);

  // Rate limit: 10 OTP requests per IP per hour
  const rlIp = await checkRateLimit(
    env,
    `rl_otp_ip_${await sha256(ip)}`,
    10,
    3600,
  );
  if (rlIp)
    return json({ ok: false, error: "Demasiados intentos. Esperá 1 hora." }, 429, headers);

  // Rate limit: 10 OTP requests per email per hour
  const rlEmail = await checkRateLimit(env, `rl_otp_em_${emailHash}`, 10, 3600);
  if (rlEmail)
    return json(
      { ok: false, error: "Demasiados intentos para este email. Esperá 1 hora." },
      429,
      headers,
    );

  // Generación de OTP sin sesgo de módulo (rejection sampling)
  let otp;
  do {
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    otp = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  } while (otp >= 4294000000);
  otp = (otp % 1000000).toString().padStart(6, '0');

  // Store OTP
  await env.PT_LICENSES.put(
    `trial_otp:${emailHash}`,
    JSON.stringify({ otp, attempts: 0, createdAt: Date.now() }),
    { expirationTtl: OTP_TTL_SECS },
  );

  // Await email send — non-blocking caused Worker to terminate before Brevo got the request
  await sendOtpEmail(emailLower, otp, env).catch((e) =>
    log('error', 'trial', 'email send failed', { error: e?.message }),
  );

  log('info', 'trial', 'OTP sent');
  return json({ ok: true, sent: true }, 200, headers);
}

// ── Step 2: Verify OTP + anchor trial ────────────────────────

async function handleVerify(body, ip, env, headers) {
  const { email, otp, deviceId } = body;

  if (
    !email ||
    typeof email !== "string" ||
    !isValidEmail(email) ||
    !otp ||
    typeof otp !== "string" ||
    !/^\d{6}$/.test(otp)
  ) {
    return json({ ok: false, error: "Datos inválidos" }, 400, headers);
  }

  const emailLower = email.toLowerCase().trim();
  const emailHash = await sha256(emailLower);

  // Rate limit: 5 verify attempts per email per 15 min
  const rlVerify = await checkRateLimit(env, `rl_verify_${emailHash}`, 5, 900);
  if (rlVerify) {
    await delay(DELAY_MS);
    return json(
      { ok: false, error: "Demasiados intentos. Esperá 15 minutos." },
      429,
      headers,
    );
  }

  // Retrieve stored OTP
  const otpRaw = await env.PT_LICENSES.get(`trial_otp:${emailHash}`);
  if (!otpRaw) {
    await delay(DELAY_MS);
    return json(
      { ok: false, error: "El código expiró. Solicitá uno nuevo." },
      400,
      headers,
    );
  }

  let otpData;
  try {
    otpData = JSON.parse(otpRaw);
  } catch {
    return json({ ok: false, error: "Error interno" }, 500, headers);
  }

  // Too many failed attempts
  if ((otpData.attempts || 0) >= 5) {
    await delay(DELAY_MS);
    return json(
      { ok: false, error: "Código bloqueado. Solicitá uno nuevo." },
      400,
      headers,
    );
  }

  // Comparación timing-safe para evitar side-channel attacks
  const enc = new TextEncoder();
  const otpA = enc.encode(otpData.otp.padEnd(6, '\0'));
  const otpB = enc.encode(otp.padEnd(6, '\0'));
  let otpDiff = otpA.length ^ otpB.length;
  for (let i = 0; i < otpA.length; i++) otpDiff |= otpA[i] ^ otpB[i];
  if (otpDiff !== 0) {
    otpData.attempts = (otpData.attempts || 0) + 1;
    await env.PT_LICENSES.put(
      `trial_otp:${emailHash}`,
      JSON.stringify(otpData),
      {
        expirationTtl: OTP_TTL_SECS,
      },
    );
    await delay(DELAY_MS);
    return json(
      { ok: false, error: "Código incorrecto", attemptsLeft: 5 - otpData.attempts },
      400,
      headers,
    );
  }

  // ✓ Valid OTP — delete it immediately
  await env.PT_LICENSES.delete(`trial_otp:${emailHash}`);

  // Gather all known timestamps
  const now = Date.now();
  const ipHash = await sha256(ip);
  const devHash = deviceId ? await sha256(String(deviceId)) : null;

  const emailKey = `trial_email:${emailHash}`;
  const ipKey = `trial_ip:${ipHash}`;

  const [emailTs, ipTs] = await Promise.all([
    getTs(env, emailKey),
    getTs(env, ipKey),
  ]);

  let devTs = null;
  if (devHash) devTs = await getTs(env, `trial_dev:${devHash}`);

  // Use earliest known start across ALL anchors
  const startAt = Math.min(...[emailTs, ipTs, devTs, now].filter(Boolean));

  // Persist anchors
  const saves = [
    env.PT_LICENSES.put(emailKey, String(startAt), {
      expirationTtl: KV_TTL_SECS,
    }),
    env.PT_LICENSES.put(ipKey, String(startAt), { expirationTtl: KV_TTL_SECS }),
  ];
  if (devHash) {
    saves.push(
      env.PT_LICENSES.put(`trial_dev:${devHash}`, String(startAt), {
        expirationTtl: KV_TTL_SECS,
      }),
    );
  }
  await Promise.all(saves);

  // Generate sync token — same HMAC mechanism as /backup auth
  // Client uses (syncCode=emailHash, syncToken) to read/write cloud data in /sync
  let syncCode = null;
  let syncToken = null;
  const secret = env.LICENSE_SERVER_SECRET;
  if (secret) {
    syncCode = emailHash;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(emailHash),
    );
    syncToken = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  log('info', 'trial', 'OTP verified');
  return json({ ok: true, startAt, verified: true, syncCode, syncToken }, 200, headers);
}

// ── Helpers ───────────────────────────────────────────────────

async function getTs(env, key) {
  try {
    const raw = await env.PT_LICENSES.get(key);
    if (!raw) return null;
    // Support both plain string (legacy) and JSON { startAt }
    try {
      const parsed = JSON.parse(raw);
      return parsed.startAt || null;
    } catch {
      const n = parseInt(raw, 10);
      return isNaN(n) ? null : n;
    }
  } catch {
    return null;
  }
}

async function sendOtpEmail(email, otp, env) {
  const apiKey = env.BREVO_API_KEY;
  const fromEmail = env.FROM_EMAIL || "parfumtrack@gmail.com";
  const fromName = env.FROM_NAME || "Parfum Track";
  if (!apiKey) {
    log('error', 'trial', 'BREVO_API_KEY not set');
    return;
  }
  log('info', 'trial', 'sending OTP via Brevo');

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email }],
      subject: `Tu código de acceso a Parfum Track`,
      headers: {
        "List-Unsubscribe": `<mailto:parfumtrack@gmail.com?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      htmlContent: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:40px;margin-bottom:8px;">🍶</div>
      <h1 style="color:#c9a84c;font-size:22px;font-weight:700;margin:0;">Parfum Track</h1>
    </div>
    <div style="background:#161b22;border-radius:12px;padding:28px 24px;border:1px solid #30363d;">
      <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
        Tu código de verificación para comenzar el trial gratuito de 7 días:
      </p>
      <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:24px;text-align:center;margin-bottom:20px;">
        <span style="font-size:40px;font-weight:700;letter-spacing:14px;color:#c9a84c;font-family:monospace;">${otp}</span>
      </div>
      <p style="color:#6e7681;font-size:12px;margin:0;line-height:1.6;">
        Este código expira en <strong style="color:#8b949e;">10 minutos</strong>.<br>
        Si no solicitaste esto, ignorá este mensaje.
      </p>
    </div>
    <p style="color:#4a4848;font-size:12px;text-align:center;margin-top:24px;line-height:1.6;">
      Parfum Track — parfumtrack@gmail.com
    </p>
  </div>
</body>
</html>`,
    }),
    signal: AbortSignal.timeout(8000),
  }).then(async (res) => {
    if (!res.ok) {
      log('error', 'trial', 'Brevo error', { status: res.status });
    } else {
      log('info', 'trial', 'Brevo OK', { status: res.status });
    }
  });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
