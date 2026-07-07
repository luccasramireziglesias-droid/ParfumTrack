import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { onRequestPost: createPref, onRequestOptions: createPrefOptions } = await import('../functions/mp-create-preference.js');
const { onRequestGet: subStatus, onRequestOptions: subStatusOptions } = await import('../functions/mp-subscription-status.js');
const { onRequestGet: payStatus, onRequestOptions: payStatusOptions } = await import('../functions/mp-payment-status.js');

// ── Helpers ─────────────────────────────────────────────────────

const SECRET = 'test-mp-secret';

function mockKV(store = {}) {
  return {
    get: vi.fn(async (key) => store[key] ?? null),
    put: vi.fn(async (key, val) => { store[key] = val; }),
  };
}

async function generateToken(code, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(code));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function emailSha256(email) {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeEnv(overrides = {}) {
  return {
    LICENSE_SERVER_SECRET: SECRET,
    PT_LICENSES: mockKV(),
    MP_ACCESS_TOKEN: 'TEST-TOKEN',
    MP_CURRENCY_ID: 'USD',
    MP_AMOUNT_MONTHLY: '9.99',
    MP_AMOUNT_ANNUAL: '95.88',
    APP_URL: 'https://parfumtrack.luccasramireziglesias.workers.dev',
    ...overrides,
  };
}

let consoleSpy;

beforeEach(() => {
  vi.clearAllMocks();
  consoleSpy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
});

afterEach(() => {
  Object.values(consoleSpy).forEach(s => s.mockRestore());
  vi.restoreAllMocks();
});

// ── mp-create-preference ─────────────────────────────────────

describe('mp-create-preference', () => {
  it('OPTIONS returns 204', async () => {
    const resp = await createPrefOptions({
      request: new Request('https://test.com/mp-create-preference', {
        headers: { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' },
      }),
    });
    expect(resp.status).toBe(204);
  });

  it('creates preference for registered user', async () => {
    const hash = await emailSha256('user@test.com');
    const kv = mockKV({ [`trial_email:${hash}`]: '12345' });
    const env = makeEnv({ PT_LICENSES: kv });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'pref-123',
      init_point: 'https://www.mercadopago.com/checkout/v1/redirect?pref=pref-123',
    }), { status: 201 })));

    const request = new Request('https://test.com/mp-create-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', 'X-CSRF-Token': '0'.repeat(64) },
      body: JSON.stringify({ email: 'user@test.com', plan: 'monthly' }),
    });
    const resp = await createPref({ request, env });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.initPoint).toContain('mercadopago');

    vi.unstubAllGlobals();
  });

  it('rejects invalid email', async () => {
    const env = makeEnv();
    const request = new Request('https://test.com/mp-create-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', 'X-CSRF-Token': '0'.repeat(64) },
      body: JSON.stringify({ email: 'bad', plan: 'monthly' }),
    });
    const resp = await createPref({ request, env });
    expect(resp.status).toBe(400);
  });

  it('rejects invalid plan', async () => {
    const env = makeEnv();
    const request = new Request('https://test.com/mp-create-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', 'X-CSRF-Token': '0'.repeat(64) },
      body: JSON.stringify({ email: 'user@test.com', plan: 'premium' }),
    });
    const resp = await createPref({ request, env });
    expect(resp.status).toBe(400);
  });

  it('rejects unregistered email', async () => {
    const env = makeEnv();
    const request = new Request('https://test.com/mp-create-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', 'X-CSRF-Token': '0'.repeat(64) },
      body: JSON.stringify({ email: 'unknown@test.com', plan: 'monthly' }),
    });
    const resp = await createPref({ request, env });
    expect(resp.status).toBe(403);
  });

  it('returns 503 when MP_ACCESS_TOKEN missing', async () => {
    const hash = await emailSha256('user@test.com');
    const kv = mockKV({ [`trial_email:${hash}`]: '12345' });
    const env = makeEnv({ PT_LICENSES: kv, MP_ACCESS_TOKEN: undefined });
    const request = new Request('https://test.com/mp-create-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', 'X-CSRF-Token': '0'.repeat(64) },
      body: JSON.stringify({ email: 'user@test.com', plan: 'monthly' }),
    });
    const resp = await createPref({ request, env });
    expect(resp.status).toBe(503);
  });
});

