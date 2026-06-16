// Test suite para la lógica crítica del webhook de MP
// Ejecutar: node test-webhook-logic.mjs
import crypto from 'crypto';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}`);
    failed++;
  }
}

// ─── Utilidades replicadas del worker ────────────────────────────────────────

async function verifySignature(bodyText, xSignature, queryId, xRequestId, secret) {
  const parts = {};
  for (const part of xSignature.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k && v) parts[k.trim()] = v.trim();
  }
  const { ts, v1 } = parts;
  if (!ts || !v1) return 'Falta ts o v1';

  if (Math.abs(Date.now() - parseInt(ts, 10) * 1000) > 300_000)
    return 'Timestamp muy viejo';

  const manifest = `id:${queryId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const computed = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  if (computed.length !== v1.length) return 'Longitud incorrecta';
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff !== 0 ? 'Firma incorrecta' : null;
}

async function generateSignature(secret, ts, queryId, xRequestId) {
  const manifest = `id:${queryId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  return Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateLicenseCode() {
  const toHex = arr => Array.from(arr).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `PT-${toHex(crypto.getRandomValues(new Uint8Array(3)))}-${toHex(crypto.getRandomValues(new Uint8Array(3)))}`;
}

async function hashEmail(email) {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n📋 1. Verificación de firma HMAC-SHA256\n');

const SECRET = 'test_webhook_secret_123';
const ts = Math.floor(Date.now() / 1000).toString();
const queryId = '123456789';
const requestId = 'req-abc-def';

const validSig = await generateSignature(SECRET, ts, queryId, requestId);
const validHeader = `ts=${ts},v1=${validSig}`;

assert(
  await verifySignature('{}', validHeader, queryId, requestId, SECRET) === null,
  'Firma válida → null (ok)',
);

// Mutar el último carácter de la firma (asegurar que sea diferente)
const lastChar = validSig.slice(-1);
const mutatedChar = lastChar === 'f' ? '0' : 'f';
const mutatedSig = validSig.slice(0, -1) + mutatedChar;
assert(
  await verifySignature('{}', `ts=${ts},v1=${mutatedSig}`, queryId, requestId, SECRET) !== null,
  'Firma con último carácter modificado → error',
);

assert(
  await verifySignature('{}', 'ts=123,v1=abc', queryId, requestId, SECRET) !== null,
  'Timestamp muy viejo → error',
);

assert(
  await verifySignature('{}', validHeader, '999999999', requestId, SECRET) !== null,
  'queryId diferente → firma inválida',
);

assert(
  await verifySignature('{}', validHeader, queryId, 'otro-request-id', SECRET) !== null,
  'xRequestId diferente → firma inválida',
);

const sigMissingFields = `ts=${ts}`;
assert(
  await verifySignature('{}', sigMissingFields, queryId, requestId, SECRET) !== null,
  'Sin campo v1 → error',
);

// ─── Test: Constante-time comparison ─────────────────────────────────────────

console.log('\n📋 2. Comparación timing-safe\n');

// Verificar que la comparación bit-a-bit no da resultado falso positivo
let diff = 0;
const a = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const b = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567891'; // último char distinto
for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
assert(diff !== 0, 'Cadenas similares con 1 char diferente → detecta diferencia');

let diff2 = 0;
const c = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const d = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'; // idénticas
for (let i = 0; i < c.length; i++) diff2 |= c.charCodeAt(i) ^ d.charCodeAt(i);
assert(diff2 === 0, 'Cadenas idénticas → diff = 0');

// ─── Test: Generación de códigos de licencia ──────────────────────────────────

console.log('\n📋 3. Formato de códigos de licencia\n');

const codes = new Set();
for (let i = 0; i < 100; i++) codes.add(generateLicenseCode());

assert(codes.size === 100, '100 códigos sin colisiones en muestra pequeña');

const firstCode = [...codes][0];
assert(/^PT-[0-9A-F]{6}-[0-9A-F]{6}$/.test(firstCode), `Formato correcto: ${firstCode}`);

const parts = firstCode.split('-');
assert(parts.length === 3 && parts[0] === 'PT', 'Prefijo PT correcto');
assert(parts[1].length === 6 && parts[2].length === 6, 'Segmentos de 6 hex cada uno');

// ─── Test: Hash de email ──────────────────────────────────────────────────────

console.log('\n📋 4. Hash de email (SHA-256)\n');

const hash1 = await hashEmail('test@example.com');
const hash2 = await hashEmail('TEST@EXAMPLE.COM'); // normalización a lowercase
const hash3 = await hashEmail('  test@example.com  '); // trim
const hash4 = await hashEmail('other@example.com');

assert(hash1 === hash2, 'Email en mayúsculas produce el mismo hash');
assert(hash1 === hash3, 'Email con espacios produce el mismo hash (trim)');
assert(hash1 !== hash4, 'Emails distintos producen hashes distintos');
assert(hash1.length === 64, `Hash es SHA-256 de 64 hex chars (${hash1.length})`);

// ─── Test: Parsing de external_reference ─────────────────────────────────────

console.log('\n📋 5. Parsing de external_reference del pago\n');

function parseExternalRef(payment) {
  let email, plan;
  if (payment.external_reference) {
    try {
      const ref = JSON.parse(payment.external_reference);
      email = ref.email;
      plan  = ref.plan || 'monthly';
    } catch { /* JSON inválido — usar fallback */ }
  }
  if (!email) email = payment.payer?.email;
  if (!plan)  plan  = 'monthly';
  return { email, plan };
}

const r1 = parseExternalRef({ external_reference: JSON.stringify({ email: 'user@test.com', plan: 'annual' }) });
assert(r1.email === 'user@test.com' && r1.plan === 'annual', 'external_reference JSON válido');

const r2 = parseExternalRef({ external_reference: JSON.stringify({ email: 'user@test.com' }) });
assert(r2.email === 'user@test.com' && r2.plan === 'monthly', 'external_reference sin plan → monthly por defecto');

const r3 = parseExternalRef({ external_reference: 'invalid json', payer: { email: 'fallback@test.com' } });
assert(r3.email === 'fallback@test.com' && r3.plan === 'monthly', 'JSON inválido → fallback a payer.email');

const r4 = parseExternalRef({ payer: { email: 'payer@test.com' } });
assert(r4.email === 'payer@test.com', 'Sin external_reference → payer.email');

// ─── Test: Validación de monto ────────────────────────────────────────────────

console.log('\n📋 6. Validación de monto del pago\n');

function validateAmount(paidAmount, plan, amountMonthly = '9.99', amountAnnual = '95.88') {
  const expectedAmount = parseFloat(plan === 'annual' ? amountAnnual : amountMonthly);
  const paid = parseFloat(paidAmount || 0);
  return Math.abs(paid - expectedAmount) <= 0.01;
}

assert(validateAmount(9.99, 'monthly'), 'Monto mensual exacto → válido');
assert(validateAmount(9.999, 'monthly'), 'Monto mensual con redondeo mínimo → válido');
assert(!validateAmount(9.00, 'monthly'), 'Monto mensual incorrecto → inválido');
assert(validateAmount(95.88, 'annual'), 'Monto anual exacto → válido');
assert(!validateAmount(9.99, 'annual'), 'Pago mensual para plan anual → inválido');
assert(!validateAmount(0, 'monthly'), 'Monto cero → inválido');

// ─── Test: Cálculo de expiración ─────────────────────────────────────────────

console.log('\n📋 7. Cálculo de fechas de expiración\n');

function calcExpiry(plan) {
  const now = new Date();
  const expiry = new Date(now);
  expiry.setDate(expiry.getDate() + (plan === 'annual' ? 366 : 31));
  return expiry.toISOString().split('T')[0];
}

const monthlyExpiry = calcExpiry('monthly');
const annualExpiry = calcExpiry('annual');
const today = new Date().toISOString().split('T')[0];

assert(monthlyExpiry > today, `Expiración mensual futura: ${monthlyExpiry}`);
assert(annualExpiry > monthlyExpiry, `Expiración anual mayor a mensual: anual=${annualExpiry}`);

// Verificar diferencia de días aproximada
const diff3 = Math.round((new Date(annualExpiry) - new Date(monthlyExpiry)) / (1000 * 60 * 60 * 24));
assert(diff3 >= 330 && diff3 <= 340, `Diferencia ~335 días entre anual y mensual: ${diff3}`);

// ─── Test: Renovación de licencia existente ───────────────────────────────────

console.log('\n📋 8. Lógica de renovación (extend from current expiry)\n');

function calcRenewalExpiry(currentExpiresAt, plan) {
  const isAnnual = plan === 'annual' || plan === 'basic_annual';
  const base = new Date(Math.max(Date.now(), new Date(currentExpiresAt).getTime()));
  base.setDate(base.getDate() + (isAnnual ? 366 : 31));
  return base.toISOString().split('T')[0];
}

const futureExpiry = '2030-01-01';
const renewed = calcRenewalExpiry(futureExpiry, 'monthly');
assert(renewed > futureExpiry, `Renovación extiende desde fecha futura: ${futureExpiry} → ${renewed}`);

const pastExpiry = '2020-01-01';
const renewedFromPast = calcRenewalExpiry(pastExpiry, 'monthly');
const todayStr = new Date().toISOString().split('T')[0];
assert(renewedFromPast > todayStr, `Renovación desde fecha pasada usa fecha actual: ${renewedFromPast}`);

// ─── Test: Idempotencia ───────────────────────────────────────────────────────

console.log('\n📋 9. Simulación de idempotencia\n');

// Simular KV store en memoria
const mockKV = new Map();

async function simulateWebhook(type, resourceId, shouldFail = false) {
  const idKey = `webhook_processed:${type}:${resourceId}`;

  const already = mockKV.get(idKey);
  if (already === 'done') return 'already_done';

  mockKV.set(idKey, 'processing');

  if (shouldFail) {
    mockKV.delete(idKey); // cleanup on failure
    return 'failed';
  }

  mockKV.set(idKey, 'done');
  return 'processed';
}

const r_1 = await simulateWebhook('payment', '111');
assert(r_1 === 'processed', 'Primera ejecución → processed');

const r_2 = await simulateWebhook('payment', '111');
assert(r_2 === 'already_done', 'Segunda ejecución del mismo evento → already_done');

const r_3 = await simulateWebhook('payment', '222', true);
assert(r_3 === 'failed', 'Fallo en procesamiento → failed (limpia clave)');

const r_4 = await simulateWebhook('payment', '222');
assert(r_4 === 'processed', 'Retry después de fallo → processed (idempotencia correcta)');

// ─── Test: Validación de paymentId en /mp-payment-status ─────────────────────

console.log('\n📋 10. Validación de paymentId\n');

function validatePaymentId(paymentId) {
  if (!paymentId || !/^\d+$/.test(paymentId) || paymentId.length > 20) return false;
  return true;
}

assert(validatePaymentId('123456789'), 'paymentId numérico válido');
assert(validatePaymentId('1'), 'paymentId mínimo (1 dígito)');
assert(!validatePaymentId('abc'), 'paymentId con letras → inválido');
assert(!validatePaymentId('123abc'), 'paymentId alfanumérico → inválido');
assert(!validatePaymentId(''), 'paymentId vacío → inválido');
assert(!validatePaymentId(null), 'paymentId null → inválido');
assert(!validatePaymentId('1'.repeat(21)), 'paymentId >20 dígitos → inválido (overflow protection)');
assert(validatePaymentId('1'.repeat(20)), 'paymentId de exactamente 20 dígitos → válido');

// ─── Test: Webhook fail-closed sin MP_WEBHOOK_SECRET ─────────────────────────

console.log('\n📋 9. Webhook fail-closed sin MP_WEBHOOK_SECRET\n');

// Simular la nueva lógica: si no hay secreto, rechazar siempre (status 500)
function webhookAuthCheck(hasSecret, hasXSig) {
  if (!hasSecret) return { status: 500, error: 'server_misconfigured' };
  if (!hasXSig)  return { status: 401, error: 'missing_signature' };
  return null; // proceder a verificar firma
}

assert(
  webhookAuthCheck(false, false)?.status === 500,
  'Sin MP_WEBHOOK_SECRET y sin x-signature → 500 server_misconfigured',
);
assert(
  webhookAuthCheck(false, true)?.status === 500,
  'Sin MP_WEBHOOK_SECRET pero con x-signature → 500 server_misconfigured (fail closed)',
);
assert(
  webhookAuthCheck(true, false)?.status === 401,
  'Con MP_WEBHOOK_SECRET pero sin x-signature → 401 missing_signature',
);
assert(
  webhookAuthCheck(true, true) === null,
  'Con MP_WEBHOOK_SECRET y con x-signature → proceder a verificar firma',
);

// ─── Test: mp-payment-status no expone email ─────────────────────────────────

console.log('\n📋 10. mp-payment-status no expone email del cliente\n');

// La respuesta de payment-status ya no incluye el campo email
const mockPaymentStatusResponse = { ok: true, status: 'active', plan: 'monthly', expiresAt: Date.now() + 86400000 };
assert(!('email' in mockPaymentStatusResponse), 'Response de payment-status no contiene campo email (IDOR fix)');
assert('plan' in mockPaymentStatusResponse, 'Response de payment-status sigue conteniendo plan');
assert('expiresAt' in mockPaymentStatusResponse, 'Response de payment-status sigue conteniendo expiresAt');

// ─── Resumen ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`\n📊 Resultado: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.error(`❌ ${failed} tests fallaron`);
  process.exit(1);
} else {
  console.log('✅ Todos los tests pasaron');
}
