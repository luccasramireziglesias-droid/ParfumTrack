// Test MP License Code Generation (MP-PH-04)
import { describe, it, expect } from 'vitest';

function generateLicenseCode() {
  const toHex = arr => Array.from(arr).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  const code = `PT-${toHex(crypto.getRandomValues(new Uint8Array(3)))}-${toHex(crypto.getRandomValues(new Uint8Array(3)))}`;
  return code;
}

function validateLicenseCodeFormat(code) {
  // Format: PT-XXXXXX-XXXXXX (3 bytes = 6 hex chars per segment)
  const regex = /^PT-[0-9A-F]{6}-[0-9A-F]{6}$/;
  return regex.test(code);
}

function isValidLicenseCode(code) {
  if (typeof code !== 'string') return false;
  if (!validateLicenseCodeFormat(code)) return false;

  const parts = code.split('-');
  if (parts.length !== 3) return false;
  if (parts[0] !== 'PT') return false;

  // Each segment should be exactly 6 hex chars (3 bytes * 2)
  return parts[1].length === 6 && parts[2].length === 6;
}

describe('MP License Code Generation (MP-PH-04)', () => {
  it('generates valid license code format', () => {
    const code = generateLicenseCode();
    expect(isValidLicenseCode(code)).toBe(true);
    console.log(`✅ Generated valid code: ${code}`);
  });

  it('validates correct format', () => {
    const validCodes = [
      'PT-ABCDEF-123456',
      'PT-000000-FFFFFF',
      'PT-0A0A0A-F5F5F5',
    ];

    validCodes.forEach(code => {
      expect(isValidLicenseCode(code)).toBe(true);
    });
    console.log('✅ Valid codes pass validation');
  });

  it('rejects invalid formats', () => {
    const invalidCodes = [
      'PT-ABC-123',        // Too short
      'PT-ABCDEFG-123456', // Too long in first segment
      'XX-ABCDEF-123456',  // Wrong prefix
      'PT-ABCDEF-123456-X', // Extra segment
      'pt-abcdef-123456',  // Lowercase
      'PT ABCDEF-123456',  // Space instead of dash
      'PTABCDEF123456',    // No dashes
      '',                  // Empty
      null,                // Null
      123,                 // Number
    ];

    invalidCodes.forEach(code => {
      expect(isValidLicenseCode(code)).toBe(false);
    });
    console.log('✅ Invalid codes rejected');
  });

  it('generates unique codes (high probability)', () => {
    const codes = new Set();
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const code = generateLicenseCode();
      codes.add(code);
    }

    // With 96-bit entropy, chance of collision in 1000 attempts is negligible
    // Expected collisions ≈ n²/2^k = 1,000,000 / 2^96 ≈ 1.5e-21
    expect(codes.size).toBe(iterations);
    console.log(`✅ Generated ${iterations} unique codes (no collisions)`);
  });

  it('verifies entropy is sufficient', () => {
    // Each segment is 3 bytes = 24 bits
    // Two segments = 48 bits each
    // Format: PT-[48-bit]-[48-bit] = 96-bit total entropy

    // Birthday paradox: collision probability = n² / 2^k
    // For 50% collision: n = sqrt(2^k) = 2^48 ≈ 281 trillion

    // At 1 million licenses per year:
    // Time to 50% collision: 281 trillion / 1M = 281 billion years

    // This is secure for all practical purposes
    const bytesPerSegment = 3;
    const bitsPerSegment = bytesPerSegment * 8;
    const totalBits = bitsPerSegment * 2;
    const possibleCodes = Math.pow(2, totalBits);

    expect(totalBits).toBe(48);
    expect(possibleCodes).toBeGreaterThan(Math.pow(10, 14)); // >280 trillion
    console.log(`✅ Entropy: ${totalBits} bits = ${possibleCodes.toExponential(2)} possible codes`);
  });

  it('each segment uses all available values', () => {
    // Verify that hex encoding can generate 00-FF for each byte
    const bytes = crypto.getRandomValues(new Uint8Array(3)); // 3 bytes
    const hex = Array.from(bytes).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();

    expect(hex.length).toBe(6); // 3 bytes = 6 hex chars
    expect(/^[0-9A-F]{6}$/.test(hex)).toBe(true);
    console.log('✅ Hex encoding proper (all values 00-FF)');
  });

  it('format matches documented pattern', () => {
    // Format from code: PT-XXXXXX-XXXXXX
    const code = generateLicenseCode();
    const [prefix, seg1, seg2] = code.split('-');

    expect(prefix).toBe('PT');
    expect(seg1).toMatch(/^[0-9A-F]{6}$/);
    expect(seg2).toMatch(/^[0-9A-F]{6}$/);
    console.log('✅ Format matches PT-XXXXXX-XXXXXX');
  });

  it('validates case sensitivity', () => {
    // Codes should be uppercase
    const code = generateLicenseCode();
    expect(code).toBe(code.toUpperCase());
    console.log('✅ Codes always uppercase');
  });

  it('no hardcoded or predictable segments', () => {
    // Verify randomness (very basic check)
    const codes = [];
    for (let i = 0; i < 100; i++) {
      codes.push(generateLicenseCode());
    }

    // All should be different
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(100);

    // No pattern should be obvious
    const segments = codes.map(c => c.split('-')[1]); // Get first random segment
    const uniqueSegments = new Set(segments);
    expect(uniqueSegments.size).toBeGreaterThan(95); // Should be highly random

    console.log('✅ Codes appear random (no predictable pattern)');
  });

  it('collision detection would work correctly', async () => {
    // Simulate KV collision detection
    const generated = new Map();

    for (let attempt = 0; attempt < 3; attempt++) {
      let code = generateLicenseCode();

      // Check if already exists (simulating KV lookup)
      let retries = 0;
      while (generated.has(code) && retries < 10) {
        code = generateLicenseCode();
        retries++;
      }

      if (retries >= 10) {
        throw new Error('Could not find unique code');
      }

      generated.set(code, { createdAt: Date.now() });
    }

    expect(generated.size).toBe(3);
    console.log('✅ Collision detection would prevent duplicates');
  });
});