// ── mp-subscription-status ───────────────────────────────────

describe('mp-subscription-status', () => {
  it('OPTIONS returns 204', async () => {
    const resp = await subStatusOptions({
      request: new Request('https://test.com/mp-subscription-status', {
        headers: { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' },
      }),
    });
    expect(resp.status).toBe(204);
  });

  it('returns license status for valid code', async () => {
    const code = 'PT-SUB-01';
    const token = await generateToken(code, SECRET);
    const kv = mockKV({
      [`license:${code}`]: JSON.stringify({
        status: 'active', plan: 'basic_monthly', expiresAt: '2026-12-31',
        renewsAt: '2026-12-31', cancelledAt: null, suspendedAt: null,
      }),
    });
    const env = makeEnv({ PT_LICENSES: kv });
    const request = new Request(`https://test.com/mp-subscription-status?code=${code}&token=${token}`, {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    const resp = await subStatus({ request, env });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('active');
    expect(body.plan).toBe('basic_monthly');
  });

  it('returns 400 for missing params', async () => {
    const env = makeEnv();
    const request = new Request('https://test.com/mp-subscription-status', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    const resp = await subStatus({ request, env });
    expect(resp.status).toBe(400);
  });

  it('returns 401 for invalid token', async () => {
    const env = makeEnv();
    const request = new Request(`https://test.com/mp-subscription-status?code=PT-X&token=${'a'.repeat(64)}`, {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    const resp = await subStatus({ request, env });
    expect(resp.status).toBe(401);
  });

  it('returns 404 for unknown license', async () => {
    const code = 'PT-UNKNOWN';
    const token = await generateToken(code, SECRET);
    const env = makeEnv();
    const request = new Request(`https://test.com/mp-subscription-status?code=${code}&token=${token}`, {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    const resp = await subStatus({ request, env });
    expect(resp.status).toBe(404);
  });
});

// ── mp-payment-status ────────────────────────────────────────

describe('mp-payment-status', () => {
  it('OPTIONS returns 204', async () => {
    const resp = await payStatusOptions({
      request: new Request('https://test.com/mp-payment-status', {
        headers: { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' },
      }),
    });
    expect(resp.status).toBe(204);
  });

  it('returns active status for processed payment', async () => {
    const kv = mockKV({
      'mp_pay:12345': 'PT-LIC-001',
      'license:PT-LIC-001': JSON.stringify({ status: 'active', plan: 'basic_monthly', expiresAt: '2026-12-31' }),
    });
    const env = makeEnv({ PT_LICENSES: kv });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      payer: { email: 'user@test.com' },
    }), { status: 200 })));

    const request = new Request('https://test.com/mp-payment-status?paymentId=12345&email=user@test.com', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    const resp = await payStatus({ request, env });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe('active');
    expect(body.plan).toBe('basic_monthly');

    vi.unstubAllGlobals();
  });

  it('returns pending when payment not yet processed', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      payer: { email: 'user@test.com' },
    }), { status: 200 })));

    const request = new Request('https://test.com/mp-payment-status?paymentId=99999&email=user@test.com', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    const resp = await payStatus({ request, env });
    const body = await resp.json();
    expect(body.status).toBe('pending');

    vi.unstubAllGlobals();
  });

  it('rejects invalid paymentId', async () => {
    const env = makeEnv();
    const request = new Request('https://test.com/mp-payment-status?paymentId=abc&email=user@test.com', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    const resp = await payStatus({ request, env });
    expect(resp.status).toBe(400);
  });

  it('rejects email mismatch', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      payer: { email: 'real@test.com' },
    }), { status: 200 })));

    const request = new Request('https://test.com/mp-payment-status?paymentId=12345&email=fake@test.com', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    const resp = await payStatus({ request, env });
    expect(resp.status).toBe(401);

    vi.unstubAllGlobals();
  });

  it('returns 500 when MP_ACCESS_TOKEN missing', async () => {
    const env = makeEnv({ MP_ACCESS_TOKEN: undefined });
    const request = new Request('https://test.com/mp-payment-status?paymentId=12345&email=user@test.com', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    const resp = await payStatus({ request, env });
    expect(resp.status).toBe(500);
  });
});
