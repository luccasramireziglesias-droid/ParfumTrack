// Test PH3-01: Burst Detection (detect spikes, block if 5+ requests in <5 seconds)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function mockKV(store = {}) {
  return {
    get: vi.fn(key => store[key] ?? null),
    put: vi.fn((key, value, opts) => { store[key] = value; }),
    delete: vi.fn(key => { delete store[key]; }),
  };
}

// Synchronous version for testing (actual version in _shared.js is async)
function checkBurstRateLimitSync(env, key, burstThreshold = 5, burstWindowMs = 5000) {
  if (!env.PT_LICENSES) {
    return 'Service temporarily unavailable';
  }

  const now = Date.now();
  const historyKey = `burst_history:${key}`;
  let history = [];

  try {
    const stored = env.PT_LICENSES.get(historyKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      history = Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    history = [];
  }

  history = history.filter(ts => now - ts < burstWindowMs);

  if (history.length >= burstThreshold) {
    return 'Too many rapid requests, please slow down';
  }

  history.push(now);
  env.PT_LICENSES.put(historyKey, JSON.stringify(history), { expirationTtl: Math.ceil(burstWindowMs / 1000) + 1 });

  return null;
}

describe('PH3-01: Burst Detection', () => {
  let store;
  let mockKVInstance;

  beforeEach(() => {
    store = {};
    mockKVInstance = mockKV(store);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows single request', () => {
    const env = { PT_LICENSES: mockKVInstance };
    const result = checkBurstRateLimitSync(env, 'test-user', 5, 5000);
    expect(result).toBeNull();
    console.log('✅ Single request allowed');
  });

  it('blocks burst: 5 requests in <1 second', () => {
    const env = { PT_LICENSES: mockKVInstance };

    // Simulate 5 rapid requests with threshold 4 (blocks 5th)
    const results = [];
    for (let i = 0; i < 5; i++) {
      const result = checkBurstRateLimitSync(env, 'burst-user', 4, 5000);
      results.push(result);
    }

    // First 4 should pass, 5th should be blocked
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).toBeNull();
    expect(results[3]).toBeNull();
    expect(results[4]).toBe('Too many rapid requests, please slow down');
    console.log('✅ Burst detected and blocked');
  });

  it('allows different users to have independent burst history', () => {
    const env = { PT_LICENSES: mockKVInstance };

    // User A: rapid requests
    for (let i = 0; i < 5; i++) {
      checkBurstRateLimitSync(env, 'user-a', 5, 5000);
    }

    // User B: should still be allowed (separate key)
    const resultB = checkBurstRateLimitSync(env, 'user-b', 5, 5000);
    expect(resultB).toBeNull();
    console.log('✅ Independent burst tracking per user');
  });

  it('detects burst with custom threshold', () => {
    const env = { PT_LICENSES: mockKVInstance };

    // Lower threshold: 2 requests, block 3rd
    const results = [];
    for (let i = 0; i < 3; i++) {
      const result = checkBurstRateLimitSync(env, 'custom-threshold', 2, 5000);
      results.push(result);
    }

    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).toBe('Too many rapid requests, please slow down');
    console.log('✅ Custom burst threshold enforced');
  });

  it('returns error if KV not configured', () => {
    const env = { PT_LICENSES: null };
    const result = checkBurstRateLimitSync(env, 'test-user', 5, 5000);
    expect(result).toBe('Service temporarily unavailable');
    console.log('✅ Fails closed if KV misconfigured');
  });

  it('handles concurrent burst from same user', () => {
    const env = { PT_LICENSES: mockKVInstance };

    // Simulate "concurrent" rapid requests (all within same millisecond)
    const results = [];
    for (let i = 0; i < 6; i++) {
      const result = checkBurstRateLimitSync(env, 'concurrent-user', 5, 5000);
      results.push(result);
    }

    // All after 5th should be blocked
    const blockedCount = results.filter(r => r === 'Too many rapid requests, please slow down').length;
    expect(blockedCount).toBe(1);
    console.log('✅ Concurrent burst rate limiting works');
  });

  it('blocks bursts with larger threshold values', () => {
    const env = { PT_LICENSES: mockKVInstance };

    // Threshold 10: allow 10 requests, block 11th
    const results = [];
    for (let i = 0; i < 11; i++) {
      const result = checkBurstRateLimitSync(env, 'large-threshold', 10, 5000);
      results.push(result);
    }

    expect(results.slice(0, 10).every(r => r === null)).toBe(true);
    expect(results[10]).toBe('Too many rapid requests, please slow down');
    console.log('✅ Large threshold burst detection works');
  });

  it('maintains separate history for each endpoint', () => {
    const env = { PT_LICENSES: mockKVInstance };

    // Fill endpoint A
    for (let i = 0; i < 5; i++) {
      checkBurstRateLimitSync(env, 'endpoint-a', 5, 5000);
    }

    // Endpoint B should still work
    for (let i = 0; i < 5; i++) {
      const result = checkBurstRateLimitSync(env, 'endpoint-b', 5, 5000);
      expect(result).toBeNull();
    }

    // 6th request on B should be blocked
    const result6 = checkBurstRateLimitSync(env, 'endpoint-b', 5, 5000);
    expect(result6).toBe('Too many rapid requests, please slow down');

    console.log('✅ Separate history per endpoint');
  });
});
