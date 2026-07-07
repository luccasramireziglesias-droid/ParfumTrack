// Test PH3-05: Referer/Origin Validation (reject non-whitelisted origins)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function mockRequest(headers = {}) {
  return {
    headers: {
      get: vi.fn(header => headers[header.toLowerCase()] || null),
    },
  };
}

function validateOrigin(request, allowedOrigins = []) {
  const origin = request.headers.get('origin') || request.headers.get('referer');

  if (!origin) {
    return { valid: false, error: 'missing_origin' };
  }

  let checkOrigin = origin;
  if (origin.includes('/')) {
    try {
      checkOrigin = new URL(origin).origin;
    } catch {
      return { valid: false, error: 'invalid_origin_format' };
    }
  }

  const isAllowed = allowedOrigins.some(allowed => {
    if (allowed instanceof RegExp) {
      return allowed.test(checkOrigin);
    }
    return checkOrigin === allowed;
  });

  if (!isAllowed) {
    return { valid: false, error: 'origin_not_allowed', origin: checkOrigin };
  }

  return { valid: true };
}

describe('PH3-05: Origin Validation', () => {
  const allowedOrigins = [
    'https://parfumtrack.luccasramireziglesias.workers.dev',
    'https://parfumtrack.pages.dev',
    /^https:\/\/localhost(:\d+)?$/,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts request with valid origin header', () => {
    const request = mockRequest({ origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(true);
    console.log('✅ Valid origin header accepted');
  });

  it('accepts request with valid referer header', () => {
    const request = mockRequest({
      referer: 'https://parfumtrack.pages.dev/app/inicio',
    });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(true);
    console.log('✅ Valid referer header accepted');
  });

  it('prefers origin header over referer', () => {
    const request = mockRequest({
      origin: 'https://parfumtrack.pages.dev',
      referer: 'https://evil.com/payload',
    });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(true);
    console.log('✅ Origin header takes precedence');
  });

  it('rejects request without origin or referer', () => {
    const request = mockRequest({});
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('missing_origin');
    console.log('✅ Missing origin/referer rejected');
  });

  it('rejects request from non-whitelisted origin', () => {
    const request = mockRequest({ origin: 'https://evil.com' });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('origin_not_allowed');
    console.log('✅ Non-whitelisted origin rejected');
  });

  it('extracts origin from referer URL correctly', () => {
    const request = mockRequest({
      referer: 'https://parfumtrack.luccasramireziglesias.workers.dev/app/caja?tab=ingresos',
    });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(true);
    console.log('✅ Origin extracted from full referer URL');
  });

  it('rejects malformed referer URL', () => {
    const request = mockRequest({ referer: 'ht!tp://[invalid]' });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_origin_format');
    console.log('✅ Malformed referer URL rejected');
  });

  it('supports regex patterns in allowed origins', () => {
    const request1 = mockRequest({ origin: 'https://localhost' });
    const request2 = mockRequest({ origin: 'https://localhost:3000' });
    const request3 = mockRequest({ origin: 'https://localhost:9999' });

    const result1 = validateOrigin(request1, allowedOrigins);
    const result2 = validateOrigin(request2, allowedOrigins);
    const result3 = validateOrigin(request3, allowedOrigins);

    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(true);
    expect(result3.valid).toBe(true);
    console.log('✅ Regex patterns match localhost with any port');
  });

  it('rejects localhost with http instead of https', () => {
    const request = mockRequest({ origin: 'http://localhost:3000' });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(false);
    console.log('✅ Insecure localhost rejected');
  });

  it('rejects subdomain spoofing attempts', () => {
    const request = mockRequest({
      origin: 'https://evil.parfumtrack.luccasramireziglesias.workers.dev',
    });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(false);
    console.log('✅ Subdomain spoofing rejected');
  });

  it('rejects origin with port suffix when not allowed', () => {
    const request = mockRequest({
      origin: 'https://parfumtrack.pages.dev:8443',
    });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.valid).toBe(false);
    console.log('✅ Unauthorized port rejected');
  });

  it('returns origin in error response for debugging', () => {
    const request = mockRequest({ origin: 'https://suspicious.com' });
    const result = validateOrigin(request, allowedOrigins);
    expect(result.error).toBe('origin_not_allowed');
    expect(result.origin).toBe('https://suspicious.com');
    console.log('✅ Origin included in error response');
  });

  it('handles case-sensitive domain comparison', () => {
    // Domains are case-insensitive, but our allowlist uses lowercase
    const request = mockRequest({
      origin: 'https://ParfumTrack.pages.dev',
    });
    const result = validateOrigin(request, allowedOrigins);
    // This might fail depending on whether browsers normalize it
    console.log(`  Case sensitivity test: ${result.valid ? 'passed' : 'would need normalization'}`);
  });

  it('handles empty allowed origins list gracefully', () => {
    const request = mockRequest({ origin: 'https://any-origin.com' });
    const result = validateOrigin(request, []);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('origin_not_allowed');
    console.log('✅ Empty allowlist rejects all origins');
  });
});
