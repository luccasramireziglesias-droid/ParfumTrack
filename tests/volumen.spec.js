// @ts-check
// Volumen: cómo se comporta la app con el historial de alguien que la usó
// dos o tres años. Es el escenario que le llega a TODOS los usuarios, solo
// que más adelante, y no estaba medido en ningún lado.
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

const VENTAS = Number(process.env.VOL_VENTAS || 2000);
const PERFUMES = 120;

// Umbrales pensados para que un celular de gama baja (unas 4-6 veces más
// lento que este runner) siga siendo usable.
const LIMITES = {
  arranque: 4000,
  dashboard: 400,
  listaVentas: 400,
  stats: 1200,
  buscar: 300,
  cuotas: 600,
};

async function sembrar(page, ventas, perfumes) {
  return page.evaluate(async ({ ventas, perfumes }) => {
    for (const s of ['ventas', 'cuotas', 'perfumes', 'compras', 'reservas']) {
      for (const r of await DB.getAll(s)) await DB.delete(s, r.id);
    }
    const ids = [];
    for (let i = 0; i < perfumes; i++) {
      ids.push(await DB.add('perfumes', {
        nombre: `Perfume ${i}`, stock: i % 9, precioCompra: 800 + (i % 500),
        precioVenta: 1600 + (i % 900), creado: Date.now(),
      }));
    }
    // Se insertan derecho, sin pasar por addVenta: acá interesa medir la
    // lectura y el render, no el alta
    const ahora = Date.now();
    for (let i = 0; i < ventas; i++) {
      const pid = ids[i % ids.length];
      const enCuotas = i % 4 === 0;
      const precio = 1600 + (i % 2000);
      const vid = await DB.add('ventas', {
        perfume: `Perfume ${i % perfumes}`, perfumeId: pid, cantidad: 1 + (i % 3),
        precioVenta: precio, precioCompra: Math.round(precio * 0.55),
        cliente: `Cliente ${i % 180}`, vendedor: 'V', proveedor: 'P', descuento: 0,
        formaPago: enCuotas ? 'cuotas' : 'contado', numCuotas: enCuotas ? 3 : 1,
        // Repartidas en ~3 años
        fecha: ahora - Math.floor(i * (1000 * 60 * 60 * 24 * 3 * 365) / ventas),
        stockDescontado: true, unidadesDescontadas: 1,
      });
      if (enCuotas) {
        for (let c = 1; c <= 3; c++) {
          await DB.add('cuotas', {
            ventaId: vid, perfume: `Perfume ${i % perfumes}`, cliente: `Cliente ${i % 180}`,
            numero: c, total: 3, monto: Math.round(precio / 3), montoTotal: precio,
            pagado: c === 1, montoPagado: c === 1 ? Math.round(precio / 3) : 0,
            vence: ahora + c * 2592000000 - i * 1000,
          });
        }
      }
    }
    return { ventas: (await DB.getAll('ventas')).length, cuotas: (await DB.getAll('cuotas')).length };
  }, { ventas, perfumes });
}

