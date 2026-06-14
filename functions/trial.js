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

const KV_TTL_SECS = 90 * 24 * 60 * 60;
const OTP_TTL_SECS = 10 * 60;
const DELAY_MS = 1500; // anti-brute-force on wrong OTP

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (!env.PT_LICENSES) {
    return json({ error: "KV not configured" }, 500, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400, headers);
  }

  const step = body.step;

  if (step === "register") return handleRegister(body, ip, env, headers);
  if (step === "verify") return handleVerify(body, ip, env, headers);

  // Legacy path: { deviceId } with no step
  if (body.deviceId && !step) return handleLegacy(body, ip, env, headers);

  return json({ error: "Invalid request" }, 400, headers);
}

// ── Step 1: Request OTP ───────────────────────────────────────

async function handleRegister(body, ip, env, headers) {
  const { email, deviceId } = body;

  if (!email || typeof email !== "string" || !isValidEmail(email)) {
    return json({ error: "Email inválido" }, 400, headers);
  }

  const emailLower = email.toLowerCase().trim();
  const emailHash = await sha256(emailLower);

  // Rate limit: 3 OTP requests per IP per hour
  const rlIp = await checkRateLimit(
    env,
    `rl_otp_ip_${await sha256(ip)}`,
    3,
    3600,
  );
  if (rlIp)
    return json({ error: "Demasiados intentos. Esperá 1 hora." }, 429, headers);

  // Rate limit: 3 OTP requests per email per hour
  const rlEmail = await checkRateLimit(env, `rl_otp_em_${emailHash}`, 3, 3600);
  if (rlEmail)
    return json(
      { error: "Demasiados intentos para este email. Esperá 1 hora." },
      429,
      headers,
    );

  // Generate 6-digit OTP using cryptographically random source
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  const otp = String(100000 + (rand[0] % 900000));

  // Store OTP
  await env.PT_LICENSES.put(
    `trial_otp:${emailHash}`,
    JSON.stringify({ otp, attempts: 0, createdAt: Date.now() }),
    { expirationTtl: OTP_TTL_SECS },
  );

  // Await email send — non-blocking caused Worker to terminate before Brevo got the request
  await sendOtpEmail(emailLower, otp, env).catch((e) =>
    console.error("[trial] email error:", e?.message),
  );

  console.log(`[trial] OTP sent to ***@${emailLower.split("@")[1]}`);
  return json({ sent: true }, 200, headers);
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
    return json({ error: "Datos inválidos" }, 400, headers);
  }

  const emailLower = email.toLowerCase().trim();
  const emailHash = await sha256(emailLower);

  // Rate limit: 5 verify attempts per email per 15 min
  const rlVerify = await checkRateLimit(env, `rl_verify_${emailHash}`, 5, 900);
  if (rlVerify) {
    await delay(DELAY_MS);
    return json(
      { error: "Demasiados intentos. Esperá 15 minutos." },
      429,
      headers,
    );
  }

  // Retrieve stored OTP
  const otpRaw = await env.PT_LICENSES.get(`trial_otp:${emailHash}`);
  if (!otpRaw) {
    await delay(DELAY_MS);
    return json(
      { error: "El código expiró. Solicitá uno nuevo." },
      400,
      headers,
    );
  }

  let otpData;
  try {
    otpData = JSON.parse(otpRaw);
  } catch {
    return json({ error: "Error interno" }, 500, headers);
  }

  // Too many failed attempts
  if ((otpData.attempts || 0) >= 5) {
    await delay(DELAY_MS);
    return json(
      { error: "Código bloqueado. Solicitá uno nuevo." },
      400,
      headers,
    );
  }

  // Wrong OTP
  if (otpData.otp !== otp) {
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
      { error: "Código incorrecto", attemptsLeft: 5 - otpData.attempts },
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

  console.log(
    `[trial] Verified: ***@${emailLower.split("@")[1]} → startAt ${new Date(startAt).toISOString()}`,
  );
  return json({ startAt, verified: true, syncCode, syncToken }, 200, headers);
}

// ── Legacy: { deviceId } with no step ────────────────────────

async function handleLegacy(body, ip, env, headers) {
  const { deviceId } = body;

  // Rate limit: 20 req/hr per IP
  const ipHash = await sha256(ip);
  const rl = await checkRateLimit(env, `rl_trial_ip_${ipHash}`, 20, 3600);
  if (rl) return json({ error: rl }, 429, headers);

  const now = Date.now();
  const ipKey = `trial_ip:${ipHash}`;
  const devHash = deviceId ? await sha256(String(deviceId)) : null;
  const devKey = devHash ? `trial_dev:${devHash}` : null;

  const [ipTs, devTs] = await Promise.all([
    getTs(env, ipKey),
    devKey ? getTs(env, devKey) : Promise.resolve(null),
  ]);

  const startAt = Math.min(...[ipTs, devTs, now].filter(Boolean));

  const saves = [];
  if (!ipTs)
    saves.push(
      env.PT_LICENSES.put(ipKey, String(startAt), {
        expirationTtl: KV_TTL_SECS,
      }),
    );
  if (devKey && !devTs)
    saves.push(
      env.PT_LICENSES.put(devKey, String(startAt), {
        expirationTtl: KV_TTL_SECS,
      }),
    );
  if (saves.length) await Promise.all(saves);

  return json({ startAt }, 200, headers);
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

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
  );
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

async function sendOtpEmail(email, otp, env) {
  const apiKey = env.BREVO_API_KEY;
  const fromEmail = env.FROM_EMAIL || "noreply@parfumtrack.com";
  const fromName = env.FROM_NAME || "Parfum Track";
  if (!apiKey) {
    console.error("[trial] BREVO_API_KEY not set — email not sent");
    return;
  }

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email }],
      subject: `${otp} — tu código de verificación Parfum Track`,
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
  </div>
</body>
</html>`,
    }),
    signal: AbortSignal.timeout(8000),
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[trial] Brevo error ${res.status}: ${body}`);
    }
  });
}

async function checkRateLimit(env, key, max, windowSecs) {
  const now = Math.floor(Date.now() / 1000);
  const windowKey = `${key}_${Math.floor(now / windowSecs)}`;
  let count = 0;
  try {
    const stored = await env.PT_LICENSES.get(windowKey);
    count = stored ? parseInt(stored, 10) : 0;
  } catch {
    return null;
  }
  if (count >= max) return "Too many requests";
  try {
    await env.PT_LICENSES.put(windowKey, String(count + 1), {
      expirationTtl: windowSecs * 2,
    });
  } catch {
    /* non-blocking */
  }
  return null;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
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

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
