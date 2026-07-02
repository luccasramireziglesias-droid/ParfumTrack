// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Worker Function: /generate-owner-license
// TEMPORAL ENDPOINT — Eliminar después de generar la licencia del owner
// POST /generate-owner-license → { secret: "OWNER_SETUP_SECRET_123" }
// ══════════════════════════════════════════════════════════════

import { corsHeaders, json, log, parseJsonBody } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  // Parse body
  const { data: bodyData, error: parseError } = await parseJsonBody(request, 4096);
  if (parseError) return json({ ok: false, error: 'Bad request' }, 400, headers);

  const secret = bodyData?.secret || "";
  const ownerSecret = env.OWNER_LICENSE_SECRET || "temp-owner-setup";

  // Very basic validation (should be removed after use)
  if (secret !== ownerSecret) {
    log('warn', 'generate-owner-license', 'Invalid secret provided');
    return json({ ok: false, error: "Invalid secret" }, 403, headers);
  }

  if (!env.PT_LICENSES) {
    log('error', 'generate-owner-license', 'KV binding not found');
    return json({ ok: false, error: "Server misconfigured" }, 500, headers);
  }

  // Generate unique license code
  const part1 = Math.random().toString(36).substr(2, 6).toUpperCase();
  const part2 = Math.random().toString(36).substr(2, 8).toUpperCase();
  const code = `PT-${part1}-${part2}`;

  // Create license object
  const licenseData = {
    clientName: 'Luccas Ramírez (Owner)',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString(),
    maxUses: null,
    usedCount: 0,
    lastActivatedAt: null,
    status: 'active',
    isOwner: true
  };

  // Insert into KV
  try {
    await env.PT_LICENSES.put(`license:${code}`, JSON.stringify(licenseData));
    log('info', 'generate-owner-license', 'Owner license created', { code: code.slice(0, 7) + '***' });
    return json({ ok: true, code }, 200, headers);
  } catch (e) {
    log('error', 'generate-owner-license', 'KV write failed', { error: e.message });
    return json({ ok: false, error: 'Storage error' }, 500, headers);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  // Parse query parameter: ?secret=temp-owner-setup
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret') || "";
  const ownerSecret = env.OWNER_LICENSE_SECRET || "temp-owner-setup";

  if (secret !== ownerSecret) {
    return new Response(
      '<html><body style="background:#0f0f1a;color:#f0ece4;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;">' +
      '<div><h2 style="color:#e07070;">❌ Acceso denegado</h2><p>Secret inválido</p></div>' +
      '</body></html>',
      { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  if (!env.PT_LICENSES) {
    log('error', 'generate-owner-license', 'KV binding not found');
    return new Response(
      '<html><body style="background:#0f0f1a;color:#f0ece4;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;">' +
      '<div><h2 style="color:#e07070;">❌ Error del servidor</h2></div>' +
      '</body></html>',
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const part1 = Math.random().toString(36).substr(2, 6).toUpperCase();
  const part2 = Math.random().toString(36).substr(2, 8).toUpperCase();
  const code = `PT-${part1}-${part2}`;

  const licenseData = {
    clientName: 'Luccas Ramírez (Owner)',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString(),
    maxUses: null,
    usedCount: 0,
    lastActivatedAt: null,
    status: 'active',
    isOwner: true
  };

  try {
    await env.PT_LICENSES.put(`license:${code}`, JSON.stringify(licenseData));
    log('info', 'generate-owner-license', 'Owner license created (GET)', { code: code.slice(0, 7) + '***' });

    return new Response(
      `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Licencia Generada</title></head>` +
      `<body style="background:#0f0f1a;color:#f0ece4;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center;">` +
      `<div style="max-width:400px;">` +
      `<div style="font-size:48px;margin-bottom:16px;">🍶</div>` +
      `<h2 style="color:#e8c97e;margin:0 0 8px 0;">¡Licencia de owner generada!</h2>` +
      `<div style="background:#1a1a2e;border-radius:12px;padding:16px;margin:16px 0;border:2px solid #c9a84c;">` +
      `<div style="font-size:12px;color:#999;margin-bottom:8px;">Tu código:</div>` +
      `<div style="font-size:24px;font-weight:bold;font-family:monospace;letter-spacing:2px;color:#e8c97e;">${code}</div>` +
      `</div>` +
      `<p style="color:#999;font-size:14px;margin:16px 0;">Ahora en la app:</p>` +
      `<ol style="text-align:left;color:#f0ece4;margin:16px 0;">` +
      `<li>Ve a "Mi Cuenta"</li>` +
      `<li>Pega el código arriba</li>` +
      `<li>Haz clic en "Activar código"</li>` +
      `</ol>` +
      `</div>` +
      `</body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  } catch (e) {
    log('error', 'generate-owner-license', 'KV write failed', { error: e.message });
    return new Response(
      '<html><body style="background:#0f0f1a;color:#f0ece4;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;">' +
      '<div><h2 style="color:#e07070;">❌ Error al guardar</h2></div>' +
      '</body></html>',
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
