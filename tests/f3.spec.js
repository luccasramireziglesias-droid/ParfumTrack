// @ts-check
// F3 — devoluciones y cambios
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

test.describe('F3 — devoluciones', () => {
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
    // Partir de un historial limpio y controlado
    await page.evaluate(async () => {
      for (const v of await DB.getAll('ventas')) await DB.delete('ventas', v.id);
      for (const c of await DB.getAll('cuotas')) await DB.delete('cuotas', c.id);
      const p = App.perfumes[0];
      p.stock = 10;
      await DB.put('perfumes', p);
      await App.loadData();
    });
  });

  // Crea una venta de 2 unidades y devuelve {ventaId, perfumeId}
  const ventaContado = (page) => page.evaluate(async () => {
    const p = App.perfumes[0];
    const id = await DB.addVenta({
      perfume: p.nombre, perfumeId: p.id, cantidad: 2,
      precioVenta: 2000, precioCompra: 1200, precioUnitario: 1000, precioCompraUnitario: 600,
      cliente: 'Ana', vendedor: 'Yo', formaPago: 'contado', numCuotas: 1, fecha: Date.now()
    });
    await App.loadData();
    // renderDashboard directo: renderAll() está debounceado 100ms y el test
    // leería el hero antes de que se actualice
    App.renderDashboard();
    return { ventaId: id, perfumeId: p.id };
  });

  test('devolver repone el stock, marca la venta y la saca de la ganancia', async ({ page }) => {
    const { ventaId, perfumeId } = await ventaContado(page);

    const ganAntes = await page.textContent('#hero-ganancia');
    expect(ganAntes).toContain('800');
    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(8);

    await page.evaluate((id) => App.abrirDevolucion(id), ventaId);
    await expect(page.locator('#modal-devolucion')).toBeVisible();
    await expect(page.locator('#devolucion-cliente')).toHaveText('Ana');
    await expect(page.locator('#devolucion-cantidad')).toHaveText('2 unidades');
    await expect(page.locator('#devolucion-stock-label')).toHaveText('Devolver 2 unidades al stock');

    await page.locator('.motivo-chip', { hasText: 'No le gustó' }).click();
    await page.fill('#devolucion-nota', 'Frasco sin abrir');
    await page.click('#devolucion-confirmar');
    await page.waitForFunction(() => App.ventas.some(v => v.devuelta), { timeout: 10000 });
    await page.evaluate(() => App.renderDashboard());

    const v = await page.evaluate((id) => App.ventas.find(x => x.id === id), ventaId);
    expect(v.devuelta).toBe(true);
    expect(v.motivoDevolucion).toBe('No le gustó');
    expect(v.notaDevolucion).toBe('Frasco sin abrir');
    expect(v.unidadesRepuestas).toBe(2);
    expect(v.montoADevolver).toBe(2000);

    // Stock repuesto y ganancia en cero
    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(10);
    expect(await page.textContent('#hero-ganancia')).not.toContain('800');

    // La venta sigue en el historial, marcada
    await page.evaluate(() => { App.showScreen('ventas-all'); App.renderAllVentas(); });
    await expect(page.locator('#ventas-all-list .venta-card')).toHaveCount(1);
    await expect(page.locator('#ventas-all-list .venta-card')).toHaveClass(/devuelta/);
    await expect(page.locator('#ventas-all-list .tag-devuelta')).toContainText('Devuelta · No le gustó');
  });

  test('no se puede devolver dos veces la misma venta', async ({ page }) => {
    const { ventaId, perfumeId } = await ventaContado(page);
    await page.evaluate(async (id) => {
      await DB.devolverVenta(id, { motivo: 'Falló', reponerStock: true });
      await App.loadData();
    }, ventaId);
    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(10);

    const err = await page.evaluate(async (id) => {
      try { await DB.devolverVenta(id, {}); return null; } catch (e) { return e.message; }
    }, ventaId);
    expect(err).toBe('YA_DEVUELTA');
    // El stock no se repuso una segunda vez
    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(10);
  });

  test('cancela las cuotas impagas y conserva lo ya cobrado', async ({ page }) => {
    const ventaId = await page.evaluate(async () => {
      const p = App.perfumes[0];
      const id = await DB.addVenta({
        perfume: p.nombre, perfumeId: p.id, cantidad: 1,
        precioVenta: 3000, precioCompra: 1500, precioUnitario: 3000,
        cliente: 'Bruno', vendedor: 'Yo', formaPago: 'cuotas', numCuotas: 3, fecha: Date.now()
      });
      await App.loadData();
      return id;
    });

    // addVenta cobra la primera cuota al vender
    const antes = await page.evaluate(async (id) =>
      (await DB.getAll('cuotas')).filter(c => c.ventaId === id).map(c => ({ n: c.numero, pagado: c.pagado })), ventaId);
    expect(antes.length).toBe(3);
    expect(antes.filter(c => c.pagado).length).toBe(1);

    await page.evaluate(async (id) => {
      await DB.devolverVenta(id, { motivo: 'Se arrepintió', reponerStock: true });
      await App.loadData();
    }, ventaId);

    const despues = await page.evaluate(async (id) =>
      (await DB.getAll('cuotas')).filter(c => c.ventaId === id).map(c => ({ n: c.numero, pagado: c.pagado })), ventaId);
    expect(despues.length).toBe(1);
    expect(despues[0].pagado).toBe(true);

    const v = await page.evaluate((id) => App.ventas.find(x => x.id === id), ventaId);
    expect(v.cuotasCanceladas).toBe(2);
    expect(v.montoADevolver).toBe(1000);
  });

  test('la devolución sin reponer stock deja el inventario igual', async ({ page }) => {
    const { ventaId, perfumeId } = await ventaContado(page);
    await page.evaluate((id) => App.abrirDevolucion(id), ventaId);
    await page.uncheck('#devolucion-repone-stock');
    await page.click('#devolucion-confirmar');
    await page.waitForFunction(() => App.ventas.some(v => v.devuelta), { timeout: 10000 });

    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(8);
    const v = await page.evaluate((id) => App.ventas.find(x => x.id === id), ventaId);
    expect(v.unidadesRepuestas).toBe(0);
  });

  test('deshacer la devolución vuelve a descontar el stock y a contar la venta', async ({ page }) => {
    const { ventaId, perfumeId } = await ventaContado(page);
    await page.evaluate(async (id) => {
      await DB.devolverVenta(id, { motivo: 'Falló', reponerStock: true });
      await App.loadData();
      App.renderDashboard();
    }, ventaId);
    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(10);

    await page.evaluate(async (id) => {
      await DB.revertirDevolucion(id);
      await App.loadData();
      App.renderDashboard();
    }, ventaId);

    const v = await page.evaluate((id) => App.ventas.find(x => x.id === id), ventaId);
    expect(v.devuelta).toBeUndefined();
    expect(v.unidadesDescontadas).toBe(2);
    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(8);
    expect(await page.textContent('#hero-ganancia')).toContain('800');
  });

  test('un cambio deja el form de nueva venta listo con el mismo cliente', async ({ page }) => {
    const { ventaId } = await ventaContado(page);
    await page.evaluate((id) => App.abrirDevolucion(id), ventaId);
    await page.locator('.motivo-chip', { hasText: 'Cambio por otro' }).click();
    await page.click('#devolucion-confirmar');
    await page.waitForFunction(() => App.currentScreen === 'nueva-venta', { timeout: 10000 });
    await expect(page.locator('#venta-cliente')).toHaveValue('Ana');
  });

  test('el cliente no acumula el total de una venta devuelta', async ({ page }) => {
    const { ventaId } = await ventaContado(page);
    const antes = await page.evaluate(() => App._agregarClientes().find(c => c.nombre === 'Ana').totalComprado);
    expect(antes).toBe(2000);

    await page.evaluate(async (id) => {
      await DB.devolverVenta(id, { motivo: 'Falló', reponerStock: true });
      await App.loadData();
    }, ventaId);

    const despues = await page.evaluate(() => App._agregarClientes().find(c => c.nombre === 'Ana'));
    expect(despues).toBeUndefined();
  });

  test('deshacer devuelve también la deuda pendiente', async ({ page }) => {
    // Lo encontró el fuzzer: la venta volvía a contar para la ganancia pero
    // las cuotas canceladas no se recreaban, así que el cliente quedaba
    // debiendo y la app mostraba 0 por cobrar.
    const ventaId = await page.evaluate(async () => {
      const p = App.perfumes[0];
      const vid = await DB.addVenta({
        perfume: p.nombre, perfumeId: p.id, cantidad: 1,
        precioVenta: 3000, precioCompra: 500, precioUnitario: 3000,
        cliente: 'Ana', vendedor: 'Yo', formaPago: 'cuotas', numCuotas: 3, fecha: Date.now(),
      });
      await App.loadData();
      return vid;
    });

    const deuda = () => page.evaluate(async (id) => {
      const cs = (await DB.getAll('cuotas')).filter(c => c.ventaId === id);
      return { cuotas: cs.length, debe: cs.filter(c => !c.pagado).reduce((s, c) => s + (c.monto - (c.montoPagado || 0)), 0) };
    }, ventaId);

    // Al vender: 3 cuotas de 1000, la primera cobrada -> debe 2000
    expect(await deuda()).toEqual({ cuotas: 3, debe: 2000 });

    await page.evaluate(async (id) => {
      await DB.devolverVenta(id, { motivo: 'Falló', reponerStock: true });
      await App.loadData();
    }, ventaId);
    // Devuelta: se cancela lo impago y queda solo lo cobrado
    expect(await deuda()).toEqual({ cuotas: 1, debe: 0 });

    await page.evaluate(async (id) => {
      await DB.revertirDevolucion(id);
      await App.loadData();
    }, ventaId);
    // Y al deshacer tiene que volver la deuda, no solo la venta
    expect(await deuda()).toEqual({ cuotas: 3, debe: 2000 });
    const v = await page.evaluate((id) => App.ventas.find(x => x.id === id), ventaId);
    expect(v.devuelta).toBeUndefined();
  });
});
