// @ts-check
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

test.describe('F1 — cantidad en la venta', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/*.gstatic.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
    await page.route('**/onesignal.com/**', r => r.abort());
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
      localStorage.removeItem('pt_pin');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
    await page.waitForFunction(() => typeof App !== 'undefined' && App.perfumes && App.perfumes.length > 0, { timeout: 20000 });
    // Dejar que init() termine (migraciones, navegación inicial) antes de tocar la UI
    await page.waitForTimeout(1500);
  });

  test('vender 3 unidades: stock -3, total = unit*3, ganancia y cuotas sobre el total', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // Preparar un perfume con stock conocido
    const perfumeId = await page.evaluate(async () => {
      const p = App.perfumes[0];
      p.stock = 10;
      await DB.put('perfumes', p);
      await App.loadData();
      return p.id;
    });

    const stockAntes = await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId);
    expect(stockAntes).toBe(10);

    // Llenar el form de venta con 3 unidades
    await page.evaluate((id) => {
      App.showScreen('nueva-venta');
      App.resetVentaForm();
      const p = App.perfumes.find(x => x.id === id);
      document.getElementById('venta-perfume-display').textContent = p.nombre;
      document.getElementById('venta-perfume-nombre').value = p.nombre;
      document.getElementById('venta-perfume-id').value = String(id);
      document.getElementById('venta-precio').value = '1000';
      document.getElementById('venta-compra').value = '600';
      document.getElementById('venta-cliente').value = 'Cliente F1';
      App.setFormaPago('contado');
    }, perfumeId);

    // Usar el stepper: +1 dos veces => 3
    await page.click('button[onclick="App.cambiarCantidad(1)"]');
    await page.click('button[onclick="App.cambiarCantidad(1)"]');
    expect(await page.inputValue('#venta-cantidad')).toBe('3');

    // El preview en vivo debe mostrar el total (3000) y la ganancia (1200)
    const preview = await page.evaluate(() => document.getElementById('live-profit')?.textContent || document.querySelector('.live-profit')?.textContent || '');
    console.log('preview:', preview);

    await page.evaluate(() => App.guardarVenta());
    await page.waitForFunction(() => App.ventas.some(v => v.cliente === 'Cliente F1'), { timeout: 10000 });

    const venta = await page.evaluate(() => App.ventas.find(v => v.cliente === 'Cliente F1'));
    expect(venta.cantidad).toBe(3);
    expect(venta.precioVenta).toBe(3000);
    expect(venta.precioCompra).toBe(1800);
    expect(venta.precioUnitario).toBe(1000);
    expect(venta.unidadesDescontadas).toBe(3);

    const stockDespues = await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId);
    expect(stockDespues).toBe(7);

    // La card muestra el badge ×3
    await page.evaluate(() => { App.showScreen('ventas-all'); App.renderAllVentas(); });
    const badge = await page.textContent('#ventas-all-list .venta-cant');
    expect(badge.trim()).toBe('×3');

    // Borrar la venta devuelve exactamente 3 unidades
    await page.evaluate(async (vid) => { await DB.deleteVenta(vid); await App.loadData(); }, venta.id);
    const stockFinal = await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId);
    expect(stockFinal).toBe(10);

    expect(errors.filter(e => !/service|SW|font|Failed to fetch/i.test(e))).toHaveLength(0);
  });

  test('no descuenta más de lo que hay en stock', async ({ page }) => {
    const perfumeId = await page.evaluate(async () => {
      const p = App.perfumes[0];
      p.stock = 2;
      await DB.put('perfumes', p);
      await App.loadData();
      return p.id;
    });

    const venta = await page.evaluate(async (id) => {
      const p = App.perfumes.find(x => x.id === id);
      const vid = await DB.addVenta({
        perfume: p.nombre, perfumeId: id, cantidad: 5,
        precioVenta: 5000, precioCompra: 3000, precioUnitario: 1000,
        cliente: 'Tope stock', vendedor: 'Yo', formaPago: 'contado', numCuotas: 1
      });
      return await DB.get('ventas', vid);
    }, perfumeId);

    expect(venta.unidadesDescontadas).toBe(2);
    const stock = await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId);
    expect(stock).toBe(0);

    await page.evaluate(async (vid) => { await DB.deleteVenta(vid); }, venta.id);
    const stockFinal = await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId);
    expect(stockFinal).toBe(2);
  });

  test('editar la cantidad reconcilia el stock', async ({ page }) => {
    const perfumeId = await page.evaluate(async () => {
      const p = App.perfumes[0];
      p.stock = 10;
      await DB.put('perfumes', p);
      await App.loadData();
      return p.id;
    });

    const ventaId = await page.evaluate(async (id) => {
      const p = App.perfumes.find(x => x.id === id);
      const vid = await DB.addVenta({
        perfume: p.nombre, perfumeId: id, cantidad: 2,
        precioVenta: 2000, precioCompra: 1200, precioUnitario: 1000, precioCompraUnitario: 600,
        cliente: 'Edit F1', vendedor: 'Yo', formaPago: 'contado', numCuotas: 1
      });
      await App.loadData();
      return vid;
    }, perfumeId);

    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(8);

    // Editar: 2 -> 4 unidades
    await page.evaluate((vid) => App.editVenta(vid), ventaId);
    expect(await page.inputValue('#venta-cantidad')).toBe('2');
    expect(await page.inputValue('#venta-precio')).toBe('1000');
    await page.fill('#venta-cantidad', '4');
    await page.evaluate(() => App.updateVenta());
    await page.waitForFunction(() => App.ventas.some(v => v.cliente === 'Edit F1' && v.cantidad === 4), { timeout: 10000 });

    const v = await page.evaluate(() => App.ventas.find(x => x.cliente === 'Edit F1'));
    expect(v.precioVenta).toBe(4000);
    expect(v.unidadesDescontadas).toBe(4);
    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(6);

    // Editar solo el cliente NO debe mover el stock
    await page.evaluate((vid) => App.editVenta(vid), ventaId);
    await page.fill('#venta-cliente', 'Edit F1');
    await page.evaluate(() => App.updateVenta());
    await page.waitForTimeout(500);
    expect(await page.evaluate(async (id) => (await DB.get('perfumes', id)).stock, perfumeId)).toBe(6);
  });

  test('cuotas se calculan sobre el total de las N unidades', async ({ page }) => {
    const perfumeId = await page.evaluate(async () => {
      const p = App.perfumes[0];
      p.stock = 10;
      await DB.put('perfumes', p);
      await App.loadData();
      return p.id;
    });

    await page.evaluate((id) => {
      App.showScreen('nueva-venta');
      App.resetVentaForm();
      const p = App.perfumes.find(x => x.id === id);
      document.getElementById('venta-perfume-display').textContent = p.nombre;
      document.getElementById('venta-perfume-nombre').value = p.nombre;
      document.getElementById('venta-perfume-id').value = String(id);
      document.getElementById('venta-precio').value = '1000';
      document.getElementById('venta-compra').value = '500';
      document.getElementById('venta-cliente').value = 'Cuotas F1';
      document.getElementById('venta-cantidad').value = '3';
      App.setFormaPago('cuotas');
      document.getElementById('venta-num-cuotas').value = '3';
    }, perfumeId);

    await page.evaluate(() => App.guardarVenta());
    await page.waitForFunction(() => App.ventas.some(v => v.cliente === 'Cuotas F1'), { timeout: 10000 });

    const cuotas = await page.evaluate(async () => {
      const v = App.ventas.find(x => x.cliente === 'Cuotas F1');
      const all = await DB.getAll('cuotas');
      return all.filter(c => c.ventaId === v.id).map(c => c.monto);
    });
    expect(cuotas.length).toBe(3);
    expect(cuotas.reduce((a, b) => a + b, 0)).toBe(3000);
  });
});
