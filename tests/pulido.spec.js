// @ts-check
// Tres arreglos chicos con impacto diario:
//   · los montos no muestran 3 decimales
//   · avisar antes de crear un perfume que ya existe
//   · avisar antes de importar dos veces la misma planilla
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

test.beforeEach(async ({ page }) => {
  await page.route('**/*.googleapis.com/**', r => r.abort());
  await page.route('**/*.gstatic.com/**', r => r.abort());
  await page.route('**/plausible.io/**', r => r.abort());
  await page.addInitScript(() => {
    localStorage.setItem('pt_onboarded', '1');
    localStorage.setItem('pt_consent_accepted', '1');
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
  await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });
});

test.describe('Formato de montos', () => {
  test('nunca muestra 3 decimales', async ({ page }) => {
    // toLocaleString sin opciones llegaba hasta 3: "$1.234,567" en una app
    // de plata se lee como un error
    const casos = await page.evaluate(() => ({
      tresDecimales: App.fmt(1234.567),
      unDecimal: App.fmt(1234.5),
      entero: App.fmt(1234),
      redondeoArriba: App.fmt(0.999),
      negativo: App.fmt(-1234.567),
      firmado: App.fmtSigned(-1234.567),
      cero: App.fmt(0),
      nulo: App.fmt(null),
    }));
    console.log(JSON.stringify(casos, null, 2));

    expect(casos.tresDecimales).toBe('$1.234,57');
    expect(casos.unDecimal).toBe('$1.234,5');
    expect(casos.entero, 'los enteros no llevan coma').toBe('$1.234');
    expect(casos.redondeoArriba).toBe('$1');
    expect(casos.negativo).toBe('-$1.234,57');
    expect(casos.firmado).toBe('-$1.234,57');
    expect(casos.cero).toBe('$0');
    expect(casos.nulo).toBe('$0');

    // La regla, en general: ningún monto con más de 2 decimales
    const conTres = await page.evaluate(() => {
      const malos = [];
      for (const n of [1.234, 99.999, 12345.6789, 0.005, 7.007]) {
        const s = App.fmt(n);
        const dec = (s.split(',')[1] || '').length;
        if (dec > 2) malos.push(`${n} → ${s}`);
      }
      return malos;
    });
    expect(conTres).toEqual([]);
  });

  test('la ganancia del dashboard no queda con cola de decimales', async ({ page }) => {
    await page.evaluate(async () => {
      for (const v of await DB.getAll('ventas')) await DB.delete('ventas', v.id);
      await DB.addVenta({
        perfume: 'Decimal', perfumeId: '', cantidad: 3,
        precioVenta: 1000, precioCompra: 333.333, precioUnitario: 333.33,
        cliente: 'Ana', vendedor: 'Yo', formaPago: 'contado', numCuotas: 1, fecha: Date.now(),
      });
      await App.loadData();
      App.showScreen('inicio');
      App.renderDashboard();
    });
    const ganancia = await page.textContent('#hero-ganancia');
    console.log('ganancia:', ganancia);
    expect((ganancia.split(',')[1] || '').replace(/\D/g, '').length).toBeLessThanOrEqual(2);
  });
});

