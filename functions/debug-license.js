// Debug endpoint to check if a license exists in KV
// GET /debug-license?code=PT-LUCCAS-OWNER001

import { json, corsHeaders } from './_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  const url = new URL(request.url);
  const code = url.searchParams.get('code')?.trim().toUpperCase() || "";

  if (!code) {
    return json({ ok: false, error: "Missing code parameter" }, 400, headers);
  }

  if (!env.PT_LICENSES) {
    return json({ ok: false, error: "KV not configured" }, 500, headers);
  }

  const licenseRaw = await env.PT_LICENSES.get(`license:${code}`);

  if (!licenseRaw) {
    return json({
      ok: false,
      found: false,
      code,
      message: `License ${code} NOT found in KV`,
      kvKey: `license:${code}`
    }, 200, headers);
  }

  let license;
  try {
    license = JSON.parse(licenseRaw);
  } catch {
    return json({
      ok: false,
      found: true,
      code,
      message: "License data corrupted",
      raw: licenseRaw.substring(0, 100)
    }, 200, headers);
  }

  return json({
    ok: true,
    found: true,
    code,
    license,
    message: "License FOUND and valid"
  }, 200, headers);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
