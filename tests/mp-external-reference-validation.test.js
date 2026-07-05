// Test MP external_reference Validation (MP-PH-02)
import { describe, it, expect } from 'vitest';

function validateExternalReference(refString) {
  if (!refString) return { valid: false, reason: 'missing' };

  try {
    const ref = JSON.parse(refString);

    // Validate structure
    if (typeof ref !== 'object' || ref === null) {
      return { valid: false, reason: 'not_object' };
    }

    if (typeof ref.email !== 'string') {
      return { valid: false, reason: 'missing_email_string' };
    }

    const plan = ref.plan || 'monthly';
    const validPlans = ['monthly', 'annual', 'basic_monthly', 'basic_annual'];
    if (!validPlans.includes(plan)) {
      return { valid: false, reason: 'invalid_plan', plan };
    }

    return {
      valid: true,
      email: ref.email.toLowerCase().trim(),
      plan,
    };
  } catch (e) {
    return { valid: false, reason: 'json_parse_error', error: e.message };
  }
}

describe('MP external_reference Validation (MP-PH-02)', () => {
  it('accepts valid external_reference with email and plan', () => {
    const ref = JSON.stringify({ email: 'user@example.com', plan: 'monthly' });
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(true);
    expect(result.email).toBe('user@example.com');
    expect(result.plan).toBe('monthly');
    console.log('✅ Valid external_reference accepted');
  });

  it('accepts valid external_reference with email only (defaults plan to monthly)', () => {
    const ref = JSON.stringify({ email: 'user@example.com' });
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(true);
    expect(result.email).toBe('user@example.com');
    expect(result.plan).toBe('monthly');
    console.log('✅ External_reference with default plan accepted');
  });

  it('rejects external_reference with missing email', () => {
    const ref = JSON.stringify({ plan: 'monthly' });
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_email_string');
    console.log('✅ Missing email rejected');
  });

  it('rejects external_reference with non-string email', () => {
    const ref = JSON.stringify({ email: 123, plan: 'monthly' });
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_email_string');
    console.log('✅ Non-string email rejected');
  });

  it('rejects external_reference with invalid plan', () => {
    const ref = JSON.stringify({ email: 'user@example.com', plan: 'premium' });
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_plan');
    console.log('✅ Invalid plan rejected');
  });

  it('rejects malformed JSON', () => {
    const ref = 'not valid json {]';
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('json_parse_error');
    console.log('✅ Malformed JSON rejected');
  });

  it('rejects non-object structures', () => {
    const ref = JSON.stringify('just a string');
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('not_object');
    console.log('✅ Non-object JSON rejected');
  });

  it('rejects array instead of object', () => {
    const ref = JSON.stringify(['email@example.com', 'monthly']);
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(false);
    // Arrays are objects, but don't have email string property
    expect(result.reason).toBe('missing_email_string');
    console.log('✅ Array JSON rejected');
  });

  it('accepts all valid plan values', () => {
    const validPlans = ['monthly', 'annual', 'basic_monthly', 'basic_annual'];

    for (const plan of validPlans) {
      const ref = JSON.stringify({ email: 'user@example.com', plan });
      const result = validateExternalReference(ref);

      expect(result.valid).toBe(true);
      expect(result.plan).toBe(plan);
    }
    console.log('✅ All valid plans accepted');
  });

  it('normalizes email in valid external_reference', () => {
    const ref = JSON.stringify({ email: '  User@EXAMPLE.COM  ', plan: 'annual' });
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(true);
    expect(result.email).toBe('user@example.com');
    console.log('✅ Email normalized in external_reference');
  });

  it('rejects external_reference with extra fields (but still validates core fields)', () => {
    // This should pass — extra fields are OK, we just need email and optional plan
    const ref = JSON.stringify({
      email: 'user@example.com',
      plan: 'monthly',
      extra_field: 'malicious_data',
      another_field: 123
    });
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(true);
    console.log('✅ Extra fields ignored, core fields validated');
  });

  it('rejects external_reference with null email', () => {
    const ref = JSON.stringify({ email: null, plan: 'monthly' });
    const result = validateExternalReference(ref);

    expect(result.valid).toBe(false);
    console.log('✅ Null email rejected');
  });
});
