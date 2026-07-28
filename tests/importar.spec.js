// @ts-check
// Importar desde Excel. Los casos que importan son los del mundo real:
// cabeceras con tildes y en otro orden, montos "1.250,50", filas incompletas
// y fechas en dos formatos distintos.
const { test, expect } = require('@playwright/test');
const XLSX = require('xlsx');
const path = require('path');
const os = require('os');
const fs = require('fs');

const APP_URL = 'http://localhost:8787';
const XLSX_LOCAL = path.join(__dirname, '..', 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');

// Planilla como la haría un revendedor, no como nos conviene a nosotros
function crearPlanilla() {
  const perfumes = [
    ['Artículo', 'Precio de Costo', 'PRECIO VENTA', 'Unidades'],
    ['Sauvage Dior 100ml', '1.250,50', '2.400', 5],
    ['Bleu de Chanel', '1.800', '3.500,75', 2],
    ['La Vie Est Belle', '', '2.900', 0],
    ['', '', '', ''],                                  // fila vacía: se ignora
    ['Invictus Paco Rabanne', '1.100', '2.200', 7],
  ];
  const ventas = [
    ['Fecha', 'Producto', 'Cliente', 'Cant', 'Importe', 'Costo'],
    [new Date(2026, 5, 14), 'Sauvage Dior 100ml', 'Ana Pérez', 2, '4.800', '2.501'],
    [new Date(2026, 5, 20), 'Bleu de Chanel', 'Bruno', 1, '3.500,75', '1.800'],
    ['15/07/2026', 'Invictus', 'Caro', '', '2.200', '1.100'],  // fecha como texto
    [new Date(2026, 6, 2), '', 'Sin perfume', 1, '999', ''],   // sin perfume: se omite
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perfumes), 'Mi Stock');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ventas), 'Ventas 2026');
  const ruta = path.join(os.tmpdir(), `pt-planilla-${process.pid}.xlsx`);
  XLSX.writeFile(wb, ruta);
  return ruta;
}

let planilla;
test.beforeAll(() => { planilla = crearPlanilla(); });
test.afterAll(() => { try { fs.unlinkSync(planilla); } catch { /* ya no está */ } });