test.describe('Volumen', () => {
  test(`la app sigue usable con ${VENTAS} ventas`, async ({ page }) => {
    test.setTimeout(600000);
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
    await page.waitForTimeout(1200);

    const sembrado = await sembrar(page, VENTAS, PERFUMES);
    console.log(`\nsembrado: ${sembrado.ventas} ventas, ${sembrado.cuotas} cuotas, ${PERFUMES} perfumes`);

    // Arranque en frío, con toda esa base ya cargada
    const t0 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    // El splash se saca del DOM en el finally de init(): esperar por
    // App.ventas cargaría antes de que las cuotas estén, y la medición
    // quedaría corta
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 });
    const arranque = Date.now() - t0;

    const medir = async (nombre, fn) => {
      const ms = await page.evaluate(async (f) => {
        const t = performance.now();
        // eslint-disable-next-line no-eval
        await eval(f);
        await new Promise(r => requestAnimationFrame(() => r()));
        return Math.round(performance.now() - t);
      }, fn);
      return { nombre, ms };
    };

    const medidas = [
      await medir('dashboard', 'App.showScreen("inicio"); App.renderDashboard()'),
      await medir('listaVentas', 'App.showScreen("ventas-all"); App.renderAllVentas()'),
      await medir('stats', 'App.showScreen("stats"); App.renderStats()'),
      await medir('cuotas', 'App.showScreen("cuotas"); App.renderCuotas()'),
      await medir('stock', 'App.showScreen("stock"); App.renderStock()'),
      await medir('clientes', 'App.showScreen("clientes"); App.renderClientes()'),
      await medir('buscar', 'App.showScreen("ventas-all"); document.getElementById("ventas-search") && (document.getElementById("ventas-search").value = "Perfume 7"); App.renderAllVentas()'),
    ];

    console.log(`arranque en frío: ${arranque} ms`);
    medidas.forEach(m => console.log(`  ${m.nombre.padEnd(12)}: ${m.ms} ms`));

    // Cuántos nodos quedan en la lista: si vuelca las 2000 de una, el
    // paginado no está funcionando
    const nodos = await page.evaluate(() => {
      App.showScreen('ventas-all'); App.renderAllVentas();
      return {
        cards: document.querySelectorAll('#ventas-all-list .venta-card').length,
        totalDOM: document.querySelectorAll('#app *').length,
      };
    });
    console.log(`  cards en la lista: ${nodos.cards} (de ${sembrado.ventas}) · nodos en el DOM: ${nodos.totalDOM}`);

    const lentas = medidas.filter(m => LIMITES[m.nombre] && m.ms > LIMITES[m.nombre]);
    if (lentas.length) {
      console.log('\n=== POR ENCIMA DEL LÍMITE ===');
      lentas.forEach(m => console.log(`  ✗ ${m.nombre}: ${m.ms} ms (límite ${LIMITES[m.nombre]})`));
    }

    expect(errores.filter(e => !/service|SW|font|Failed to fetch/i.test(e))).toEqual([]);
    expect(arranque, 'arranque en frío').toBeLessThan(LIMITES.arranque);
    expect(nodos.cards, 'la lista no pagina').toBeLessThanOrEqual(60);
    expect(lentas.map(m => `${m.nombre}=${m.ms}ms`)).toEqual([]);
  });

  test(`con la licencia puesta y ${VENTAS} ventas, el arranque sigue siendo tolerable`, async ({ page }) => {
    // El caso que más puede doler: con licencia, CADA registro se descifra
    // por separado con AES-GCM. Son miles de operaciones en el arranque.
    test.setTimeout(600000);
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
      localStorage.setItem('pt_license_code', 'PT-VOLUMEN-TEST0001');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 30000 });
    await page.waitForTimeout(2000);

    const sembrado = await sembrar(page, VENTAS, PERFUMES);
    console.log(`\ncifrado: ${sembrado.ventas} ventas, ${sembrado.cuotas} cuotas`);

    const t0 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 120000 });
    const arranque = Date.now() - t0;

    const render = await page.evaluate(async () => {
      const t = performance.now();
      App.showScreen('inicio'); App.renderDashboard();
      App.showScreen('ventas-all'); App.renderAllVentas();
      await new Promise(r => requestAnimationFrame(() => r()));
      return Math.round(performance.now() - t);
    });
    // Que los datos hayan vuelto bien, no solo rápido
    const ok = await page.evaluate(() => {
      const v = App.ventas[0];
      return !!(v && v.perfume && v.precioVenta > 0 && App.cuotasData.length > 0);
    });

    console.log(`arranque cifrado : ${arranque} ms`);
    console.log(`render tras cargar: ${render} ms`);
    console.log(`datos íntegros    : ${ok}`);

    expect(ok, 'los datos no volvieron bien').toBe(true);
    expect(errores.filter(e => !/service|SW|font|Failed to fetch/i.test(e))).toEqual([]);
    // Más laxo que sin cifrar, pero tiene que seguir siendo una app usable
    expect(arranque, 'arranque con todo cifrado').toBeLessThan(20000);
  });

  test('la pantalla de cuotas pagina como la de ventas', async ({ page }) => {
    test.setTimeout(300000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
    await page.waitForTimeout(1200);
    await sembrar(page, 400, 20);   // 100 ventas en cuotas
    // sembrar escribe en la base; hay que traerlo a memoria
    await page.evaluate(async () => {
      await App.loadData();
      App.showScreen('cuotas');
      App.renderCuotas();
    });

    // Volcar las 100 tarjetas de una congelaba la pantalla
    const primeras = await page.locator('#cuotas-list .cuota-card').count();
    expect(primeras).toBe(30);
    await expect(page.locator('#cuotas-list .btn-ver-mas')).toContainText('70 cobros más');

    await page.click('#cuotas-list .btn-ver-mas');
    expect(await page.locator('#cuotas-list .cuota-card').count()).toBe(60);

    // El total adeudado es de TODAS, no solo de las visibles
    const total = await page.evaluate(() => ({
      enPantalla: document.getElementById('cuotas-total').textContent,
      real: App.cuotasData.filter(c => !c.pagado).reduce((s, c) => s + (c.monto - (c.montoPagado || 0)), 0),
    }));
    console.log('total en pantalla:', total.enPantalla, '| real:', total.real);
    expect(total.enPantalla.replace(/[^\d]/g, '')).toBe(String(Math.round(total.real)));

    // Y al volver a entrar arranca de nuevo en 30, no acumulado
    await page.evaluate(() => { App.showScreen('inicio'); App.showScreen('cuotas'); });
    expect(await page.locator('#cuotas-list .cuota-card').count()).toBe(30);
  });
});
