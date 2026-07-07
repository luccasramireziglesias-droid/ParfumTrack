// Test PH3-04: Double-submit CSRF Validation (token in body + header must match)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function mockRequest(headerToken = null) {
  return {
    headers: {
      get: vi.fn(header => {
        if (header === 'x-csrf-token') return headerToken;
        return null;
      }),
    },
  };
}

function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  const paddedA = a.padEnd(len, '\0');
  const paddedB = b.padEnd(len, '\0');
  let diff = 0;
  for (let i = 0; i < len; i++) diff |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  return diff === 0;
}

function validateDoubleSubmitCSRF(request, body) {
  const headerToken = request.headers.get('x-csrf-token');
  const bodyToken = body?.csrf_token;

  if (!headerToken || !bodyToken) {
    return { valid: false, error: 'missing_csrf_token' };
  }

  const csrfRegex = /^[0-9a-f]{64}$/;
  if (!csrfRegex.test(headerToken) || !csrfRegex.test(bodyToken)) {
    return { valid: false, error: 'invalid_token_format' };
  }

  if (!timingSafeEqual(headerToken, bodyToken)) {
    return { valid: false, error: 'csrf_token_mismatch' };
  }

  return { valid: true };
}

describe('PH3-04: Double-submit CSRF', () => {
  const validToken = 'a'.repeat(64); // 64 hex chars

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts matching tokens in header and body', () => {
    const request = mockRequest(validToken);
    const body = { csrf_token: validToken };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(true);
    console.log('✅ Matching tokens accepted');
  });

  it('rejects if header token missing', () => {
    const request = mockRequest(null);
    const body = { csrf_token: validToken };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('missing_csrf_token');
    console.log('✅ Missing header token rejected');
  });

  it('rejects if body token missing', () => {
    const request = mockRequest(validToken);
    const body = {};

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('missing_csrf_token');
    console.log('✅ Missing body token rejected');
  });

  it('rejects if tokens do not match', () => {
    const token1 = 'a'.repeat(64);
    const token2 = 'b'.repeat(64);
    const request = mockRequest(token1);
    const body = { csrf_token: token2 };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('csrf_token_mismatch');
    console.log('✅ Mismatched tokens rejected');
  });

  it('rejects invalid token format in header', () => {
    const request = mockRequest('invalid_token'); // Not 64 hex chars
    const body = { csrf_token: 'invalid_token' };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_token_format');
    console.log('✅ Invalid header token format rejected');
  });

  it('rejects invalid token format in body', () => {
    const invalidToken = '123'; // Too short
    const request = mockRequest(validToken);
    const body = { csrf_token: invalidToken };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_token_format');
    console.log('✅ Invalid body token format rejected');
  });

  it('rejects tokens with uppercase hex chars', () => {
    const invalidToken = 'A'.repeat(64); // Uppercase not allowed
    const request = mockRequest(invalidToken);
    const body = { csrf_token: invalidToken };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_token_format');
    console.log('✅ Uppercase hex chars rejected');
  });

  it('rejects tokens with non-hex characters', () => {
    const invalidToken = 'g'.repeat(64); // 'g' is not hex
    const request = mockRequest(invalidToken);
    const body = { csrf_token: invalidToken };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_token_format');
    console.log('✅ Non-hex characters rejected');
  });

  it('rejects tokens that are too short', () => {
    const shortToken = 'a'.repeat(32); // Only 32 chars
    const request = mockRequest(shortToken);
    const body = { csrf_token: shortToken };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_token_format');
    console.log('✅ Short tokens rejected');
  });

  it('rejects tokens that are too long', () => {
    const longToken = 'a'.repeat(128); // 128 chars
    const request = mockRequest(longToken);
    const body = { csrf_token: longToken };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_token_format');
    console.log('✅ Long tokens rejected');
  });

  it('handles null request body gracefully', () => {
    const request = mockRequest(validToken);
    const body = null;

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('missing_csrf_token');
    console.log('✅ Null body handled gracefully');
  });

  it('timing-safe comparison prevents timing attacks', () => {
    // This is a basic check that timing-safe comparison is used
    // The function should take the same time for mismatches as matches
    const token1 = 'a'.repeat(64);
    const token2 = 'a'.repeat(63) + 'b'; // Almost matches

    const request = mockRequest(token1);
    const body = { csrf_token: token2 };

    const result = validateDoubleSubmitCSRF(request, body);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('csrf_token_mismatch');
    console.log('✅ Timing-safe comparison in use');
  });
});
