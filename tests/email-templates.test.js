import { describe, it, expect, vi } from 'vitest';
import { sendEmail } from '../functions/_email-templates.js';

function makeEnv(overrides = {}) {
  return {
    BREVO_API_KEY: 'test-key',
    FROM_NAME: 'Parfum Track',
    FROM_EMAIL: 'parfumtrack@gmail.com',
    APP_URL: 'https://parfumtrack.luccasramireziglesias.workers.dev',
    ...overrides,
  };
}

describe('sendEmail', () => {
  it('skips when BREVO_API_KEY is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendEmail({ }, 'test@test.com', 'subscription_activated', { code: 'PT-ABC-DEF', expiresAt: '2027-01-01' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('skips for unknown template', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendEmail(makeEnv(), 'test@test.com', 'nonexistent_template', {});
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('sends subscription_activated email with correct structure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    await sendEmail(makeEnv(), 'user@example.com', 'subscription_activated', {
      code: 'PT-ABC-DEF',
      expiresAt: '2027-06-01',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    const body = JSON.parse(opts.body);
    expect(body.to[0].email).toBe('user@example.com');
    expect(body.subject).toContain('plan');
    expect(body.htmlContent).toContain('PT-ABC-DEF');
    expect(body.textContent).toContain('PT-ABC-DEF');
    expect(body.headers['List-Unsubscribe']).toBeDefined();
    fetchSpy.mockRestore();
  });

  it('sends subscription_renewed email', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    await sendEmail(makeEnv(), 'user@example.com', 'subscription_renewed', {
      expiresAt: '2027-12-01',
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.subject).toContain('renovado');
    expect(body.htmlContent).toContain('2027-12-01');
    fetchSpy.mockRestore();
  });

  it('sends payment_failed email', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    await sendEmail(makeEnv(), 'user@example.com', 'payment_failed', {});
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.subject).toContain('Problema');
    expect(body.htmlContent).toContain('WhatsApp');
    fetchSpy.mockRestore();
  });

  it('sends subscription_cancelled email', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    await sendEmail(makeEnv(), 'user@example.com', 'subscription_cancelled', {
      expiresAt: '2027-03-15',
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.subject).toContain('cancelado');
    expect(body.htmlContent).toContain('2027-03-15');
    fetchSpy.mockRestore();
  });

  it('sends owner_payment_notification for new payment', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    await sendEmail(makeEnv(), 'owner@example.com', 'owner_payment_notification', {
      clientEmail: 'client@test.com',
      code: 'PT-111-222',
      plan: 'basic_monthly',
      expiresAt: '2027-07-01',
      paymentId: '12345',
      type: 'new',
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.subject).toContain('Nuevo pago');
    expect(body.htmlContent).toContain('PT-111-222');
    expect(body.htmlContent).toContain('NUEVA LICENCIA');
    fetchSpy.mockRestore();
  });

  it('sends owner_payment_notification for renewal', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    await sendEmail(makeEnv(), 'owner@example.com', 'owner_payment_notification', {
      clientEmail: 'client@test.com',
      code: 'PT-111-222',
      plan: 'basic_annual',
      expiresAt: '2028-07-01',
      paymentId: '67890',
      type: 'renewal',
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.subject).toContain('Renovacion');
    expect(body.htmlContent).toContain('Anual');
    expect(body.htmlContent).toContain('RENOVACION');
    fetchSpy.mockRestore();
  });

  it('sanitizes HTML in data values', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    await sendEmail(makeEnv(), 'user@example.com', 'subscription_activated', {
      code: '<script>alert("xss")</script>',
      expiresAt: '2027-01-01',
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.htmlContent).not.toContain('<script>');
    expect(body.htmlContent).toContain('&lt;script&gt;');
    fetchSpy.mockRestore();
  });

  it('handles Brevo API errors gracefully', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 });
    await sendEmail(makeEnv(), 'user@example.com', 'subscription_activated', {
      code: 'PT-ABC-DEF',
      expiresAt: '2027-01-01',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('handles fetch exceptions gracefully', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await sendEmail(makeEnv(), 'user@example.com', 'subscription_activated', {
      code: 'PT-ABC-DEF',
      expiresAt: '2027-01-01',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
