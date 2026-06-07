// ══════════════════════════════════════════════════════════════
// Parfum Track — Netlify Function: verify-token
// POST /.netlify/functions/verify-token
// Body: { token: "64-hex...", activatedAt: "1234567890", code: "PT-XXXX-YYYY" }
//
// Verifica que el token almacenado en el cliente sea auténtico
// (generado por este servidor) y que el código siga siendo válido.
// Se llama silenciosamente en segundo plano cada 7 días.
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');

const DELAY_ON_INVALID = 300;
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(event), body: 'Method Not Allowed' };
  }

  const headers = corsHeaders(event);

  let token, activatedAt, code;
  try {
    ({ token, activatedAt, code } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ valid: false }) };
  }

  // Validaciones de formato
  if (!token || !activatedAt || !code ||
      typeof token !== 'string' || token.length !== 64 ||
      !/^[0-9a-f]+$/.test(token)) {
    return { statusCode: 400, headers, body: JSON.stringify({ valid: false }) };
  }

  const secret = process.env.LICENSE_SERVER_SECRET;
  if (!secret) {
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false }) };
  }

  const normalizedCode = code.trim().toUpperCase();

  // Recomputar el token esperado
  const payload = `${normalizedCode}:${activatedAt}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  // Comparación en tiempo constante (previene timing attacks)
  let tokensMatch = false;
  try {
    tokensMatch = crypto.timingSafeEqual(
      Buffer.from(token, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false }) };
  }

  if (!tokensMatch) {
    await delay(DELAY_ON_INVALID);
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'invalid_token' }) };
  }

  // Verificar que el código siga en la lista activa (permite revocar licencias)
  const validCodes = (process.env.VALID_LICENSE_CODES || '')
    .split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

  if (!validCodes.includes(normalizedCode)) {
    await delay(DELAY_ON_INVALID);
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'revoked' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ valid: true }) };
};

function corsHeaders(event) {
  const origin = event.headers?.origin || '';
  const allowed = /^https:\/\/(localhost|127\.0\.0\.1|.*\.netlify\.app)(:\d+)?$/.test(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
