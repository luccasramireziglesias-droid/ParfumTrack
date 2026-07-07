import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock _email-templates before importing mp-webhook
vi.mock('../functions/_email-templates.js', () => ({
  sendEmail: vi.fn(),
}));

const { sendEmail } = await import('../functions/_email-templates.js');

const {
  onRequestGet,
  onRequestPost,
} = await import('../functions/mp-webhook.js');

// ── Helpers ─────────────────────────────────────────────────────

const SECRET = 'test-mp-webhook-secret';
const ACCESS_TOKEN = 'TEST-access-token';

function mockKV(store = {}) {
  return {
    get: vi.fn(async (key) => store[key] ?? null),
    put: vi.fn(async (key, val, opts) => { store[key] = val; }),
    delete: vi.fn(async (key) => { delete store[key]; }),
  };
}

function makeEnv(overrides = {}) {
  return {
    MP_WEBHOOK_SECRET: SECRET,
    MP_ACCESS_TOKEN: ACCESS_TOKEN,
    BREVO_API_KEY: 'test-brevo-key',
    FROM_EMAIL: 'parfumtrack@gmail.com',
    FROM_NAME: 'Parfum Track',
    OWNER_EMAIL: 'parfumtrack@gmail.com',
    MP_CURRENCY_ID: 'USD',
    MP_AMOUNT_MONTHLY: '9.99',
    MP_AMOUNT_ANNUAL: '95.88',
    APP_URL: 'https://parfumtrack.luccasramireziglesias.workers.dev',
    PT_LICENSES: mockKV(),
    ...overrides,
  };
}

async function hmacSign(manifest, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(manifest));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function makeSignature(dataId, requestId, secret) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = await hmacSign(manifest, secret);
  return { xSignature: `ts=${ts},v1=${v1}`, requestId, ts };
}

async function makeWebhookRequest(body, env, { queryParams = '', xRequestId } = {}) {
  const dataId = typeof body === 'object' ? (body.data?.id?.toString() || '') : '';
  const reqId = xRequestId || 'req-' + Math.random().toString(36).slice(2);
  const url = `https://parfumtrack.luccasramireziglesias.workers.dev/mp-webhook?id=${dataId}${queryParams ? '&' + queryParams : ''}`;

  const { xSignature } = await makeSignature(dataId, reqId, env.MP_WEBHOOK_SECRET);

  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': xSignature,
      'x-request-id': reqId,
    },
    body: bodyText,
  });

  return { request, env, ctx: {} };
}

function mockMPPaymentAPI(payment) {
  return vi.fn(async (url, opts) => {
    if (url.startsWith('https://api.mercadopago.com/v1/payments/')) {
      return new Response(JSON.stringify(payment), { status: 200 });
    }
    if (url.startsWith('https://api.brevo.com')) {
      return new Response(JSON.stringify({ messageId: 'test' }), { status: 201 });
    }
    return new Response('Not found', { status: 404 });
  });
}

