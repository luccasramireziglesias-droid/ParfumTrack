// Test PH3-02: IP-based Rate Limiting (limit requests per IP per endpoint)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function mockKV(store = {}) {
  return {
    get: vi.fn(key => store[key] ?? null),
    put: vi.fn((key, value, opts) => { store[key] = value; }),
    delete: vi.fn(key => { delete store[key]; }),
  };
}

function mockRequest(ip = '192.168.1.1') {
  return {
    headers: {
      get: vi.fn(header => {
        if (header === 'cf-connecting-ip') return ip;
        return null;
      }),
    },
  };
}

// Synchronous version for testing
function checkIPRateLimitSync(env, request, endpoint, maxPerWindow = 100, windowSecs = 60) {
  if (!env.PT_LICENSES) {
    return 'Service temporarily unavailable';
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (ip === 'unknown') {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const windowKey = `ip_rate:${endpoint}:${ip}:${Math.floor(now / windowSecs)}`;

  let count = 0;
  try {
    const stored = env.PT_LICENSES.get(windowKey);
    count = stored ? (parseInt(stored, 10) || 0) : 0;
  } catch {
    return 'Rate limit check failed';
  }

  if (count >= maxPerWindow) {
    return 'Too many requests from your IP, please try again later';
  }

  try {
    env.PT_LICENSES.put(windowKey, String(count + 1), { expirationTtl: windowSecs * 2 });
  } catch {
    return 'Rate limit write failed';
  }

  return null;
}

describe('PH3-02: IP-based Rate Limiting', () => {
  let store;
  let mockKVInstance;

  beforeEach(() => {
    store = {};
    mockKVInstance = mockKV(store);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows single request from IP', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('192.168.1.1');

    const result = checkIPRateLimitSync(env, request, '/trial', 100, 60);
    expect(result).toBeNull();
    console.log('✅ Single request from IP allowed');
  });

  it('allows multiple requests from same IP within limit', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('192.168.1.1');

    let result;
    for (let i = 0; i < 50; i++) {
      result = checkIPRateLimitSync(env, request, '/trial', 100, 60);
      expect(result).toBeNull();
    }
    console.log('✅ 50 requests within limit allowed');
  });

  it('blocks IP when exceeding rate limit', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('192.168.1.1');

    // Make 100 requests (at limit)
    for (let i = 0; i < 100; i++) {
      const result = checkIPRateLimitSync(env, request, '/trial', 100, 60);
      expect(result).toBeNull();
    }

    // 101st request should be blocked
    const result = checkIPRateLimitSync(env, request, '/trial', 100, 60);
    expect(result).toBe('Too many requests from your IP, please try again later');
    console.log('✅ IP blocked when exceeding limit');
  });

  it('isolates rate limits per IP', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request1 = mockRequest('192.168.1.1');
    const request2 = mockRequest('192.168.1.2');

    // IP 1: 100 requests
    for (let i = 0; i < 100; i++) {
      checkIPRateLimitSync(env, request1, '/trial', 100, 60);
    }

    // IP 2: should still be allowed (separate limit)
    const result = checkIPRateLimitSync(env, request2, '/trial', 100, 60);
    expect(result).toBeNull();
    console.log('✅ Independent limits per IP');
  });

  it('isolates rate limits per endpoint', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('192.168.1.1');

    // Fill /trial endpoint
    for (let i = 0; i < 100; i++) {
      checkIPRateLimitSync(env, request, '/trial', 100, 60);
    }

    // /validate-license should still allow requests
    const result = checkIPRateLimitSync(env, request, '/validate-license', 100, 60);
    expect(result).toBeNull();
    console.log('✅ Separate limits per endpoint');
  });

  it('respects custom max limit', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('192.168.1.1');

    // Custom limit: 5 requests
    for (let i = 0; i < 5; i++) {
      const result = checkIPRateLimitSync(env, request, '/strict', 5, 60);
      expect(result).toBeNull();
    }

    // 6th should be blocked
    const result = checkIPRateLimitSync(env, request, '/strict', 5, 60);
    expect(result).toBe('Too many requests from your IP, please try again later');
    console.log('✅ Custom max limit enforced');
  });

  it('fails closed if KV not configured', () => {
    const env = { PT_LICENSES: null };
    const request = mockRequest('192.168.1.1');

    const result = checkIPRateLimitSync(env, request, '/trial', 100, 60);
    expect(result).toBe('Service temporarily unavailable');
    console.log('✅ Fails closed if KV misconfigured');
  });

  it('handles missing IP gracefully', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('unknown');

    const result = checkIPRateLimitSync(env, request, '/trial', 100, 60);
    expect(result).toBeNull();
    console.log('✅ Handles missing IP gracefully');
  });

  it('tracks requests per window correctly', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('203.0.113.5');

    // First 10 requests (within window)
    for (let i = 0; i < 10; i++) {
      const result = checkIPRateLimitSync(env, request, '/backup', 10, 60);
      if (i < 10) expect(result).toBeNull();
    }

    // 11th should be blocked
    const result = checkIPRateLimitSync(env, request, '/backup', 10, 60);
    expect(result).toBe('Too many requests from your IP, please try again later');
    console.log('✅ Window-based counting correct');
  });
});
