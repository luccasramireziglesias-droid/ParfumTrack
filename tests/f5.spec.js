// @ts-check
// F5 — señas y encargos
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

test.describe('F5 — señas y encargos', () => {
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
      for (const r of await DB.getAll('reservas')) await DB.delete('reservas', r.id);
      for (const v of await DB.getAll('ventas')) await DB.delete('ventas', v.id);
      const p = App.perfumes[0];
      p.stock = 0;
      p.precioCompra = 400;
      p.precioVenta = 1000;
      await DB.put('perfumes', p);
      await App.loadData();
      App.showScreen('reservas');
    });
  });

  const perfumeId = (page) => page.evaluate(() => App.perfumes[0].id);

  test('la base migró a v5 con el store de reservas', async ({ page }) => {
    const info = await page.evaluate(async () => {
      await DB.getAll('reservas');
      return { version: db.version, stores: [...db.objectStoreNames] };
    });
    expect(info.version).toBeGreaterThanOrEqual(5);
    expect(info.stores).toContain('reservas');
  });

  test('se puede encargar un perfume SIN stock y queda en espera', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate(() => App.abrirReserva());
    await expect(page.locator('#modal-reserva')).toBeVisible();
    await page.fill('#reserva-cliente', 'Ana');
    await page.evaluate((pid) => App.elegirPerfumeReserva(pid), id);
    // Elegir del stock trae el precio de venta
    await expect(page.locator('#reserva-precio')).toHaveValue('1000');
    await page.fill('#reserva-cantidad', '2');
    await page.fill('#reserva-sena', '500');
    await expect(page.locator('#reserva-resta')).toContainText('resta $1.500');
    await page.click('#reserva-confirmar');
    await page.waitForFunction(() => App.reservasData.length === 1, { timeout: 10000 });

    const r = await page.evaluate(() => App.reservasData[0]);
    expect(r.estado).toBe('pendiente');
    expect(r.cantidad).toBe(2);
    expect(r.total).toBe(2000);
    expect(r.sena).toBe(500);
    expect(r.perfumeId).toBe(id);

    // El stock NO se toca: la reserva no descuenta inventario
    expect(await page.evaluate(async (pid) => (await DB.get('perfumes', pid)).stock, id)).toBe(0);
    await expect(page.locator('.reserva-tag.esperando')).toContainText('Esperando stock');
    await expect(page.locator('#reservas-count')).toHaveText('1');
    await expect(page.locator('#reservas-senas')).toContainText('500');
  });

  test('la seña no puede superar el total', async ({ page }) => {
    await page.evaluate(() => App.abrirReserva());
    await page.fill('#reserva-cliente', 'Bruno');
    await page.fill('#reserva-perfume-nombre', 'Sauvage');
    await page.fill('#reserva-precio', '1000');
    await page.fill('#reserva-sena', '1500');
    await page.click('#reserva-confirmar');
    await page.waitForTimeout(500);

    await expect(page.locator('#modal-reserva')).toBeVisible();
    expect(await page.evaluate(() => App.reservasData.length)).toBe(0);
  });

  test('cuando llega el stock la tarjeta pasa a "Hay stock"', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate(async (pid) => {
      await DB.addReserva({ cliente: 'Ana', perfume: 'Test', perfumeId: pid, cantidad: 1, precioAcordado: 1000, sena: 300 });
      await App.loadData();
      App.renderReservas();
    }, id);
    await expect(page.locator('.reserva-tag.esperando')).toBeVisible();

    await page.evaluate(async (pid) => {
      await DB.registrarCompra({ perfumeId: pid, cantidad: 5, precioUnitario: 400 });
      await App.loadData();
      App.renderReservas();
    }, id);
    await expect(page.locator('.reserva-tag.listo')).toContainText('Hay stock');
  });

  test('entregar convierte el encargo en venta y descuenta stock', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate(async (pid) => {
      const p = await DB.get('perfumes', pid);
      p.stock = 4;
      await DB.put('perfumes', p);
      await DB.addReserva({ cliente: 'Ana', perfume: 'Encargo Test', perfumeId: pid, cantidad: 2, precioAcordado: 1000, sena: 500 });
      await App.loadData();
    }, id);

    const reservaId = await page.evaluate(() => App.reservasData[0].id);
    const ventaId = await page.evaluate(async (rid) => {
      const p = App.perfumes[0];
      const vid = await DB.entregarReserva(rid, { precioCompra: p.precioCompra || 0 });
      await App.loadData();
      return vid;
    }, reservaId);

    const v = await page.evaluate((vid) => App.ventas.find(x => x.id === vid), ventaId);
    expect(v.precioVenta).toBe(2000);
    expect(v.cantidad).toBe(2);
    expect(v.precioCompra).toBe(800);
    expect(v.cliente).toBe('Ana');
    expect(v.reservaId).toBe(reservaId);
    // La seña queda anotada, no se suma otra vez al precio
    expect(v.nota).toContain('500');

    expect(await page.evaluate(async (pid) => (await DB.get('perfumes', pid)).stock, id)).toBe(2);

    const r = await page.evaluate((rid) => App.reservasData.find(x => x.id === rid), reservaId);
    expect(r.estado).toBe('entregada');
    expect(r.ventaId).toBe(ventaId);

    // No se puede entregar dos veces
    const err = await page.evaluate(async (rid) => {
      try { await DB.entregarReserva(rid, {}); return null; } catch (e) { return e.message; }
    }, reservaId);
    expect(err).toBe('RESERVA_NO_PENDIENTE');
  });

  test('cancelar deja constancia de si la seña se devolvió', async ({ page }) => {
    const id = await perfumeId(page);
    const reservaId = await page.evaluate(async (pid) => {
      const r = await DB.addReserva({ cliente: 'Caro', perfume: 'Test', perfumeId: pid, cantidad: 1, precioAcordado: 1000, sena: 300 });
      await App.loadData();
      return r.id;
    }, id);

    await page.evaluate(async (rid) => {
      await DB.cancelarReserva(rid, { devolverSena: false, motivo: 'No apareció' });
      await App.loadData();
      App.filterReservas('cancelada');
    }, reservaId);

    const r = await page.evaluate((rid) => App.reservasData.find(x => x.id === rid), reservaId);
    expect(r.estado).toBe('cancelada');
    expect(r.senaDevuelta).toBe(false);
    await expect(page.locator('.reserva-tag.cancelado')).toContainText('seña retenida');

    // Cancelar no cuenta como pendiente ni suma su seña
    await expect(page.locator('#reservas-count')).toHaveText('0');
    await expect(page.locator('#reservas-senas')).toHaveText('$0');
  });

  test('los filtros separan pendientes, entregados y cancelados', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate(async (pid) => {
      const p = await DB.get('perfumes', pid);
      p.stock = 5;
      await DB.put('perfumes', p);
      const a = await DB.addReserva({ cliente: 'Pendiente', perfume: 'A', perfumeId: pid, cantidad: 1, precioAcordado: 1000, sena: 0 });
      const b = await DB.addReserva({ cliente: 'Entregado', perfume: 'B', perfumeId: pid, cantidad: 1, precioAcordado: 1000, sena: 0 });
      const c = await DB.addReserva({ cliente: 'Cancelado', perfume: 'C', perfumeId: pid, cantidad: 1, precioAcordado: 1000, sena: 0 });
      await DB.entregarReserva(b.id, {});
      await DB.cancelarReserva(c.id, { devolverSena: true });
      await App.loadData();
      App.renderReservas();
      return a.id;
    }, id);

    await expect(page.locator('.reserva-card')).toHaveCount(1);
    await expect(page.locator('.reserva-cliente')).toHaveText('Pendiente');

    await page.click('#reservas-filter .seg-option[data-estado="entregada"]');
    await expect(page.locator('.reserva-cliente')).toHaveText('Entregado');

    await page.click('#reservas-filter .seg-option[data-estado="cancelada"]');
    await expect(page.locator('.reserva-cliente')).toHaveText('Cancelado');
  });

  test('el mensaje de WhatsApp cambia según haya stock o no', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate(async (pid) => {
      await DB.addReserva({ cliente: 'Ana', perfume: 'Sauvage', perfumeId: pid, cantidad: 1, precioAcordado: 1000, sena: 400 });
      await App.loadData();
      App.renderReservas();
    }, id);

    const sinStock = await page.evaluate(() =>
      App.b64Decode(document.querySelector('#reservas-list .btn-whatsapp').dataset.msg));
    expect(sinStock).toContain('esperando la reposición');

    await page.evaluate(async (pid) => {
      const p = await DB.get('perfumes', pid);
      p.stock = 3;
      await DB.put('perfumes', p);
      await App.loadData();
      App.renderReservas();
    }, id);

    const conStock = await page.evaluate(() =>
      App.b64Decode(document.querySelector('#reservas-list .btn-whatsapp').dataset.msg));
    expect(conStock).toContain('Ya tengo tu');
    expect(conStock).toContain('600'); // resta 1000 - 400
  });

  test('el badge de Más cuenta solo los encargos pendientes', async ({ page }) => {
    const id = await perfumeId(page);
    await page.evaluate(async (pid) => {
      await DB.addReserva({ cliente: 'A', perfume: 'A', perfumeId: pid, cantidad: 1, precioAcordado: 1000, sena: 0 });
      await DB.addReserva({ cliente: 'B', perfume: 'B', perfumeId: pid, cantidad: 1, precioAcordado: 1000, sena: 0 });
      await App.loadData();
      App.showScreen('mas');
      App.updateReservasBadge();
    }, id);
    await expect(page.locator('#mas-reservas-badge')).toHaveText('2');

    await page.evaluate(async () => {
      await DB.cancelarReserva(App.reservasData[0].id, { devolverSena: true });
      await App.loadData();
      App.updateReservasBadge();
    });
    await expect(page.locator('#mas-reservas-badge')).toHaveText('1');
  });
});
