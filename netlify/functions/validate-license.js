// ══════════════════════════════════════════════════════════════
// Parfum Track — Netlify Function: validate-license
// POST /.netlify/functions/validate-license
// Body: { code: "PT-XXXX-YYYY" }
//
// Variables de entorno requeridas en Netlify → Site Settings → Env Variables:
//   VALID_LICENSE_CODES  = "PT-AAAA-1111,PT-BBBB-2222"  (separados por coma)
//   LICENSE_SERVER_SECRET = "un-secreto-largo-y-aleatorio-que-solo-vive-en-el-servidor"
//
// Cómo generar LICENSE_SERVER_SECRET:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');

// Tiempo mínimo entre intentos por IP (ms) — anti brute-force básico
const DELAY_ON_INVALID = 600;

exports.handler = async (event) => {
  // Solo aceptar POST
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(event), body: 'Method Not Allowed' };
  }

  const headers = corsHeaders(event);

  // Parsear body
  let code;
  try {
    ({ code } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ valid: false, error: 'Bad request' }) };
  }

  // Validación básica de formato
  if (!code || typeof code !== 'string' || code.length > 64) {
    return { statusCode: 400, headers, body: JSON.stringify({ valid: false }) };
  }

  const normalizedCode = code.trim().toUpperCase();

  // Leer lista de códigos válidos desde variable de entorno
  const secret = process.env.LICENSE_SERVER_SECRET;
  const rawCodes = process.env.VALID_LICENSE_CODES || '';

  if (!secret) {
    console.error('[validate-license] FATAL: LICENSE_SERVER_SECRET no configurada');
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false, error: 'Server configuration error' }) };
  }

  const validCodes = rawCodes.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

  if (!validCodes.includes(normalizedCode)) {
    // Delay para dificultar brute force
    await delay(DELAY_ON_INVALID);
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false }) };
  }

  // Generar token firmado por el servidor
  // token = HMAC-SHA256( code + ':' + activatedAt , LICENSE_SERVER_SECRET )
  const activatedAt = Date.now().toString();
  const payload = `${normalizedCode}:${activatedAt}`;
  const token = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  console.log(`[validate-license] Licencia activada: ${normalizedCode.slice(0, 5)}...`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      valid: true,
      token,
      activatedAt,
      // El código nunca viaja de vuelta — solo el token y el timestamp
    }),
  };
};

// ── Helpers ──────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function corsHeaders(event) {
  // Solo permitir el origen propio de Netlify (o localhost en dev)
  const origin = event.headers?.origin || '';
  const allowed = /^https:\/\/(localhost|127\.0\.0\.1|.*\.netlify\.app)(:\d+)?$/.test(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
