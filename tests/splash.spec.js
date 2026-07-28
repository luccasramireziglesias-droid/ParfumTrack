// @ts-check
// Pantalla de carga: tiene que aparecer enseguida y, sobre todo, IRSE siempre.
// Un splash que queda pegado tapa la app entera.
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

const sinOnboarding = () => {
  localStorage.setItem('pt_onboarded', '1');
  localStorage.setItem('pt_consent_accepted', '1');
};

test.describe('Pantalla de carga', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/*.gstatic.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
  });

  test('se ve al arrancar y desaparece cuando la app está lista', async ({ page }) => {
    await page.addInitScript(sinOnboarding);
    await page.goto(APP_URL, { waitUntil: 'commit' });

    // Está en el HTML, no lo inyecta el JS: se pinta antes de que corra nada
    await page.waitForSelector('#splash', { state: 'attached', timeout: 5000 });
    await expect(page.locator('#splash .splash-nombre')).toHaveText('Parfum Track');

    // Y se saca del DOM al terminar, para que no intercepte toques
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    await expect(page.locator('#stat-ventas')).toBeVisible();
  });

  test('si el arranque falla no tapa la pantalla de error', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
      indexedDB.open = () => { throw new Error('IndexedDB no disponible (simulado)'); };
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    await expect(page.locator('text=No pudimos abrir tus datos')).toBeVisible();
  });

  test('con PIN activo no tapa la pantalla de desbloqueo', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
      localStorage.setItem('pt_pin_enabled', '1');
      localStorage.setItem('pt_pin_hash', 'hash-de-prueba');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    await expect(page.locator('#lock-screen')).toBeVisible();
  });
});