test.describe('Importar desde Excel', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/*.gstatic.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
    // Se sirve el 0.18.5 de node_modules en vez de ir al CDN: el test no
    // depende de una red externa y el SRI del build coincide con este archivo.
    await page.route('**/xlsx.full.min.js', r => r.fulfill({
      path: XLSX_LOCAL,
      headers: { 'content-type': 'application/javascript' },
    }));
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.evaluate(async () => {
      for (const p of await DB.getAll('perfumes')) await DB.delete('perfumes', p.id);
      for (const v of await DB.getAll('ventas')) await DB.delete('ventas', v.id);
      await App.loadData();
    });
  });

  test('detecta solo las columnas aunque tengan otro nombre y otro orden', async ({ page }) => {
    await page.setInputFiles('#import-excel-input', planilla);
    await page.waitForSelector('#modal-importar:not(.hidden)', { timeout: 20000 });

    const mapeo = await page.evaluate(() => {
      const r = {};
      document.querySelectorAll('#imp-mapeo select').forEach(s => {
        r[s.id.replace('imp-map-', '')] = s.options[s.selectedIndex].text;
      });
      return r;
    });
    expect(mapeo).toEqual({
      nombre: 'Artículo',
      stock: 'Unidades',
      precioCompra: 'Precio de Costo',
      precioVenta: 'PRECIO VENTA',
    });
    // La fila totalmente vacía no cuenta
    await expect(page.locator('#imp-filas')).toHaveText('4 filas · 4 columnas');
  });

  test('importa perfumes entendiendo los montos con formato de acá', async ({ page }) => {
    await page.setInputFiles('#import-excel-input', planilla);
    await page.waitForSelector('#modal-importar:not(.hidden)', { timeout: 20000 });
    await page.click('#imp-confirmar');
    await page.click('#confirm-ok');
    await page.waitForFunction(() => App.perfumes.length === 4, { timeout: 15000 });

    const perf = await page.evaluate(() =>
      App.perfumes.map(p => ({ n: p.nombre, s: p.stock, c: p.precioCompra, v: p.precioVenta })));
    // "1.250,50" son mil doscientos cincuenta con cincuenta, no 1,25
    expect(perf).toContainEqual({ n: 'Sauvage Dior 100ml', s: 5, c: 1250.5, v: 2400 });
    expect(perf).toContainEqual({ n: 'Bleu de Chanel', s: 2, c: 1800, v: 3500.75 });
    // Sin precio de compra: queda en 0, no rompe
    expect(perf).toContainEqual({ n: 'La Vie Est Belle', s: 0, c: 0, v: 2900 });
  });

  test('suma a lo que ya había en vez de reemplazarlo', async ({ page }) => {
    await page.evaluate(async () => {
      await DB.addPerfume({ nombre: 'Ya lo tenía', stock: 3, precioCompra: 100, precioVenta: 200 });
      await App.loadData();
    });
    await page.setInputFiles('#import-excel-input', planilla);
    await page.waitForSelector('#modal-importar:not(.hidden)', { timeout: 20000 });
    await page.click('#imp-confirmar');
    await page.click('#confirm-ok');
    await page.waitForFunction(() => App.perfumes.length === 5, { timeout: 15000 });

    const nombres = await page.evaluate(() => App.perfumes.map(p => p.nombre));
    expect(nombres).toContain('Ya lo tenía');
    expect(nombres).toContain('Sauvage Dior 100ml');
  });

  test('importa ventas de otra hoja, con fecha en Date y en texto', async ({ page }) => {
    await page.setInputFiles('#import-excel-input', planilla);
    await page.waitForSelector('#modal-importar:not(.hidden)', { timeout: 20000 });
    await page.selectOption('#imp-hoja', 'Ventas 2026');
    await page.click('#imp-destino .seg-option[data-destino="ventas"]');
    await page.waitForTimeout(200);

    // La fila sin perfume no tiene los datos obligatorios
    await expect(page.locator('#imp-resumen')).toContainText('1 sin datos obligatorios se omiten');

    await page.click('#imp-confirmar');
    await page.click('#confirm-ok');
    await page.waitForFunction(() => App.ventas.length === 3, { timeout: 15000 });

    const v = await page.evaluate(() => App.ventas.map(x => ({
      p: x.perfume, c: x.cantidad, pv: x.precioVenta, cl: x.cliente,
      f: new Date(x.fecha).toISOString().slice(0, 10),
    })));
    expect(v).toContainEqual({ p: 'Sauvage Dior 100ml', c: 2, pv: 4800, cl: 'Ana Pérez', f: '2026-06-14' });
    // Fecha que venía como texto "15/07/2026", no como Date de Excel
    expect(v).toContainEqual({ p: 'Invictus', c: 1, pv: 2200, cl: 'Caro', f: '2026-07-15' });
  });

  test('las ventas históricas NO descuentan del stock', async ({ page }) => {
    // El stock de la planilla ya refleja esas ventas: descontarlas otra vez
    // dejaría el inventario en menos de lo que hay en la caja
    await page.evaluate(async () => {
      await DB.addPerfume({ nombre: 'Sauvage Dior 100ml', stock: 5, precioCompra: 1250, precioVenta: 2400 });
      await App.loadData();
    });
    await page.setInputFiles('#import-excel-input', planilla);
    await page.waitForSelector('#modal-importar:not(.hidden)', { timeout: 20000 });
    await page.selectOption('#imp-hoja', 'Ventas 2026');
    await page.click('#imp-destino .seg-option[data-destino="ventas"]');
    await page.click('#imp-confirmar');
    await page.click('#confirm-ok');
    await page.waitForFunction(() => App.ventas.length === 3, { timeout: 15000 });

    expect(await page.evaluate(() => App.perfumes[0].stock)).toBe(5);
    expect(await page.evaluate(() => App.ventas.every(v => v.perfumeId === null))).toBe(true);
  });

  test('sin columnas obligatorias no deja importar', async ({ page }) => {
    await page.setInputFiles('#import-excel-input', planilla);
    await page.waitForSelector('#modal-importar:not(.hidden)', { timeout: 20000 });
    // Desasignar el nombre del perfume
    await page.selectOption('#imp-map-nombre', '');
    await expect(page.locator('#imp-confirmar')).toBeDisabled();
    await expect(page.locator('#imp-preview')).toContainText('Ninguna fila tiene los datos obligatorios');
  });
});
