// Test PH4-02: HMAC Integrity Verification (detect tampering of encrypted data)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function createAuthenticatedEncryption(encrypted, masterKey) {
  if (!masterKey) throw new Error('Master key required');
  if (typeof encrypted !== 'string') throw new Error('Encrypted data must be string');

  const dotCount = (encrypted.match(/\./g) || []).length;
  if (dotCount !== 1) throw new Error('Invalid encrypted format: expected IV.ciphertext');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(masterKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(encrypted));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return `${encrypted}.${sigB64}`;
}

async function verifyAuthenticatedEncryption(authenticated, masterKey) {
  if (!masterKey) throw new Error('Master key required');
  if (typeof authenticated !== 'string') throw new Error('Authenticated data must be string');

  const dotCount = (authenticated.match(/\./g) || []).length;
  if (dotCount !== 2) throw new Error('Invalid authenticated format: expected IV.ciphertext.HMAC');

  const lastDot = authenticated.lastIndexOf('.');
  const encrypted = authenticated.substring(0, lastDot);
  const providedSigB64 = authenticated.substring(lastDot + 1);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(masterKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const providedSig = new Uint8Array(atob(providedSigB64).split('').map(c => c.charCodeAt(0)));

  const isValid = await crypto.subtle.verify('HMAC', key, providedSig, enc.encode(encrypted));
  if (!isValid) throw new Error('HMAC verification failed — data may be tampered');

  return encrypted;
}

describe('PH4-02: HMAC Integrity Verification', () => {
  const masterKey = 'master-key-for-hmac';
  const testEncrypted = 'dGVzdDEyMzQ1.Y2lwaGVydGV4dA=='; // Base64 IV.ciphertext format

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates authenticated encryption with HMAC', async () => {
    const authenticated = await createAuthenticatedEncryption(testEncrypted, masterKey);

    expect(authenticated).toBeTruthy();
    expect(authenticated).toContain('.');
    const parts = authenticated.split('.');
    expect(parts).toHaveLength(3); // IV.ciphertext.HMAC
    console.log('✅ Authenticated encryption created with HMAC');
  });

  it('verifies and extracts valid authenticated encryption', async () => {
    const authenticated = await createAuthenticatedEncryption(testEncrypted, masterKey);
    const verified = await verifyAuthenticatedEncryption(authenticated, masterKey);

    expect(verified).toBe(testEncrypted);
    console.log('✅ Valid HMAC verified successfully');
  });

  it('rejects modified IV in encrypted data', async () => {
    let authenticated = await createAuthenticatedEncryption(testEncrypted, masterKey);

    // Corrupt the IV part
    const [iv, ct, hmac] = authenticated.split('.');
    const corruptedIV = iv.slice(0, -2) + 'XX';
    const corrupted = `${corruptedIV}.${ct}.${hmac}`;

    try {
      await verifyAuthenticatedEncryption(corrupted, masterKey);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toContain('HMAC verification failed');
      console.log('✅ Modified IV detected by HMAC');
    }
  });

  it('rejects modified ciphertext', async () => {
    let authenticated = await createAuthenticatedEncryption(testEncrypted, masterKey);

    // Corrupt the ciphertext part
    const [iv, ct, hmac] = authenticated.split('.');
    const corruptedCT = ct.slice(0, -4) + 'XXXX';
    const corrupted = `${iv}.${corruptedCT}.${hmac}`;

    try {
      await verifyAuthenticatedEncryption(corrupted, masterKey);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toContain('HMAC verification failed');
      console.log('✅ Modified ciphertext detected by HMAC');
    }
  });

  it('rejects modified HMAC', async () => {
    let authenticated = await createAuthenticatedEncryption(testEncrypted, masterKey);

    // Corrupt the HMAC
    const [iv, ct, hmac] = authenticated.split('.');
    const corruptedHMAC = hmac.slice(0, -4) + 'XXXX';
    const corrupted = `${iv}.${ct}.${corruptedHMAC}`;

    try {
      await verifyAuthenticatedEncryption(corrupted, masterKey);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toContain('HMAC verification failed');
      console.log('✅ Modified HMAC detected (HMAC verify fails)');
    }
  });

  it('rejects wrong master key', async () => {
    let authenticated = await createAuthenticatedEncryption(testEncrypted, masterKey);
    const wrongKey = 'wrong-master-key';

    try {
      await verifyAuthenticatedEncryption(authenticated, wrongKey);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toContain('HMAC verification failed');
      console.log('✅ Wrong master key causes HMAC failure');
    }
  });

  it('rejects missing master key', async () => {
    try {
      await createAuthenticatedEncryption(testEncrypted, null);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toBe('Master key required');
      console.log('✅ Missing master key rejected');
    }
  });

  it('rejects invalid authenticated format (no HMAC)', async () => {
    try {
      await verifyAuthenticatedEncryption(testEncrypted, masterKey); // No HMAC appended
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toContain('Invalid authenticated format');
      console.log('✅ Missing HMAC rejected');
    }
  });

  it('produces different HMACs for different encrypted data', async () => {
    const encrypted1 = 'dGVzdDEyMzQ1.Y2lwaGVydGV4dA==';
    const encrypted2 = 'ZGlmZmVyZW50.aW5wdXQ==';

    const auth1 = await createAuthenticatedEncryption(encrypted1, masterKey);
    const auth2 = await createAuthenticatedEncryption(encrypted2, masterKey);

    const hmac1 = auth1.split('.')[2];
    const hmac2 = auth2.split('.')[2];

    expect(hmac1).not.toBe(hmac2);
    console.log('✅ Different data produces different HMACs');
  });

  it('produces same HMAC for same encrypted data', async () => {
    const encrypted = testEncrypted;

    const auth1 = await createAuthenticatedEncryption(encrypted, masterKey);
    const auth2 = await createAuthenticatedEncryption(encrypted, masterKey);

    const hmac1 = auth1.split('.')[2];
    const hmac2 = auth2.split('.')[2];

    expect(hmac1).toBe(hmac2);
    console.log('✅ Same data produces consistent HMAC');
  });

  it('handles long encrypted data', async () => {
    const longEncrypted = 'IV.'.concat('A'.repeat(1000)); // 1000+ char ciphertext

    const authenticated = await createAuthenticatedEncryption(longEncrypted, masterKey);
    const verified = await verifyAuthenticatedEncryption(authenticated, masterKey);

    expect(verified).toBe(longEncrypted);
    console.log('✅ Long encrypted data integrity verified');
  });

  it('HMAC is deterministic (same input = same HMAC)', async () => {
    const encrypted = 'test.data';

    let auth1 = await createAuthenticatedEncryption(encrypted, masterKey);
    let auth2 = await createAuthenticatedEncryption(encrypted, masterKey);

    expect(auth1).toBe(auth2);
    console.log('✅ HMAC is deterministic');
  });

  it('detects bit-flip in ciphertext', async () => {
    let authenticated = await createAuthenticatedEncryption(testEncrypted, masterKey);

    // Single bit flip in ciphertext
    const [iv, ct, hmac] = authenticated.split('.');
    const bytes = atob(ct).split('');
    bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 1); // Flip one bit
    const corruptedCT = btoa(bytes.join(''));
    const corrupted = `${iv}.${corruptedCT}.${hmac}`;

    try {
      await verifyAuthenticatedEncryption(corrupted, masterKey);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toContain('HMAC verification failed');
      console.log('✅ Single bit-flip detected');
    }
  });
});
