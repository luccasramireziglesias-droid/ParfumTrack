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

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
