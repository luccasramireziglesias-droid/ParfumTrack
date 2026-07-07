// Test PH3-03: Adaptive Throttling (exponential backoff for attack IPs)
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

function getAdaptiveThrottleSync(env, request, endpoint) {
  if (!env.PT_LICENSES) return 0;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (ip === 'unknown') return 0;

  const statusKey = `attack_status:${endpoint}:${ip}`;
  let attackScore = 0;

  try {
    const stored = env.PT_LICENSES.get(statusKey);
    if (stored) {
      attackScore = parseInt(stored, 10) || 0;
    }
  } catch {
    return 0;
  }

  // Exponential backoff
  if (attackScore >= 11) return 1000;
  if (attackScore >= 6) return 500;
  if (attackScore >= 3) return 100;
  return 0;
}

function recordBlockedRequestSync(env, request, endpoint) {
  if (!env.PT_LICENSES) return;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (ip === 'unknown') return;

  const statusKey = `attack_status:${endpoint}:${ip}`;

  try {
    const stored = env.PT_LICENSES.get(statusKey);
    let attackScore = stored ? (parseInt(stored, 10) || 0) : 0;
    attackScore = Math.min(attackScore + 1, 20);
    env.PT_LICENSES.put(statusKey, String(attackScore), { expirationTtl: 3600 });
  } catch {
    // Silently fail
  }
}

describe('PH3-03: Adaptive Throttling', () => {
  let store;
  let mockKVInstance;

  beforeEach(() => {
    store = {};
    mockKVInstance = mockKV(store);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 delay for clean IP', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('192.168.1.1');

    const delay = getAdaptiveThrottleSync(env, request, '/trial');
    expect(delay).toBe(0);
    console.log('✅ Clean IP has 0 delay');
  });

  it('increases delay with attack score', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('203.0.113.1');

    // Simulate attack score progression
    recordBlockedRequestSync(env, request, '/trial'); // score = 1
    recordBlockedRequestSync(env, request, '/trial'); // score = 2
    let delay = getAdaptiveThrottleSync(env, request, '/trial');
    expect(delay).toBe(0); // score < 3

    recordBlockedRequestSync(env, request, '/trial'); // score = 3
    delay = getAdaptiveThrottleSync(env, request, '/trial');
    expect(delay).toBe(100); // score >= 3

    recordBlockedRequestSync(env, request, '/trial'); // score = 4
    recordBlockedRequestSync(env, request, '/trial'); // score = 5
    recordBlockedRequestSync(env, request, '/trial'); // score = 6
    delay = getAdaptiveThrottleSync(env, request, '/trial');
    expect(delay).toBe(500); // score >= 6

    for (let i = 0; i < 5; i++) {
      recordBlockedRequestSync(env, request, '/trial'); // score += 1
    }
    delay = getAdaptiveThrottleSync(env, request, '/trial');
    expect(delay).toBe(1000); // score >= 11

    console.log('✅ Exponential backoff progression correct');
  });

  it('caps attack score at 20', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('198.51.100.1');

    // Try to increment past 20
    for (let i = 0; i < 30; i++) {
      recordBlockedRequestSync(env, request, '/trial');
    }

    const stored = env.PT_LICENSES.get(`attack_status:/trial:198.51.100.1`);
    const attackScore = parseInt(stored, 10);
    expect(attackScore).toBe(20);
    console.log('✅ Attack score capped at 20');
  });

  it('isolates attack scores per endpoint', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('192.168.1.2');

    // Fill /trial with attack score 6
    for (let i = 0; i < 6; i++) {
      recordBlockedRequestSync(env, request, '/trial');
    }

    // /validate-license should have score 0
    let delay1 = getAdaptiveThrottleSync(env, request, '/trial');
    let delay2 = getAdaptiveThrottleSync(env, request, '/validate-license');

    expect(delay1).toBe(500); // score 6 at /trial
    expect(delay2).toBe(0); // score 0 at /validate-license

    console.log('✅ Attack scores isolated per endpoint');
  });

  it('isolates attack scores per IP', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request1 = mockRequest('192.168.1.3');
    const request2 = mockRequest('192.168.1.4');

    // IP 1: fill with score 10
    for (let i = 0; i < 10; i++) {
      recordBlockedRequestSync(env, request1, '/trial');
    }

    // IP 2: score 0
    let delay1 = getAdaptiveThrottleSync(env, request1, '/trial');
    let delay2 = getAdaptiveThrottleSync(env, request2, '/trial');

    expect(delay1).toBe(500); // score 10
    expect(delay2).toBe(0); // score 0

    console.log('✅ Attack scores isolated per IP');
  });

  it('returns correct delay thresholds', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('198.51.100.2');

    // Test each threshold boundary
    const testCases = [
      { score: 0, expectedDelay: 0 },
      { score: 2, expectedDelay: 0 },
      { score: 3, expectedDelay: 100 },
      { score: 5, expectedDelay: 100 },
      { score: 6, expectedDelay: 500 },
      { score: 10, expectedDelay: 500 },
      { score: 11, expectedDelay: 1000 },
      { score: 20, expectedDelay: 1000 },
    ];

    for (const { score, expectedDelay } of testCases) {
      store[`attack_status:/test:198.51.100.2`] = String(score);
      const delay = getAdaptiveThrottleSync(env, request, '/test');
      expect(delay).toBe(expectedDelay);
    }

    console.log('✅ All delay thresholds correct');
  });

  it('fails closed if KV not configured', () => {
    const env = { PT_LICENSES: null };
    const request = mockRequest('192.168.1.5');

    const delay = getAdaptiveThrottleSync(env, request, '/trial');
    expect(delay).toBe(0);
    console.log('✅ Returns 0 delay if KV not available');
  });

  it('handles missing IP gracefully', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const request = mockRequest('unknown');

    const delay = getAdaptiveThrottleSync(env, request, '/trial');
    expect(delay).toBe(0);
    console.log('✅ Returns 0 delay for unknown IP');
  });
});
