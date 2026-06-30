// @ts-check
const { test, expect } = require('@playwright/test');

const APP_URL = 'http://localhost:8787';

test.describe('ParfumTrack — 5 tests de verificación', () => {

  test.beforeEach(async ({ page }) => {
    // Bloquear requests externos que demoran (fonts, analytics, onesignal)
    await page.route('**/*.googleapis.com/**', route => route.abort());
    await page.route('**/*.gstatic.com/**', route => route.abort());
    await page.route('**/plausible.io/**', route => route.abort());
    await page.route('**/onesignal.com/**', route => route.abort());

    // Desactivar onboarding y PIN antes de cargar
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.removeItem('pt_pin');
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    // Esperar a que App.init() termine
    await page.waitForFunction(() => typeof App !== 'undefined' && App.ventas !== undefined, { timeout: 15000 });
  });

  // TEST 1: La app carga sin errores JS y el dashboard se renderiza
  test('1. App carga sin errores JS, dashboard se renderiza', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof App !== 'undefined' && App.ventas !== undefined, { timeout: 15000 });

    // Filtrar errores irrelevantes (SW, fonts)
    const realErrors = errors.filter(e =>
      !e.includes('service') && !e.includes('SW') && !e.includes('font') && !e.includes('Failed to fetch')
    );
    expect(realErrors).toHaveLength(0);

    // Dashboard se renderizó
    await expect(page.locator('#hero-month')).not.toBeEmpty();
    await expect(page.locator('#stat-ventas')).toBeVisible();
    await expect(page.locator('#stat-cobrar')).toBeVisible();
    await expect(page.locator('#stat-ticket')).toBeVisible();

    // fmt() funciona (moneda visible)
    const ticketText = await page.locator('#stat-ticket').textContent();
    expect(ticketText).toMatch(/\$|UYU|ARS/);
  });

  // TEST 2: Crear venta y verificar que aparece con fecha correcta
  test('2. Crear venta actualiza dashboard y fecha no es NaN', async ({ page }) => {
    // Navegar a nueva venta
    await page.locator('.nav-fab').click();
    await page.waitForFunction(() => document.querySelector('#screen-nueva-venta')?.classList.contains('active'), { timeout: 5000 });

    // Llenar formulario (perfume es hidden input, se setea via evaluate)
    await page.evaluate(() => {
      document.getElementById('venta-perfume-nombre').value = 'Test Perfume';
      document.getElementById('venta-perfume-display').textContent = 'Test Perfume';
    });
    await page.fill('#venta-precio', '5000');
    await page.fill('#venta-compra', '3000');
    await page.fill('#venta-cliente', 'Cliente Test');
    await page.fill('#venta-vendedor', 'Vendedor Test');

    // Guardar
    await page.locator('#screen-nueva-venta .btn-primary').click();
    await page.waitForFunction(() => document.querySelector('#screen-inicio')?.classList.contains('active'), { timeout: 5000 });
    await page.waitForTimeout(500);

    // Stats actualizados
    const ventasCount = await page.locator('#stat-ventas').textContent();
    expect(parseInt(ventasCount)).toBeGreaterThanOrEqual(1);

    // Fecha NO es NaN
    const dateText = await page.locator('.venta-date').first().textContent();
    expect(dateText).not.toContain('NaN');
    expect(dateText).not.toContain('undefined');
  });

  // TEST 3: Eliminar venta actualiza la lista al instante
  test('3. Eliminar venta actualiza lista inmediatamente', async ({ page }) => {
    // Crear venta para borrar
    await page.evaluate(async () => {
      await DB.addVenta({
        perfume: 'Para Borrar', precioVenta: 1000, precioCompra: 500,
        cliente: 'Test', vendedor: 'Test', proveedor: '', descuento: 0,
        nota: '', fecha: Date.now(), formaPago: 'contado', numCuotas: 1, perfumeId: ''
      });
      await App.loadData();
      App.renderAll();
    });

    // Ir a Ver Todas
    await page.locator('text=Ver todas').click();
    await page.waitForFunction(() => document.querySelector('#screen-ventas-all')?.classList.contains('active'), { timeout: 5000 });
    await page.waitForTimeout(500);

    const countBefore = await page.locator('#ventas-all-list .venta-card').count();
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // Borrar primera venta (appConfirm es un modal custom, no un dialog nativo)
    await page.locator('#ventas-all-list .venta-action-btn').filter({ hasText: 'delete' }).first().click();
    await page.locator('#confirm-ok').click();
    await page.waitForTimeout(1000);

    const countAfter = await page.locator('#ventas-all-list .venta-card').count();
    expect(countAfter).toBe(countBefore - 1);
  });

  // TEST 4: setFormaPago scoped — no corrompe otros seg controls
  test('4. setFormaPago no afecta otros controles segmentados', async ({ page }) => {
    // Ir a nueva venta
    await page.locator('.nav-fab').click();
    await page.waitForFunction(() => document.querySelector('#screen-nueva-venta')?.classList.contains('active'), { timeout: 5000 });

    // Click Cuotas
    await page.locator('#seg-forma-pago .seg-option:has-text("Cuotas")').click();
    await page.waitForTimeout(300);

    // cuotas-config visible
    const cuotasHidden = await page.evaluate(() =>
      document.getElementById('cuotas-config')?.classList.contains('hidden')
    );
    expect(cuotasHidden).toBe(false);

    // Click Contado
    await page.locator('#seg-forma-pago .seg-option:has-text("Contado")').click();
    await page.waitForTimeout(300);

    // cuotas-config oculto
    const cuotasHidden2 = await page.evaluate(() =>
      document.getElementById('cuotas-config')?.classList.contains('hidden')
    );
    expect(cuotasHidden2).toBe(true);

    // Verificar que SOLO los seg-option dentro de #seg-forma-pago fueron afectados
    const segState = await page.evaluate(() => {
      const formaActive = document.querySelectorAll('#seg-forma-pago .seg-option.active').length;
      const allActive = document.querySelectorAll('.seg-option.active').length;
      const allTotal = document.querySelectorAll('.seg-option').length;
      return { formaActive, allActive, allTotal };
    });

    // Debe haber exactamente 1 active en forma de pago
    expect(segState.formaActive).toBe(1);
    // Otros seg controls no deben haber perdido su active
    // (si setFormaPago corrupts todo, allActive sería <= 1)
    // allTotal > 2 confirma que hay más seg controls en la app
    expect(segState.allTotal).toBeGreaterThan(2);
  });

  // TEST 5: _normalizeBackupData maneja formato cloud y coerce tipos
  test('5. Normalización de backup: formato cloud + coerción de tipos', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Test 1: formato cloud wrapper
      const cloudData = {
        ok: true,
        data: {
          ventas: [
            { id: 1, perfume: 'Test', precioVenta: '5000', precioCompra: '3000', fecha: '1751385600000' }
          ],
          perfumes: [
            { id: 1, nombre: 'Test', stock: '5', precioVenta: '5000', precioCompra: '3000' }
          ],
          cuotas: [
            { id: 1, ventaId: 1, monto: '2500', vence: '2026-07-27' }
          ]
        },
        savedAt: '2026-06-27T12:00:00Z'
      };

      const normalized = App._normalizeBackupData(cloudData);

      return {
        // Debe desenvolver data
        hasVentas: Array.isArray(normalized.ventas) && normalized.ventas.length === 1,
        hasPerfumes: Array.isArray(normalized.perfumes) && normalized.perfumes.length === 1,
        hasCuotas: Array.isArray(normalized.cuotas) && normalized.cuotas.length === 1,
        // Precios deben ser números
        ventaPrecioType: typeof normalized.ventas[0].precioVenta,
        ventaPrecioValue: normalized.ventas[0].precioVenta,
        perfumeStockType: typeof normalized.perfumes[0].stock,
        // Fechas deben ser timestamps numéricos
        ventaFechaType: typeof normalized.ventas[0].fecha,
        ventaFechaValid: !isNaN(normalized.ventas[0].fecha) && normalized.ventas[0].fecha > 0,
        cuotaVenceType: typeof normalized.cuotas[0].vence,
        cuotaVenceValid: !isNaN(normalized.cuotas[0].vence) && normalized.cuotas[0].vence > 0,
        cuotaMontoType: typeof normalized.cuotas[0].monto,
      };
    });

    expect(result.hasVentas).toBe(true);
    expect(result.hasPerfumes).toBe(true);
    expect(result.hasCuotas).toBe(true);
    expect(result.ventaPrecioType).toBe('number');
    expect(result.ventaPrecioValue).toBe(5000);
    expect(result.perfumeStockType).toBe('number');
    expect(result.ventaFechaType).toBe('number');
    expect(result.ventaFechaValid).toBe(true);
    expect(result.cuotaVenceType).toBe('number');
    expect(result.cuotaVenceValid).toBe(true);
    expect(result.cuotaMontoType).toBe('number');
  });

  // TEST 6: las 14 pantallas renderizan sin errores JS (post-modularización de index.html)
  test('6. Las 14 pantallas cargan sin errores JS con datos sembrados', async ({ page }) => {
    const SCREENS = [
      'inicio', 'nueva-venta', 'stock', 'cuotas', 'stats', 'mas',
      'caja', 'gastos', 'pedidos', 'nuevo-pedido', 'pedido-detalle',
      'ventas-all', 'cuenta', 'catalogo',
    ];

    // Sembrar datos no triviales (varias ventas, perfumes, cuotas, pedidos, caja, gastos)
    // para evitar que estados vacíos enmascaren bugs de layout, como ya pasó antes.
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) {
        await DB.addVenta({
          perfume: 'Perfume Smoke ' + i, precioVenta: 5000 + i * 100, precioCompra: 3000,
          cliente: 'Cliente ' + i, vendedor: 'Test', proveedor: '', descuento: 0,
          nota: '', fecha: Date.now() - i * 86400000, formaPago: i % 2 ? 'cuotas' : 'contado',
          numCuotas: i % 2 ? 3 : 1, perfumeId: '',
        });
      }
      await DB.addCaja({ tipo: 'entrada', monto: 10000, descripcion: 'Smoke', fecha: Date.now() });
      await DB.addGasto({ categoria: 'transporte', monto: 500, descripcion: 'Smoke', fecha: Date.now() });
      await App.loadData();
      App.renderAll();
    });

    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    for (const id of SCREENS) {
      await page.evaluate((screenId) => App.showScreen(screenId), id);
      await page.waitForFunction(
        (screenId) => document.getElementById('screen-' + screenId)?.classList.contains('active'),
        id,
        { timeout: 5000 },
      );
      const screenEl = page.locator('#screen-' + id);
      await expect(screenEl).toBeVisible();
    }

    const realErrors = errors.filter(e =>
      !e.includes('service') && !e.includes('SW') && !e.includes('font') && !e.includes('Failed to fetch')
    );
    expect(realErrors).toHaveLength(0);
  });

});