test.describe('Perfume duplicado', () => {
  const abrirAlta = async (page, nombre) => page.evaluate((nombre) => {
    App.showScreen('stock');
    App.openAddPerfume();
    document.getElementById('add-perfume-nombre').value = nombre;
    document.getElementById('add-perfume-venta').value = '2500';
    document.getElementById('add-perfume-stock').value = '5';
  }, nombre);

  test('avisa si ya existe uno con el mismo nombre y ofrece editarlo', async ({ page }) => {
    await page.evaluate(async () => {
      for (const p of await DB.getAll('perfumes')) await DB.delete('perfumes', p.id);
      await DB.addPerfume({ nombre: 'Yara Rosa', stock: 7, precioCompra: 1700, precioVenta: 2500 });
      await App.loadData();
    });

    await abrirAlta(page, 'Yara Rosa');
    await page.click('#add-perfume-save-btn');

    await page.waitForSelector('#modal-confirm:not(.hidden)', { timeout: 5000 });
    await expect(page.locator('#modal-confirm')).toContainText('Yara Rosa');
    await expect(page.locator('#modal-confirm')).toContainText('7 en stock');

    // Cancelar abre el existente para editarlo, en vez de dejar al usuario
    // sin saber qué hacer
    await page.click('#confirm-cancel');
    await expect(page.locator('#add-perfume-title')).toHaveText('Editar perfume');
    await expect(page.locator('#add-perfume-nombre')).toHaveValue('Yara Rosa');
    expect(await page.evaluate(() => App.perfumes.length), 'no se creó el duplicado').toBe(1);
  });

  test('detecta el duplicado aunque cambien mayúsculas, tildes y espacios', async ({ page }) => {
    await page.evaluate(async () => {
      for (const p of await DB.getAll('perfumes')) await DB.delete('perfumes', p.id);
      await DB.addPerfume({ nombre: 'Yará Rosa', stock: 2, precioCompra: 1, precioVenta: 2 });
      await App.loadData();
    });
    await abrirAlta(page, '  YARA   ROSA ');
    await page.click('#add-perfume-save-btn');
    await page.waitForSelector('#modal-confirm:not(.hidden)', { timeout: 5000 });
    await page.click('#confirm-cancel');
    expect(await page.evaluate(() => App.perfumes.length)).toBe(1);
  });

  test('si el usuario insiste, lo crea igual', async ({ page }) => {
    // Puede ser a propósito: mismo nombre, distinto tamaño o proveedor
    await page.evaluate(async () => {
      for (const p of await DB.getAll('perfumes')) await DB.delete('perfumes', p.id);
      await DB.addPerfume({ nombre: 'Asad', stock: 1, precioCompra: 1, precioVenta: 2 });
      await App.loadData();
    });
    await abrirAlta(page, 'Asad');
    await page.click('#add-perfume-save-btn');
    await page.waitForSelector('#modal-confirm:not(.hidden)', { timeout: 5000 });
    await page.click('#confirm-ok');
    await page.waitForFunction(() => App.perfumes.length === 2, { timeout: 10000 });
  });

  test('un nombre distinto no dispara ningún aviso', async ({ page }) => {
    await page.evaluate(async () => {
      for (const p of await DB.getAll('perfumes')) await DB.delete('perfumes', p.id);
      await DB.addPerfume({ nombre: 'Asad', stock: 1, precioCompra: 1, precioVenta: 2 });
      await App.loadData();
    });
    await abrirAlta(page, 'Bharara King');
    await page.click('#add-perfume-save-btn');
    await page.waitForFunction(() => App.perfumes.length === 2, { timeout: 10000 });
    await expect(page.locator('#modal-confirm')).toBeHidden();
  });
});

test.describe('Importar dos veces la misma planilla', () => {
  test('_impYaImportados reconoce las filas que ya están cargadas', async ({ page }) => {
    const r = await page.evaluate(async () => {
      for (const v of await DB.getAll('ventas')) await DB.delete('ventas', v.id);
      const fecha = new Date(2026, 5, 15, 10, 30).getTime();
      await DB.addVenta({
        perfume: 'Yara Rosa', perfumeId: null, cantidad: 1,
        precioVenta: 2500, precioCompra: 0, cliente: 'Susana',
        vendedor: 'Yo', formaPago: 'contado', numCuotas: 1, fecha,
      });
      await App.loadData();

      const filas = [
        // misma venta, otra hora del mismo día → repetida
        { perfume: 'Yara Rosa', cliente: 'Susana', precioVenta: 2500, fecha: new Date(2026, 5, 15, 18, 0).getTime() },
        // mismo día y monto, otro cliente → nueva
        { perfume: 'Yara Rosa', cliente: 'Pedro', precioVenta: 2500, fecha: new Date(2026, 5, 15).getTime() },
        // mismo cliente y monto, otro día → nueva
        { perfume: 'Yara Rosa', cliente: 'Susana', precioVenta: 2500, fecha: new Date(2026, 5, 16).getTime() },
        // tildes y mayúsculas distintas → repetida igual
        { perfume: 'YARÁ ROSA', cliente: '  susana ', precioVenta: 2500, fecha: new Date(2026, 5, 15).getTime() },
      ];
      const repes = App._impYaImportados(filas, 'ventas');
      return { total: filas.length, repetidas: repes.length, cuales: repes.map(f => f.cliente) };
    });
    console.log(JSON.stringify(r));
    expect(r.repetidas).toBe(2);
    expect(r.cuales).toEqual(['Susana', '  susana ']);
  });

  test('para perfumes compara por nombre normalizado', async ({ page }) => {
    const r = await page.evaluate(async () => {
      for (const p of await DB.getAll('perfumes')) await DB.delete('perfumes', p.id);
      await DB.addPerfume({ nombre: 'Lattafa Pride', stock: 1, precioCompra: 1, precioVenta: 2 });
      await App.loadData();
      const filas = [
        { nombre: 'lattafa  pride' },   // repetida
        { nombre: 'Afnan 9PM' },        // nueva
      ];
      return App._impYaImportados(filas, 'perfumes').map(f => f.nombre);
    });
    expect(r).toEqual(['lattafa  pride']);
  });
});
