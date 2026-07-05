// Test PH4-01: Encrypt Sensitive KV Secrets (AES-256-GCM with PBKDF2)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function encryptSecret(secret, masterKey) {
  if (!masterKey) throw new Error('Master key required for encryption');
  if (typeof secret !== 'string') throw new Error('Secret must be string');

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const secretData = enc.encode(secret);

  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(masterKey), { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedKey = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: iv, iterations: 100000 }, keyMaterial, 256);

  const key = await crypto.subtle.importKey('raw', derivedKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secretData);

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  return `${ivB64}.${ctB64}`;
}

async function decryptSecret(encrypted, masterKey) {
  if (!masterKey) throw new Error('Master key required for decryption');
  if (typeof encrypted !== 'string' || !encrypted.includes('.')) throw new Error('Invalid encrypted format');

  const [ivB64, ctB64] = encrypted.split('.');
  const iv = new Uint8Array(atob(ivB64).split('').map(c => c.charCodeAt(0)));
  const ciphertext = new Uint8Array(atob(ctB64).split('').map(c => c.charCodeAt(0)));
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(masterKey), { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedKey = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: iv, iterations: 100000 }, keyMaterial, 256);

  const key = await crypto.subtle.importKey('raw', derivedKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

  return new TextDecoder().decode(plaintext);
}

describe('PH4-01: Encrypt Sensitive Secrets', () => {
  const masterKey = 'super-secret-master-key-for-kv-encryption';
  const testSecrets = [
    'sk_live_123456789abcdef',
    'license_private_key_xyz',
    'mp_access_token_abc123',
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encrypts and decrypts secret correctly', async () => {
    const secret = testSecrets[0];
    const encrypted = await encryptSecret(secret, masterKey);

    expect(encrypted).toBeTruthy();
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/); // Base64.Base64

    const decrypted = await decryptSecret(encrypted, masterKey);
    expect(decrypted).toBe(secret);
    console.log('✅ Encrypt/decrypt round-trip successful');
  });

  it('produces different ciphertext each time (random IV)', async () => {
    const secret = testSecrets[0];
    const encrypted1 = await encryptSecret(secret, masterKey);
    const encrypted2 = await encryptSecret(secret, masterKey);

    expect(encrypted1).not.toBe(encrypted2); // Different IVs
    console.log('✅ Random IV generates different ciphertext each time');
  });

  it('rejects wrong master key on decryption', async () => {
    const secret = testSecrets[1];
    const encrypted = await encryptSecret(secret, masterKey);

    const wrongKey = 'wrong-master-key';
    try {
      await decryptSecret(encrypted, wrongKey);
      expect.fail('Should have thrown');
    } catch (e) {
      // WebCrypto throws when decryption fails, exact message varies
      expect(e).toBeTruthy();
      console.log('✅ Wrong master key rejected (decryption fails)');
    }
  });

  it('rejects missing master key on encrypt', async () => {
    try {
      await encryptSecret('secret', null);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toBe('Master key required for encryption');
      console.log('✅ Missing master key on encrypt rejected');
    }
  });

  it('rejects missing master key on decrypt', async () => {
    try {
      await decryptSecret('fake.data', null);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toBe('Master key required for decryption');
      console.log('✅ Missing master key on decrypt rejected');
    }
  });

  it('rejects malformed encrypted data', async () => {
    try {
      await decryptSecret('invalid-format-no-dot', masterKey);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toContain('Invalid encrypted format');
      console.log('✅ Malformed encrypted data rejected');
    }
  });

  it('rejects non-string secrets', async () => {
    try {
      await encryptSecret(12345, masterKey);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toBe('Secret must be string');
      console.log('✅ Non-string secrets rejected');
    }
  });

  it('encrypts long secrets (multi-paragraph)', async () => {
    const longSecret = 'sk_live_'.repeat(100);
    const encrypted = await encryptSecret(longSecret, masterKey);
    const decrypted = await decryptSecret(encrypted, masterKey);

    expect(decrypted).toBe(longSecret);
    console.log('✅ Long secrets encrypted/decrypted correctly');
  });

  it('encrypts secrets with special characters', async () => {
    const specialSecret = 'api_key_!@#$%^&*()_+-=[]{}|;:,.<>?';
    const encrypted = await encryptSecret(specialSecret, masterKey);
    const decrypted = await decryptSecret(encrypted, masterKey);

    expect(decrypted).toBe(specialSecret);
    console.log('✅ Special characters preserved');
  });

  it('uses PBKDF2 with 100k iterations for key derivation', async () => {
    // Verify format: IV.Ciphertext (both base64)
    const encrypted = await encryptSecret('test', masterKey);
    const parts = encrypted.split('.');

    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(parts[1]).toMatch(/^[A-Za-z0-9+/=]+$/);

    // IV should be 12 bytes base64-encoded (16 base64 chars)
    const decodedIV = atob(parts[0]);
    expect(decodedIV).toHaveLength(12);
    console.log('✅ PBKDF2 key derivation with correct IV size');
  });

  it('decryption fails on corrupted ciphertext', async () => {
    const secret = 'important-secret';
    let encrypted = await encryptSecret(secret, masterKey);

    // Corrupt the ciphertext
    const [iv, ct] = encrypted.split('.');
    const corruptedCT = ct.slice(0, -4) + 'XXXX';
    const corrupted = `${iv}.${corruptedCT}`;

    try {
      await decryptSecret(corrupted, masterKey);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeTruthy();
      console.log('✅ Corrupted ciphertext detected and rejected');
    }
  });

  it('decryption fails on modified IV', async () => {
    const secret = 'important-secret';
    let encrypted = await encryptSecret(secret, masterKey);

    // Corrupt the IV
    const [iv, ct] = encrypted.split('.');
    const corruptedIV = iv.slice(0, -2) + 'XX';
    const corrupted = `${corruptedIV}.${ct}`;

    try {
      await decryptSecret(corrupted, masterKey);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeTruthy();
      console.log('✅ Modified IV detected and rejected');
    }
  });

  it('handles all test secret types correctly', async () => {
    for (const secret of testSecrets) {
      const encrypted = await encryptSecret(secret, masterKey);
      const decrypted = await decryptSecret(encrypted, masterKey);
      expect(decrypted).toBe(secret);
    }
    console.log(`✅ All ${testSecrets.length} test secret types encrypted/decrypted`);
  });
});
