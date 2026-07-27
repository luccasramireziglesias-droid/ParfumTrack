// @ts-check
// F4 — compras al proveedor (reposición de stock con su costo)
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

test.describe('F4 — compras al proveedor', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/*.gstatic.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
    await page.route('**/onesignal.com/**', r => r.abort());
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      for (const c of await DB.getAll('compras')) await DB.delete('compras', c.id);
      const p = App.perfumes[0];
      p.stock = 2;
      p.precioCompra = 500;
      await DB.put('perfumes', p);
      await App.loadData();
      App.showScreen('stock');
    });
  });

  const perfumeId = (page) => page.evaluate(() => App.perfumes[0].id);

  test('la base migró a v4 con el store de compras', async ({ page }) => {
    const info = await page.evaluate(async () => {
      await DB.getAll('compras');
      return { version: db.version, stores: [...db.objectStoreNames] };
    });
    expect(info.version).toBeGreaterThanOrEqual(4);
    expect(info.stores).toContain('compras');
  });

  test('reponer suma al stock, guarda el costo y actualiza el del perfume', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate((pid) => App.abrirCompra(pid), id);
    await expect(page.locator('#modal-compra')).toBeVisible();
    await expect(page.locator('#compra-stock-actual')).toHaveText('2 en stock');
    // Prefill con el costo anterior
    await expect(page.locator('#compra-precio')).toHaveValue('500');

    await page.click('button[onclick="App.cambiarCantidadCompra(1)"]');
    await page.click('button[onclick="App.cambiarCantidadCompra(1)"]');
    expect(await page.inputValue('#compra-cantidad')).toBe('3');
    await expect(page.locator('#compra-stock-final')).toHaveText('Queda en 5');

    await page.fill('#compra-precio', '600');
    await expect(page.locator('#compra-total')).toContainText('1.800');
    await page.fill('#compra-proveedor', 'Distribuidora Sur');
    await page.click('#compra-confirmar');
    await page.waitForFunction(() => App.comprasData.length === 1, { timeout: 10000 });

    const p = await page.evaluate(async (pid) => await DB.get('perfumes', pid), id);
    expect(p.stock).toBe(5);
    expect(p.precioCompra).toBe(600);

    const c = await page.evaluate(() => App.comprasData[0]);
    expect(c.cantidad).toBe(3);
    expect(c.precioUnitario).toBe(600);
    expect(c.total).toBe(1800);
    expect(c.proveedor).toBe('Distribuidora Sur');
    expect(c.costoActualizado).toBe(true);
  });

  test('sin actualizar costo, el precio del perfume queda como estaba', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate((pid) => App.abrirCompra(pid), id);
    await page.fill('#compra-precio', '900');
    await page.uncheck('#compra-actualiza-costo');
    await page.click('#compra-confirmar');
    await page.waitForFunction(() => App.comprasData.length === 1, { timeout: 10000 });

    const p = await page.evaluate(async (pid) => await DB.get('perfumes', pid), id);
    expect(p.precioCompra).toBe(500);
    expect(p.stock).toBe(3);
    expect(await page.evaluate(() => App.comprasData[0].costoActualizado)).toBe(false);
  });

  test('rechaza precio en cero y no toca el stock', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate((pid) => App.abrirCompra(pid), id);
    await page.fill('#compra-precio', '0');
    await page.click('#compra-confirmar');
    await page.waitForTimeout(500);

    await expect(page.locator('#modal-compra')).toBeVisible();
    expect(await page.evaluate(async (pid) => (await DB.get('perfumes', pid)).stock, id)).toBe(2);
    expect(await page.evaluate(() => App.comprasData.length)).toBe(0);
  });

  test('el listado de últimas compras muestra el total invertido del mes', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate(async (pid) => {
      await DB.registrarCompra({ perfumeId: pid, cantidad: 3, precioUnitario: 600, proveedor: 'Sur' });
      await DB.registrarCompra({ perfumeId: pid, cantidad: 2, precioUnitario: 700, proveedor: 'Norte' });
      await App.loadData();
      App.renderStock();
    }, id);

    await expect(page.locator('#stock-compras')).toBeVisible();
    // 1800 + 1400
    await expect(page.locator('#stock-compras-resumen')).toContainText('3.200');
    await expect(page.locator('.compra-row')).toHaveCount(2);
    // La más reciente arriba
    await expect(page.locator('.compra-row').first()).toContainText('Norte');
  });

  test('borrar una compra descuenta del stock sin dejarlo negativo', async ({ page }) => {
    const id = await perfumeId(page);
    const compraId = await page.evaluate(async (pid) => {
      const c = await DB.registrarCompra({ perfumeId: pid, cantidad: 3, precioUnitario: 600 });
      await App.loadData();
      return c.id;
    }, id);
    expect(await page.evaluate(async (pid) => (await DB.get('perfumes', pid)).stock, id)).toBe(5);

    await page.evaluate(async (cid) => { await DB.eliminarCompra(cid); await App.loadData(); }, compraId);
    expect(await page.evaluate(async (pid) => (await DB.get('perfumes', pid)).stock, id)).toBe(2);

    // Si ya se vendió todo, borrar la compra no deja stock negativo
    const compra2 = await page.evaluate(async (pid) => {
      const c = await DB.registrarCompra({ perfumeId: pid, cantidad: 5, precioUnitario: 600 });
      const p = await DB.get('perfumes', pid);
      p.stock = 1;
      await DB.put('perfumes', p);
      await App.loadData();
      return c.id;
    }, id);
    await page.evaluate(async (cid) => { await DB.eliminarCompra(cid); await App.loadData(); }, compra2);
    expect(await page.evaluate(async (pid) => (await DB.get('perfumes', pid)).stock, id)).toBe(0);
  });

  test('las compras entran en el export de datos', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate(async (pid) => {
      await DB.registrarCompra({ perfumeId: pid, cantidad: 3, precioUnitario: 600 });
      await App.loadData();
    }, id);
    const tieneCompras = await page.evaluate(() => {
      const src = App.exportData.toString();
      return src.includes('compras: this.comprasData');
    });
    expect(tieneCompras).toBe(true);
    expect(await page.evaluate(() => App.comprasData.length)).toBe(1);
  });
});
