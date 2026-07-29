// @ts-check
// El nombre del negocio no puede tapar el chip de cuenta.
//
// Con un nombre largo, `.logo-group` empujaba a `.header-actions` fuera del
// viewport: el chip de "Free" —la única puerta a la licencia, la suscripción
// y los backups— quedaba literalmente inalcanzable.
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

const LARGO = 'VIPPARFUMSmgdsssdjhffghhhffgdghjjkkllmnopqrstuvwxyz';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/*.googleapis.com/**', r => r.abort());
  await page.route('**/*.gstatic.com/**', r => r.abort());
  await page.route('**/plausible.io/**', r => r.abort());
  await page.addInitScript(() => {
    localStorage.setItem('pt_onboarded', '1');
    localStorage.setItem('pt_consent_accepted', '1');
  });
});

const abrir = async (page) => {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
  await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });
};

// ¿El chip entra entero en la pantalla?
const chipVisible = (page) => page.evaluate(() => {
  const chip = document.getElementById('plan-chip');
  const r = chip.getBoundingClientRect();
  return {
    dentro: r.right <= window.innerWidth + 0.5 && r.left >= -0.5,
    ancho: Math.round(r.width),
    derecha: Math.round(r.right),
    viewport: window.innerWidth,
  };
});

test.describe('Header — nombre del negocio', () => {
  test('un nombre larguísimo no empuja el chip de cuenta fuera de pantalla', async ({ page }) => {
    await abrir(page);
    await page.evaluate((n) => App.setNombreNegocio(n), LARGO);

    const chip = await chipVisible(page);
    console.log('chip:', JSON.stringify(chip));
    expect(chip.dentro, 'el chip de cuenta se salió del viewport').toBe(true);
    expect(chip.ancho, 'el chip quedó aplastado a 0').toBeGreaterThan(40);

    // Y sigue siendo clickeable, que es lo que importa: es la única forma de
    // llegar a la licencia y a los backups
    await page.click('#plan-chip');
    await expect.poll(() => page.evaluate(() => App.currentScreen)).toBe('cuenta');
  });

  test('el nombre se corta con puntos suspensivos, no se desborda', async ({ page }) => {
    await abrir(page);
    await page.evaluate((n) => App.setNombreNegocio(n), LARGO);

    const logo = await page.evaluate(() => {
      const el = document.querySelector('.logo-text');
      const cs = getComputedStyle(el);
      return {
        overflow: cs.overflow,
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
        // scrollWidth > clientWidth significa que hay texto cortado
        cortado: el.scrollWidth > el.clientWidth,
        title: el.title,
      };
    });
    expect(logo.textOverflow).toBe('ellipsis');
    expect(logo.whiteSpace).toBe('nowrap');
    expect(logo.overflow).toBe('hidden');
    // El nombre completo queda accesible aunque se vea cortado
    expect(logo.title.length).toBeGreaterThan(0);
  });

  test('lo que se guarda se acota a 30 caracteres', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate((n) => {
      App.setNombreNegocio(n);
      return {
        guardado: localStorage.getItem('pt_negocio'),
        max: App._NOMBRE_NEGOCIO_MAX,
      };
    }, LARGO);
    expect(r.guardado.length).toBe(30);
    expect(r.max).toBe(30);
    expect(r.guardado).toBe(LARGO.slice(0, 30));
  });

  test('un nombre ya guardado de antes también se acota al cargar', async ({ page }) => {
    // maxlength no aplica a lo que setea el código: quien ya tenía un nombre
    // largo guardado tiene que quedar sano igual
    await page.addInitScript((n) => localStorage.setItem('pt_negocio', n), LARGO);
    await abrir(page);
    const guardado = await page.evaluate(() => localStorage.getItem('pt_negocio'));
    expect(guardado.length).toBe(30);
    expect(await chipVisible(page)).toMatchObject({ dentro: true });
  });

  test('el input tiene maxlength para que no se pueda tipear de más', async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => App.showScreen('mas'));
    await expect(page.locator('#input-negocio')).toHaveAttribute('maxlength', '30');
  });

  test('un nombre normal se ve completo y sin cortar', async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => App.setNombreNegocio('VIP Parfums'));
    const logo = await page.evaluate(() => {
      const el = document.querySelector('.logo-text');
      return { texto: el.textContent, cortado: el.scrollWidth > el.clientWidth };
    });
    expect(logo.texto).toBe('VIP Parfums');
    expect(logo.cortado, 'un nombre corto no debería cortarse').toBe(false);
    expect(await chipVisible(page)).toMatchObject({ dentro: true });
  });

  test('sin nombre cargado muestra la marca', async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => App.setNombreNegocio(''));
    await expect(page.locator('.logo-text')).toHaveText('Parfum Track');
  });
});