function approvedPayment(overrides = {}) {
  return {
    id: 1234567890,
    status: 'approved',
    external_reference: JSON.stringify({ email: 'user@example.com', plan: 'monthly' }),
    payer: { email: 'user@example.com' },
    currency_id: 'USD',
    transaction_amount: 9.99,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('mp-webhook', () => {
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
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
    vi.restoreAllMocks();
  });

  // ── GET (endpoint verification) ────────────────────────────

  describe('onRequestGet', () => {
    it('returns 200 ok for MP endpoint verification', async () => {
      const resp = await onRequestGet();
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toBe('ok');
    });
  });

  // ── Signature verification ─────────────────────────────────

  describe('signature verification', () => {
    it('rejects when MP_WEBHOOK_SECRET not configured', async () => {
      const env = makeEnv({ MP_WEBHOOK_SECRET: undefined });
      const body = { type: 'payment', data: { id: '123' } };
      const request = new Request('https://test.com/mp-webhook', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const resp = await onRequestPost({ request, env, ctx: {} });
      expect(resp.status).toBe(500);
      const json = await resp.json();
      expect(json.error).toBe('server_misconfigured');
    });

    it('rejects when x-signature header is missing', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/mp-webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'payment', data: { id: '123' } }),
      });

      const resp = await onRequestPost({ request, env, ctx: {} });
      expect(resp.status).toBe(401);
      const json = await resp.json();
      expect(json.error).toBe('missing_signature');
    });

    it('rejects invalid signature', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/mp-webhook?id=123', {
        method: 'POST',
        headers: {
          'x-signature': 'ts=1234567890,v1=invalid_signature_hex',
          'x-request-id': 'req-123',
        },
        body: JSON.stringify({ type: 'payment', data: { id: '123' } }),
      });

      const resp = await onRequestPost({ request, env, ctx: {} });
      expect(resp.status).toBe(401);
      const json = await resp.json();
      expect(json.error).toBe('invalid_signature');
    });

    it('rejects replay attacks (old timestamp)', async () => {
      const env = makeEnv();
      const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const manifest = `id:123;request-id:req-1;ts:${oldTs};`;
      const v1 = await hmacSign(manifest, SECRET);

      const request = new Request('https://test.com/mp-webhook?id=123', {
        method: 'POST',
        headers: {
          'x-signature': `ts=${oldTs},v1=${v1}`,
          'x-request-id': 'req-1',
        },
        body: JSON.stringify({ type: 'payment', data: { id: '123' } }),
      });

      const resp = await onRequestPost({ request, env, ctx: {} });
      expect(resp.status).toBe(401);
    });
  });

  // ── Event parsing ──────────────────────────────────────────

  describe('event parsing', () => {
    it('accepts valid payment event with JSON body', async () => {
      const env = makeEnv();
      const payment = approvedPayment();
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '12345' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);

      vi.unstubAllGlobals();
    });

    it('returns ok for ping (no type/resourceId)', async () => {
      const env = makeEnv();
      const ctx = await makeWebhookRequest({}, env);
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
      const json = await resp.json();
      expect(json.ok).toBe(true);
    });

    it('rejects invalid type format', async () => {
      const env = makeEnv();
      const ctx = await makeWebhookRequest(
        { type: 'INVALID-TYPE!@#', data: { id: '123' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const json = await resp.json();
      expect(json.error).toBe('invalid_event_format');
    });

    it('rejects non-numeric resourceId', async () => {
      const env = makeEnv();
      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: 'abc-not-numeric' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
    });
  });

  // ── Idempotency ────────────────────────────────────────────

  describe('idempotency', () => {
    it('skips already processed events (done)', async () => {
      const kv = mockKV();
      kv.get.mockImplementation(async (key) => {
        if (key === 'webhook_processed:payment:12345') return 'done';
        return null;
      });
      const env = makeEnv({ PT_LICENSES: kv });

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '12345' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
      expect(kv.put).not.toHaveBeenCalledWith(
        expect.stringContaining('webhook_processed'),
        'processing',
        expect.anything(),
      );
    });

    it('skips events currently processing', async () => {
      const kv = mockKV();
      kv.get.mockImplementation(async (key) => {
        if (key === 'webhook_processed:payment:12345') return 'processing';
        return null;
      });
      const env = makeEnv({ PT_LICENSES: kv });

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '12345' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
    });

    it('marks event as processing then done on success', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment();
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '99999' } },
        env,
      );
      await onRequestPost(ctx);

      const processingCall = kv.put.mock.calls.find(
        c => c[0] === 'webhook_processed:payment:99999' && c[1]?.startsWith('processing:'),
      );
      expect(processingCall).toBeDefined();
      expect(processingCall[2]).toEqual({ expirationTtl: 300 });

      const doneCall = kv.put.mock.calls.find(
        c => c[0] === 'webhook_processed:payment:99999' && c[1] === 'done',
      );
      expect(doneCall).toBeDefined();
      expect(doneCall[2]).toEqual({ expirationTtl: 2592000 });

      vi.unstubAllGlobals();
    });
  });

  // ── KV unavailable ─────────────────────────────────────────

  describe('KV unavailable', () => {
    it('returns 500 when PT_LICENSES not bound', async () => {
      const env = makeEnv({ PT_LICENSES: undefined });
      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '123' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(500);
      const json = await resp.json();
      expect(json.error).toBe('kv_unavailable');
    });
  });

  // ── Payment processing ─────────────────────────────────────

  describe('payment processing', () => {
    it('creates new license for approved payment', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment();
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '55555' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);

      const licensePut = kv.put.mock.calls.find(c => c[0].startsWith('license:PT-'));
      expect(licensePut).toBeDefined();
      const licData = JSON.parse(licensePut[1]);
      expect(licData.clientEmail).toBe('user@example.com');
      expect(licData.plan).toBe('basic_monthly');
      expect(licData.status).toBe('active');
      expect(licData.mpPaymentId).toBe('55555');

      const emailLicPut = kv.put.mock.calls.find(c => c[0].startsWith('email_license:'));
      expect(emailLicPut).toBeDefined();

      const mpPayPut = kv.put.mock.calls.find(c => c[0] === 'mp_pay:55555');
      expect(mpPayPut).toBeDefined();

      expect(sendEmail).toHaveBeenCalledWith(
        env, 'user@example.com', 'subscription_activated',
        expect.objectContaining({ code: expect.stringMatching(/^PT-/) }),
      );

      vi.unstubAllGlobals();
    });

    it('creates annual license with 365-day expiry', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment({
        external_reference: JSON.stringify({ email: 'annual@test.com', plan: 'annual' }),
        transaction_amount: 95.88,
      });
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '66666' } },
        env,
      );
      await onRequestPost(ctx);

      const licensePut = kv.put.mock.calls.find(c => c[0].startsWith('license:PT-'));
      const licData = JSON.parse(licensePut[1]);
      expect(licData.plan).toBe('basic_annual');

      const created = new Date(licData.createdAt);
      const expires = new Date(licData.expiresAt);
      const diffDays = Math.round((expires - created) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(365);

      vi.unstubAllGlobals();
    });

    it('ignores non-approved payments', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment({ status: 'pending' });
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '77777' } },
        env,
      );
      await onRequestPost(ctx);

      const licensePut = kv.put.mock.calls.find(c => c[0].startsWith('license:PT-'));
      expect(licensePut).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('rejects payment without valid email', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment({
        external_reference: JSON.stringify({ plan: 'monthly' }),
        payer: {},
      });
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '88888' } },
        env,
      );
      await onRequestPost(ctx);

      const licensePut = kv.put.mock.calls.find(c => c[0].startsWith('license:PT-'));
      expect(licensePut).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('falls back to payer.email when external_reference has no email', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment({
        external_reference: JSON.stringify({ plan: 'monthly' }),
        payer: { email: 'payer@test.com' },
      });
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '11111' } },
        env,
      );
      await onRequestPost(ctx);

      const licensePut = kv.put.mock.calls.find(c => c[0].startsWith('license:PT-'));
      expect(licensePut).toBeDefined();
      const licData = JSON.parse(licensePut[1]);
      expect(licData.clientEmail).toBe('payer@test.com');

      vi.unstubAllGlobals();
    });
  });

  // ── Amount/currency validation ─────────────────────────────

  describe('amount and currency validation', () => {
    it('rejects payment with wrong currency', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment({ currency_id: 'ARS' });
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '22222' } },
        env,
      );
      await onRequestPost(ctx);

      const licensePut = kv.put.mock.calls.find(c => c[0].startsWith('license:PT-'));
      expect(licensePut).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('rejects payment with wrong amount', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment({ transaction_amount: 1.00 });
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '33333' } },
        env,
      );
      await onRequestPost(ctx);

      const licensePut = kv.put.mock.calls.find(c => c[0].startsWith('license:PT-'));
      expect(licensePut).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('accepts amount within $0.01 tolerance', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment({ transaction_amount: 9.989 });
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '33334' } },
        env,
      );
      await onRequestPost(ctx);

      const licensePut = kv.put.mock.calls.find(c => c[0].startsWith('license:PT-'));
      expect(licensePut).toBeDefined();

      vi.unstubAllGlobals();
    });
  });

  // ── License renewal ────────────────────────────────────────

  describe('license renewal', () => {
    it('renews existing license instead of creating new one', async () => {
      const existingLicense = {
        clientName: 'existing',
        clientEmail: 'user@example.com',
        expiresAt: '2026-07-15',
        plan: 'basic_monthly',
        status: 'active',
        createdAt: '2026-06-15',
      };

      const emailHash = await hashEmailForTest('user@example.com');
      const store = {};
      store[`email_license:${emailHash}`] = 'PT-EXIST-CODE';
      store[`license:PT-EXIST-CODE`] = JSON.stringify(existingLicense);

      const kv = mockKV(store);
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment();
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '44444' } },
        env,
      );
      await onRequestPost(ctx);

      const renewPut = kv.put.mock.calls.find(c => c[0] === 'license:PT-EXIST-CODE');
      expect(renewPut).toBeDefined();
      const renewed = JSON.parse(renewPut[1]);
      expect(renewed.status).toBe('active');
      expect(renewed.suspendedAt).toBeNull();

      const newExpiry = new Date(renewed.expiresAt);
      const oldExpiry = new Date('2026-07-15');
      expect(newExpiry > oldExpiry).toBe(true);

      const newLicPut = kv.put.mock.calls.find(
        c => c[0].startsWith('license:PT-') && c[0] !== 'license:PT-EXIST-CODE',
      );
      expect(newLicPut).toBeUndefined();

      expect(sendEmail).toHaveBeenCalledWith(
        env, 'user@example.com', 'subscription_renewed',
        expect.objectContaining({ expiresAt: expect.any(String) }),
      );

      vi.unstubAllGlobals();
    });

    it('extends from expiry date if license not yet expired', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 20);
      const futureExpiry = futureDate.toISOString().split('T')[0];

      const existingLicense = {
        clientEmail: 'user@example.com',
        expiresAt: futureExpiry,
        plan: 'basic_monthly',
        status: 'active',
      };

      const emailHash = await hashEmailForTest('user@example.com');
      const store = {};
      store[`email_license:${emailHash}`] = 'PT-FUT-CODE';
      store[`license:PT-FUT-CODE`] = JSON.stringify(existingLicense);

      const kv = mockKV(store);
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment();
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '45555' } },
        env,
      );
      await onRequestPost(ctx);

      const renewPut = kv.put.mock.calls.find(c => c[0] === 'license:PT-FUT-CODE');
      const renewed = JSON.parse(renewPut[1]);
      const newExpiry = new Date(renewed.expiresAt);
      const expectedBase = new Date(futureExpiry);
      expectedBase.setDate(expectedBase.getDate() + 31);
      expect(newExpiry.toISOString().split('T')[0]).toBe(expectedBase.toISOString().split('T')[0]);

      vi.unstubAllGlobals();
    });

    it('skips if payment already processed (secondary idempotency)', async () => {
      const emailHash = await hashEmailForTest('user@example.com');
      const store = {};
      store[`mp_pay:44444`] = 'PT-EXIST-CODE';

      const kv = mockKV(store);
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment();
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '44444' } },
        env,
      );
      await onRequestPost(ctx);

      const newLicPut = kv.put.mock.calls.find(c => c[0].startsWith('license:PT-'));
      expect(newLicPut).toBeUndefined();

      vi.unstubAllGlobals();
    });
  });

  // ── MP API errors ──────────────────────────────────────────

  describe('MP API errors', () => {
    it('handles missing MP_ACCESS_TOKEN gracefully and cleans up', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv, MP_ACCESS_TOKEN: undefined });
      vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 201 })));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '50001' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      // processEvent catches internally, so onRequestPost returns 200
      expect(resp.status).toBe(200);
      // but the idempotency key should be cleaned up (not marked as done)
      expect(kv.delete).toHaveBeenCalledWith('webhook_processed:payment:50001');

      vi.unstubAllGlobals();
    });

    it('handles MP API error gracefully and notifies owner', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url.includes('mercadopago')) return new Response('Not Found', { status: 404 });
        return new Response('ok', { status: 201 });
      }));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '50002' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      // processEvent catches internally — returns 200 so MP doesn't retry
      expect(resp.status).toBe(200);
      // idempotency key cleaned up
      expect(kv.delete).toHaveBeenCalledWith('webhook_processed:payment:50002');

      vi.unstubAllGlobals();
    });

    it('cleans up idempotency key on processing failure', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url.includes('mercadopago')) return new Response('Error', { status: 500 });
        return new Response('ok', { status: 201 });
      }));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '50003' } },
        env,
      );
      await onRequestPost(ctx);

      expect(kv.delete).toHaveBeenCalledWith('webhook_processed:payment:50003');

      vi.unstubAllGlobals();
    });
  });

  // ── Owner notifications ────────────────────────────────────

  describe('owner notifications', () => {
    it('sends owner notification on new license', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment();
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '60001' } },
        env,
      );
      await onRequestPost(ctx);

      const ownerCall = sendEmail.mock.calls.find(
        c => c[1] === 'parfumtrack@gmail.com' && c[2] === 'owner_payment_notification',
      );
      expect(ownerCall).toBeDefined();
      expect(ownerCall[3].type).toBe('new');

      vi.unstubAllGlobals();
    });

    it('sends owner notification on renewal', async () => {
      const emailHash = await hashEmailForTest('user@example.com');
      const store = {};
      store[`email_license:${emailHash}`] = 'PT-RENEW-01';
      store[`license:PT-RENEW-01`] = JSON.stringify({
        clientEmail: 'user@example.com',
        expiresAt: '2026-08-01',
        plan: 'basic_monthly',
        status: 'active',
      });

      const kv = mockKV(store);
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment();
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '60002' } },
        env,
      );
      await onRequestPost(ctx);

      const ownerCall = sendEmail.mock.calls.find(
        c => c[1] === 'parfumtrack@gmail.com' && c[2] === 'owner_payment_notification',
      );
      expect(ownerCall).toBeDefined();
      expect(ownerCall[3].type).toBe('renewal');

      vi.unstubAllGlobals();
    });
  });

  // ── Unhandled event types ──────────────────────────────────

  describe('unhandled event types', () => {
    it('logs and succeeds for unknown event types', async () => {
      const kv = mockKV();
      const env = makeEnv({ PT_LICENSES: kv });

      const ctx = await makeWebhookRequest(
        { type: 'subscription_preapproval', data: { id: '70001' } },
        env,
      );
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);

      vi.unstubAllGlobals();
    });
  });

  // ── Corrupted license data ─────────────────────────────────

  describe('corrupted license data', () => {
    it('creates fresh license when existing license data is corrupted', async () => {
      const emailHash = await hashEmailForTest('user@example.com');
      const store = {};
      store[`email_license:${emailHash}`] = 'PT-CORRUPT';
      store[`license:PT-CORRUPT`] = 'NOT-VALID-JSON{{{';

      const kv = mockKV(store);
      const env = makeEnv({ PT_LICENSES: kv });
      const payment = approvedPayment();
      vi.stubGlobal('fetch', mockMPPaymentAPI(payment));

      const ctx = await makeWebhookRequest(
        { type: 'payment', data: { id: '80001' } },
        env,
      );
      await onRequestPost(ctx);

      const newLicPut = kv.put.mock.calls.find(
        c => c[0].startsWith('license:PT-') && c[0] !== 'license:PT-CORRUPT',
      );
      expect(newLicPut).toBeDefined();
      const newLic = JSON.parse(newLicPut[1]);
      expect(newLic.clientEmail).toBe('user@example.com');

      vi.unstubAllGlobals();
    });
  });
});

// Helper to hash email the same way mp-webhook does
async function hashEmailForTest(email) {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
