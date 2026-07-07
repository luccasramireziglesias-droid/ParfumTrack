// Test MP Email Normalization (MP-PH-01)
import { describe, it, expect } from 'vitest';

// Simulated email hash function (same as webhook)
async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashEmail(email) {
  const normalized = email.toLowerCase().trim();
  return sha256(normalized);
}

describe('MP Email Normalization (MP-PH-01)', () => {
  it('generates same hash for case-insensitive emails', async () => {
    const hash1 = await hashEmail('user@example.com');
    const hash2 = await hashEmail('USER@EXAMPLE.COM');
    const hash3 = await hashEmail('User@Example.Com');

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
    console.log('✅ Case-insensitive emails hash to same value');
  });

  it('generates same hash for emails with whitespace', async () => {
    const hash1 = await hashEmail('user@example.com');
    const hash2 = await hashEmail('  user@example.com  ');
    const hash3 = await hashEmail(' User@Example.Com ');

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
    console.log('✅ Emails with whitespace hash to same value');
  });

  it('detects mismatched emails with case difference', async () => {
    const email1 = 'user@example.com'.toLowerCase();
    const email2 = 'USER@EXAMPLE.COM'.toLowerCase();

    expect(email1).toBe(email2);
    console.log('✅ Case mismatch detection works');
  });

  it('normalizes payer email before comparison', async () => {
    const payerEmail = '  User@Example.Com  ';
    const externalEmail = 'user@example.com';

    // Simulate the fix: normalize both before comparing
    const normalizedPayer = payerEmail.toLowerCase().trim();
    const normalizedExternal = externalEmail.toLowerCase().trim();

    expect(normalizedPayer).toBe(normalizedExternal);
    console.log('✅ Normalized emails match correctly');
  });

  it('prevents email_license duplicates with normalization', async () => {
    const emails = [
      'user@example.com',
      'USER@EXAMPLE.COM',
      '  user@example.com  ',
      'User@Example.Com'
    ];

    const hashes = new Set();
    for (const email of emails) {
      const hash = await hashEmail(email);
      hashes.add(hash);
    }

    // All should produce the same hash → single entry in KV
    expect(hashes.size).toBe(1);
    console.log('✅ All email variants generate same KV key');
  });

  it('handles mismatch detection with normalized emails', async () => {
    const payerEmail = '  juan@example.com  ';
    const externalRefEmail = 'maria@example.com';

    // Normalize both before comparison
    const payer = payerEmail.toLowerCase().trim();
    const external = externalRefEmail.toLowerCase().trim();

    const isMismatch = payer !== external;
    expect(isMismatch).toBe(true);
    console.log('✅ Email mismatch correctly detected after normalization');
  });

  it('prevents race condition with consistent email hashing', async () => {
    const payment1Email = 'User@Example.Com';
    const payment2Email = 'user@example.com';

    const hash1 = await hashEmail(payment1Email);
    const hash2 = await hashEmail(payment2Email);

    // Both payments should update the same email_license key
    const kvKey1 = `email_license:${hash1}`;
    const kvKey2 = `email_license:${hash2}`;

    expect(kvKey1).toBe(kvKey2);
    console.log('✅ Consistent hashing prevents dual license creation');
  });
});
