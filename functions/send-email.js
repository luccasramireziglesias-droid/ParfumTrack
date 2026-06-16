// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: send-email
// POST /send-email
// Body: { to, toName, template, data }
//
// Variables de entorno en Cloudflare Worker → Settings → Variables:
//   BREVO_API_KEY  = "xkeysib-..."   (tu API key de Brevo / Sendinblue)
//   FROM_EMAIL     = "hola@tudominio.com"
//   FROM_NAME      = "Parfum Track"
//
// Templates disponibles:
//   "trial_welcome"   — Email de bienvenida al trial (día 0)
//   "trial_reminder"  — Recordatorio 2 días antes de vencer (día 5)
//   "trial_expired"   — Trial vencido, invitación a activar
// ══════════════════════════════════════════════════════════════

const TEMPLATES = {
  trial_welcome: (data) => ({
    subject: `¡Hola, ${data.name}! Tu prueba gratuita ya está activa 🌸`,
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:36px;margin-bottom:8px;">🌸</div>
      <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
    </div>

    <!-- Card -->
    <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(255,255,255,0.1);">
      <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">
        ¡Hola, ${data.name}! 👋
      </h2>
      <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
        Tu prueba gratuita de <strong style="color:#e8cc7a;">7 días completos</strong> ya está activa.
        Podés registrar ventas, gastos, cuotas y ver todas las estadísticas sin límites.
      </p>

      <!-- Features list -->
      <div style="margin-bottom:24px;">
        ${[
          "💵 Registrá ventas en segundos",
          "🗓️ Cobrá en cuotas con recordatorios",
          "📊 Estadísticas automáticas del mes",
          "📲 Enviá recordatorios por WhatsApp",
          "📤 Exportá todo a Excel",
        ]
          .map(
            (f) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:14px;color:#b8b4a8;">${f}</span>
        </div>`,
          )
          .join("")}
      </div>

      <!-- CTA -->
      <a href="${data.appUrl || "https://parfumtrack.pages.dev"}"
         style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;margin-bottom:16px;">
        Abrir Parfum Track →
      </a>

      <p style="color:#7a7870;font-size:12px;text-align:center;margin:0;">
        Tu prueba vence en 7 días. No necesitás tarjeta de crédito.
      </p>
    </div>

    <!-- Footer -->
    <p style="color:#4a4848;font-size:12px;text-align:center;margin-top:24px;line-height:1.6;">
      Recibiste este email porque te registraste en Parfum Track.<br>
      <a href="${data.appUrl || "https://parfumtrack.pages.dev"}" style="color:#c9a84c;">parfumtrack.pages.dev</a>
    </p>
  </div>
</body>
</html>`,
    text: `¡Hola ${data.name}! Tu prueba gratuita de 7 días de Parfum Track ya está activa. Abrí la app: ${data.appUrl || "https://parfumtrack.pages.dev"}`,
  }),

  trial_reminder: (data) => ({
    subject: `⏰ Tu prueba de Parfum Track vence en ${data.daysLeft} día${data.daysLeft !== 1 ? "s" : ""}`,
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">

    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:36px;margin-bottom:8px;">⏰</div>
      <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
    </div>

    <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(201,168,76,0.3);">
      <!-- Urgency badge -->
      <div style="background:rgba(224,176,96,0.15);border:1px solid rgba(224,176,96,0.3);border-radius:8px;padding:10px 14px;margin-bottom:20px;text-align:center;">
        <span style="color:#e8cc7a;font-size:13px;font-weight:700;">
          ⚠ Quedan ${data.daysLeft} día${data.daysLeft !== 1 ? "s" : ""} de prueba gratuita
        </span>
      </div>

      <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">
        Hola ${data.name}, ¿cómo va el negocio?
      </h2>
      <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
        Tu prueba de Parfum Track vence pronto. Para seguir teniendo acceso completo
        a todas las funciones, activá tu licencia antes de que expire.
      </p>

      <!-- Stats highlight if available -->
      ${
        data.ventas
          ? `
      <div style="background:#13132a;border-radius:12px;padding:16px;margin-bottom:20px;">
        <p style="color:#7a7870;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Durante tu prueba registraste</p>
        <p style="color:#e8cc7a;font-size:24px;font-weight:800;margin:0;">${data.ventas} ventas</p>
      </div>`
          : ""
      }

      <a href="${data.appUrl || "https://parfumtrack.pages.dev"}#activar"
         style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8cc7a);color:#1a1a2e;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;margin-bottom:12px;">
        🔑 Activar mi licencia ahora
      </a>
      <a href="${data.waUrl || "#"}"
         style="display:block;text-align:center;background:transparent;border:1.5px solid rgba(255,255,255,0.15);color:#b8b4a8;padding:12px 24px;border-radius:50px;font-size:14px;font-weight:600;text-decoration:none;">
        📲 Consultar por WhatsApp
      </a>
    </div>

    <p style="color:#4a4848;font-size:12px;text-align:center;margin-top:24px;line-height:1.6;">
      <a href="${data.appUrl || "https://parfumtrack.pages.dev"}" style="color:#c9a84c;">parfumtrack.pages.dev</a>
    </p>
  </div>
</body>
</html>`,
    text: `Hola ${data.name}, tu prueba de Parfum Track vence en ${data.daysLeft} días. Activá tu licencia: ${data.appUrl || "https://parfumtrack.pages.dev"}`,
  }),

  trial_expired: (data) => ({
    subject: `Tu prueba de Parfum Track venció — activá tu plan 🌸`,
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">

    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:36px;margin-bottom:8px;">🌸</div>
      <h1 style="color:#e8cc7a;font-size:24px;font-weight:700;margin:0;">Parfum Track</h1>
    </div>

    <div style="background:#1e1e35;border-radius:16px;padding:28px 24px;border:1px solid rgba(255,255,255,0.1);">
      <h2 style="color:#f0eee8;font-size:20px;font-weight:700;margin:0 0 12px;">
        Tu prueba gratuita venció, ${data.name}
      </h2>
      <p style="color:#b8b4a8;font-size:15px;line-height:1.7;margin:0 0 20px;">
        Tus datos están guardados y seguros en tu celular. Para seguir registrando ventas
        sin límite, activá el plan Básico Pro.
      </p>

      <!-- Pricing highlight -->
      <div style="background:linear-gradient(135deg,rgba(201,168,76,0.12),rgba(201,168,76,0.04));border:1px solid rgba(201,168,76,0.3);border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
        <p style="color:#e8cc7a;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin:0 0 6px;">Plan Básico Pro — más popular</p>
        <p style="color:#f0eee8;font-size:32px;font-weight:800;margin:0 0 4px;">$9.99 <span style="font-size:16px;color:#b8b4a8;font-weight:400;">USD/mes</span></p>
        <p style="color:#7a7870;font-size:13px;margin:0;">o $7.99/mes eligiendo el plan anual · Cancelás cuando querés</p>
      </div>

      <a href="${data.appUrl || "https://parfumtrack.pages.dev"}/landing.html#pricing"
         style="display:block;text-align:center;background:linear-gradient(135deg,#009ee3,#0070ba);color:#fff;padding:14px 24px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;margin-bottom:12px;">
        Activar plan con Mercado Pago →
      </a>
      <a href="${data.waUrl || "#"}"
         style="display:block;text-align:center;background:transparent;border:1.5px solid rgba(255,255,255,0.15);color:#b8b4a8;padding:12px 24px;border-radius:50px;font-size:14px;font-weight:600;text-decoration:none;">
        📲 Consultar por WhatsApp
      </a>
    </div>

    <p style="color:#4a4848;font-size:12px;text-align:center;margin-top:24px;line-height:1.6;">
      <a href="${data.appUrl || "https://parfumtrack.pages.dev"}" style="color:#c9a84c;">parfumtrack.pages.dev</a>
    </p>
  </div>
</body>
</html>`,
    text: `Tu prueba de Parfum Track venció, ${data.name}. Activá el plan Básico Pro por $9.99/mes: ${data.appUrl || "https://parfumtrack.pages.dev"}/landing.html#pricing`,
  }),
};

// Escape HTML special chars to prevent injection into email templates
function sanitize(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
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

// ── Main handler ─────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  // Rate limit by IP: max 5 email requests/hour
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipLimitError = await checkRateLimit(env, `rl_email_ip_${ip}`, 5, 3600);
  if (ipLimitError)
    return new Response(JSON.stringify({ ok: false, error: ipLimitError }), {
      status: 429,
      headers,
    });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Bad request" }), {
      status: 400,
      headers,
    });
  }

  const { to, toName, template, data = {} } = body;

  if (!to || !template || !TEMPLATES[template]) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing or invalid fields" }),
      { status: 400, headers },
    );
  }

  if (
    typeof to !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to) ||
    to.length > 320
  ) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid email address" }),
      { status: 400, headers },
    );
  }

  // Rate limit by destination email: max 3 emails/24h per address
  const emailKey = to
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, "")
    .slice(0, 100);
  const emailLimitError = await checkRateLimit(
    env,
    `rl_email_to_${emailKey}`,
    3,
    86400,
  );
  if (emailLimitError)
    return new Response(JSON.stringify({ ok: false, error: emailLimitError }), {
      status: 429,
      headers,
    });

  const apiKey = env.BREVO_API_KEY;
  const fromEmail = env.FROM_EMAIL || "hola@parfumtrack.com";
  const fromName = env.FROM_NAME || "Parfum Track";

  if (!apiKey) {
    console.error("[send-email] BREVO_API_KEY not configured");
    return new Response(
      JSON.stringify({ ok: false, error: "Email service not configured" }),
      { status: 500, headers },
    );
  }

  // Sanitize all user-supplied fields before interpolation into HTML templates
  const safeName = sanitize((toName || to.split("@")[0]).slice(0, 80));
  const safeData = {
    name: safeName,
    daysLeft: Math.max(0, parseInt(data.daysLeft, 10) || 0),
    ventas: Math.max(0, parseInt(data.ventas, 10) || 0),
    appUrl: /^https:\/\//.test(data.appUrl || "")
      ? data.appUrl
      : "https://parfumtrack.pages.dev",
    waUrl: /^https:\/\//.test(data.waUrl || "") ? data.waUrl : null,
  };
  const tpl = TEMPLATES[template](safeData);

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email: to, name: toName || "" }],
    subject: tpl.subject,
    htmlContent: tpl.html,
    textContent: tpl.text,
  };

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error("[send-email] Brevo error:", resp.status, err);
      return new Response(
        JSON.stringify({ ok: false, error: `Brevo ${resp.status}` }),
        { status: 200, headers },
      );
    }

    const result = await resp.json();
    console.log(
      "[send-email] Sent:",
      template,
      "to",
      to,
      "— messageId:",
      result.messageId,
    );
    return new Response(
      JSON.stringify({ ok: true, messageId: result.messageId }),
      { status: 200, headers },
    );
  } catch (e) {
    console.error("[send-email] Fetch error:", e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers,
    });
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function corsHeaders(origin) {
  const allowed =
    /^https?:\/\/(localhost|127\.0\.0\.1|parfumtrack\.pages\.dev|parfumtrack\.luccasramireziglesias\.workers\.dev)(:\d+)?$/.test(
      origin,
    );
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
