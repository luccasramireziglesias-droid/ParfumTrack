// @ts-check
// Alertas de stock: con muchos perfumes agotados la lista tapaba el
// inventario entero. Ahora resume y deja expandir.
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

const NOMBRES = ['BOSS PARFUM', 'HAWAS KOBRA', 'KHAMRA CLASICO', 'SUAVAGE EDT', 'YARA ROSA',
  'CDN INTENSE', 'MANDARIN SKY', 'SUAVAGE EDP 200ML', '9AM DIVE', 'ASAD NEGRO',
  'PRECIEUX I', 'CDN URBAN ELIXIR', 'INVICTUS', 'OLYMPEA'];

test.describe('Alertas de stock', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/*.gstatic.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
    await page.waitForTimeout(1200);

    // 14 perfumes agotados con ventas del mes, como queda tras importar
    await page.evaluate(async (nombres) => {
      for (const p of await DB.getAll('perfumes')) await DB.delete('perfumes', p.id);
      for (const v of await DB.getAll('ventas')) await DB.delete('ventas', v.id);
      for (const n of nombres) {
        await DB.addPerfume({ nombre: n, stock: 0, precioCompra: 1000, precioVenta: 2000 });
        const veces = n === 'YARA ROSA' ? 3 : 1;   // este rota más
        for (let i = 0; i < veces; i++) {
          await DB.addVenta({
            perfume: n, perfumeId: null, cantidad: 1, precioVenta: 2000, precioCompra: 1000,
            cliente: 'X', vendedor: 'Y', formaPago: 'contado', numCuotas: 1,
            fecha: Date.now() - 86400000,
          });
        }
      }
      await App.loadData();
      App.showScreen('stock');
    }, NOMBRES);
    await page.waitForTimeout(300);
  });

  test('resume el total y muestra solo las tres más urgentes', async ({ page }) => {
    await expect(page.locator('.stock-alert-titulo')).toHaveText('14 sin stock');
    await expect(page.locator('.stock-alert-card')).toHaveCount(3);
    await expect(page.locator('.stock-alert-mas')).toHaveText('y 11 más para reponer');
  });

  test('deja ver el inventario sin tener que scrollear', async ({ page }) => {
    // El punto del cambio: antes 14 tarjetas empujaban el stock fuera de la
    // pantalla. El bloque tiene que quedar en una fracción del alto.
    const alto = await page.evaluate(() => document.getElementById('stock-alerts').offsetHeight);
    expect(alto).toBeLessThan(300);
    const primeraCard = await page.evaluate(() => {
      const el = document.querySelector('#stock-grid .stock-card');
      return el ? el.getBoundingClientRect().top : 9999;
    });
    expect(primeraCard).toBeLessThan(844);
  });

  test('prioriza lo que más rota', async ({ page }) => {
    // YARA ROSA sale 3 por mes: reponerlo primero es lo que más importa
    await expect(page.locator('.stock-alert-nombre').first()).toHaveText('YARA ROSA');
    await expect(page.locator('.stock-alert-detalle').first()).toHaveText('sin stock · vendés 3/mes');
  });

  test('se puede desplegar y volver a plegar', async ({ page }) => {
    await page.click('.stock-alert-toggle');
    await expect(page.locator('.stock-alert-card')).toHaveCount(14);
    await expect(page.locator('.stock-alert-toggle')).toHaveText('Ver menos');
    await expect(page.locator('.stock-alert-mas')).toHaveCount(0);

    await page.click('.stock-alert-toggle');
    await expect(page.locator('.stock-alert-card')).toHaveCount(3);
  });

  test('"Reponer" abre la compra de ESE perfume', async ({ page }) => {
    // Antes era un texto suelto que no hacía nada
    await page.locator('.stock-alert-card').first().locator('.stock-alert-btn').click();
    await expect(page.locator('#modal-compra')).toBeVisible();
    await expect(page.locator('#compra-perfume')).toHaveText('YARA ROSA');
  });

  test('cuenta unidades, no cantidad de ventas', async ({ page }) => {
    // Una venta de 5 unidades consume el mismo stock que cinco ventas de 1
    await page.evaluate(async () => {
      await DB.addVenta({
        perfume: 'OLYMPEA', perfumeId: null, cantidad: 5, precioVenta: 10000,
        precioCompra: 5000, cliente: 'X', vendedor: 'Y', formaPago: 'contado',
        numCuotas: 1, fecha: Date.now() - 3600000,
      });
      await App.loadData();
      App.renderStock();
    });
    await page.click('.stock-alert-toggle');
    // 1 venta suelta + 5 unidades = 6 por mes, y pasa a encabezar la lista
    await expect(page.locator('.stock-alert-nombre').first()).toHaveText('OLYMPEA');
    await expect(page.locator('.stock-alert-detalle').first()).toHaveText('sin stock · vendés 6/mes');
  });
});
