// @ts-check
// Sondas sobre las zonas de mayor riesgo que el fuzzer de operaciones no
// toca: el viaje de ida y vuelta del backup, los textos hostiles, los
// montos del borde, la app con la encriptación activa y la migración de
// una base vieja. Todas son formas de perder o ensuciar datos en silencio.
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

const abrir = async (page) => {
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
};

test.describe('Zonas sin cubrir', () => {
  test('el backup vuelve exactamente igual (ida y vuelta)', async ({ page }) => {
    test.setTimeout(120000);
    await abrir(page);

    const r = await page.evaluate(async () => {
      for (const s of ['ventas', 'cuotas', 'perfumes', 'compras', 'reservas', 'gastos', 'caja', 'pedidos']) {
        for (const x of await DB.getAll(s)) await DB.delete(s, x.id);
      }
      // Un poco de todo, incluida la parte que casi nunca se prueba
      const pid = await DB.addPerfume({ nombre: 'Sauvage', stock: 7, precioCompra: 1250.5, precioVenta: 2400 });
      await DB.addVenta({
        perfume: 'Sauvage', perfumeId: pid, cantidad: 3, precioVenta: 7200, precioCompra: 3751.5,
        cliente: 'Ana', vendedor: 'Yo', formaPago: 'cuotas', numCuotas: 3, fecha: Date.now(),
      });
      await DB.registrarCompra({ perfumeId: pid, cantidad: 5, precioUnitario: 1300, proveedor: 'Sur' });
      await DB.addReserva({ cliente: 'Bruno', perfume: 'Bleu', perfumeId: null, cantidad: 2, precioAcordado: 1500, sena: 700 });
      await DB.addGasto({ categoria: 'transporte', monto: 850.25, desc: 'Envíos', fecha: Date.now() });
      await DB.addCaja({ tipo: 'entrada', monto: 5000, desc: 'Apertura', fecha: Date.now() });
      await App.loadData();

      const foto = async () => {
        const out = {};
        for (const s of ['ventas', 'cuotas', 'perfumes', 'compras', 'reservas', 'gastos', 'caja']) {
          out[s] = (await DB.getAll(s)).sort((a, b) => a.id - b.id);
        }
        return out;
      };
      const antes = await foto();

      // Exportar tal cual lo hace el botón
      const config = await DB.getAll('config');
      const backup = {
        perfumes: App.perfumes, ventas: App.ventas, cuotas: App.cuotasData,
        pedidos: App.pedidosData, caja: App.cajaData, gastos: App.gastosData,
        compras: App.comprasData, reservas: App.reservasData, config,
      };
      const json = JSON.parse(JSON.stringify(backup));   // como pasa por el archivo

      await App._restoreData(App._normalizeBackupData(json));
      await App.loadData();
      const despues = await foto();

      const perdidos = [];
      for (const s of Object.keys(antes)) {
        if (antes[s].length !== despues[s].length) {
          perdidos.push(`${s}: eran ${antes[s].length} y quedaron ${despues[s].length}`);
          continue;
        }
        for (let i = 0; i < antes[s].length; i++) {
          const a = antes[s][i], b = despues[s][i];
          for (const k of Object.keys(a)) {
            if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
              perdidos.push(`${s}[${i}].${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`);
            }
          }
        }
      }
      return { perdidos, conteos: Object.fromEntries(Object.entries(antes).map(([k, v]) => [k, v.length])) };
    });

    console.log('registros en el backup:', JSON.stringify(r.conteos));
    if (r.perdidos.length) {
      console.log('\n=== DIFERENCIAS TRAS RESTAURAR ===');
      r.perdidos.slice(0, 20).forEach(p => console.log('  ✗', p));
    }
    expect(r.perdidos).toEqual([]);
  });

  test('los nombres hostiles no rompen ni inyectan HTML', async ({ page }) => {
    test.setTimeout(120000);
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await abrir(page);

    const r = await page.evaluate(async () => {
      const HOSTILES = [
        '<script>window.__hackeado = 1;</script>',
        '<img src=x onerror="window.__hackeado=2">',
        '"><b>rompe</b>',
        "Ana O'Brien",
        'Perfume "Especial" & Co',
        '🍶 Emoji Parfum 💎',
        'ÑÁÉÍÓÚ àèìòù',
        'A'.repeat(300),
        '../../etc/passwd',
        '{{constructor}}',
      ];
      for (const s of ['ventas', 'cuotas', 'perfumes']) {
        for (const x of await DB.getAll(s)) await DB.delete(s, x.id);
      }
      for (const n of HOSTILES) {
        const pid = await DB.addPerfume({ nombre: n, stock: 2, precioCompra: 100, precioVenta: 200 });
        await DB.addVenta({
          perfume: n, perfumeId: pid, cantidad: 1, precioVenta: 200, precioCompra: 100,
          cliente: n, vendedor: n, formaPago: 'contado', numCuotas: 1, fecha: Date.now(),
        });
      }
      await App.loadData();

      // Pasar por todas las pantallas que pintan esos textos
      const pantallas = ['inicio', 'stock', 'ventas-all', 'clientes', 'cuotas', 'stats', 'reservas'];
      for (const p of pantallas) { App.showScreen(p); }
      App.renderAll();
      await new Promise(r => setTimeout(r, 300));

      return {
        inyectado: window.__hackeado || null,
        // Si el escape falla, el nombre aparece como etiqueta real
        scriptsInyectados: document.querySelectorAll('#app script').length,
        imgsInyectadas: [...document.querySelectorAll('#app img')].filter(i => i.getAttribute('src') === 'x').length,
        perfumes: App.perfumes.length,
      };
    });

    console.log('perfumes con nombre hostil:', r.perfumes);
    console.log('código inyectado:', r.inyectado, '| scripts:', r.scriptsInyectados, '| imgs:', r.imgsInyectadas);
    expect(r.inyectado, 'se ejecutó código del nombre').toBe(null);
    expect(r.scriptsInyectados, 'se inyectó un <script>').toBe(0);
    expect(r.imgsInyectadas, 'se inyectó un <img onerror>').toBe(0);
    expect(errores.filter(e => !/service|SW|font|Failed to fetch/i.test(e))).toEqual([]);
  });

  test('los montos del borde no ensucian los totales', async ({ page }) => {
    test.setTimeout(120000);
    await abrir(page);

    const r = await page.evaluate(async () => {
      for (const s of ['ventas', 'cuotas', 'perfumes']) {
        for (const x of await DB.getAll(s)) await DB.delete(s, x.id);
      }
      const casos = [
        { nombre: 'cero', precioVenta: 0, precioCompra: 0 },
        { nombre: 'decimales', precioVenta: 0.1 + 0.2, precioCompra: 0.3 },
        { nombre: 'gigante', precioVenta: 999999999, precioCompra: 1 },
        { nombre: 'negativo', precioVenta: -500, precioCompra: 100 },
        { nombre: 'muy chico', precioVenta: 0.001, precioCompra: 0 },
      ];
      const pid = await DB.addPerfume({ nombre: 'X', stock: 50, precioCompra: 1, precioVenta: 1 });
      for (const c of casos) {
        await DB.addVenta({
          perfume: c.nombre, perfumeId: pid, cantidad: 1,
          precioVenta: c.precioVenta, precioCompra: c.precioCompra,
          cliente: 'C', vendedor: 'V', formaPago: 'contado', numCuotas: 1, fecha: Date.now(),
        });
      }
      await App.loadData();
      App.renderDashboard();
      await new Promise(r => setTimeout(r, 200));

      const texto = (id) => (document.getElementById(id)?.textContent || '');
      return {
        ganancia: texto('hero-ganancia'),
        ticket: texto('stat-ticket'),
        cobrar: texto('stat-cobrar'),
        // Lo que nunca puede aparecer en pantalla
        hayNaN: ['hero-ganancia', 'stat-ticket', 'stat-cobrar', 'stat-ventas', 'today-amount']
          .filter(id => /NaN|undefined|Infinity/.test(texto(id))),
        stockFinal: (await DB.get('perfumes', pid)).stock,
      };
    });

    console.log('ganancia:', r.ganancia, '| ticket:', r.ticket, '| por cobrar:', r.cobrar);
    console.log('stock tras 5 ventas de 1 unidad (había 50):', r.stockFinal);
    expect(r.hayNaN, 'aparece NaN/undefined/Infinity en pantalla').toEqual([]);
  });
});

test.describe('Riesgo de pérdida de datos', () => {
  test('con la licencia puesta, los datos se guardan cifrados y vuelven enteros', async ({ page }) => {
    test.setTimeout(180000);
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
      // Con licencia, _shouldEncrypt() se activa para todos los stores
      localStorage.setItem('pt_license_code', 'PT-TEST99-AAAA1111');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
    await page.waitForTimeout(2000);

    const r = await page.evaluate(async () => {
      for (const s of ['ventas', 'cuotas', 'perfumes', 'compras', 'reservas']) {
        for (const x of await DB.getAll(s)) await DB.delete(s, x.id);
      }
      const pid = await DB.addPerfume({ nombre: 'Cifrado 🍶', stock: 6, precioCompra: 1250.5, precioVenta: 2400 });
      const vid = await DB.addVenta({
        perfume: 'Cifrado 🍶', perfumeId: pid, cantidad: 2, precioVenta: 4800, precioCompra: 2501,
        cliente: 'Ana Pérez', vendedor: 'Yo', formaPago: 'cuotas', numCuotas: 3, fecha: Date.now(),
      });
      await DB.registrarCompra({ perfumeId: pid, cantidad: 4, precioUnitario: 1300 });
      await DB.addReserva({ cliente: 'Bruno', perfume: 'Otro', perfumeId: pid, cantidad: 1, precioAcordado: 900, sena: 300 });
      await App.loadData();

      // ¿Está realmente cifrado en disco? Se mira el registro crudo,
      // sin pasar por la capa que descifra.
      const crudo = await new Promise((res, rej) => {
        const req = indexedDB.open('ParfumTrackDB');
        req.onsuccess = e => {
          const d = e.target.result;
          const t = d.transaction('ventas').objectStore('ventas').getAll();
          t.onsuccess = () => res(t.result);
          t.onerror = () => rej(t.error);
        };
        req.onerror = () => rej(req.error);
      });
      const cifrado = crudo.length > 0 && !!crudo[0]._encrypted;
      const filtraTexto = JSON.stringify(crudo).includes('Ana Pérez');

      // Y al leer con la capa normal, ¿vuelve todo igual?
      const v = await DB.get('ventas', vid);
      const p = await DB.get('perfumes', pid);
      const cuotas = (await DB.getAll('cuotas')).filter(c => c.ventaId === vid);

      // Operar sobre datos cifrados: devolver, revertir, editar
      await DB.devolverVenta(vid, { motivo: 'test', reponerStock: true });
      await DB.revertirDevolucion(vid);
      await DB.updateVenta({ ...(await DB.get('ventas', vid)), cantidad: 3 });
      await App.loadData();
      const vFinal = await DB.get('ventas', vid);
      const cuotasFinal = (await DB.getAll('cuotas')).filter(c => c.ventaId === vid);

      return {
        cifrado, filtraTexto,
        venta: { perfume: v.perfume, cliente: v.cliente, precio: v.precioVenta, cant: v.cantidad },
        perfumeNombre: p.nombre, perfumeCosto: p.precioCompra,
        cuotas: cuotas.length,
        sumaCuotas: cuotas.reduce((s, c) => s + c.monto, 0),
        trasOperar: { cant: vFinal.cantidad, cuotas: cuotasFinal.length, devuelta: !!vFinal.devuelta },
        // Los duplicados por cifrado fueron un bug real en el pasado
        totalVentas: (await DB.getAll('ventas')).length,
      };
    });

    console.log('¿cifrado en disco?', r.cifrado, '| ¿se filtra el nombre en claro?', r.filtraTexto);
    console.log('venta al releer   :', JSON.stringify(r.venta));
    console.log('perfume           :', r.perfumeNombre, '| costo', r.perfumeCosto);
    console.log('cuotas            :', r.cuotas, 'suman', r.sumaCuotas);
    console.log('tras devolver/revertir/editar:', JSON.stringify(r.trasOperar));
    console.log('ventas totales (debe ser 1):', r.totalVentas);

    expect(r.cifrado, 'los datos NO se guardaron cifrados').toBe(true);
    expect(r.filtraTexto, 'el nombre del cliente quedó en claro en disco').toBe(false);
    expect(r.venta).toEqual({ perfume: 'Cifrado 🍶', cliente: 'Ana Pérez', precio: 4800, cant: 2 });
    // 1300 y no 1250.5: la compra de F4 actualiza el costo de referencia
    expect(r.perfumeCosto).toBe(1300);
    expect(r.cuotas).toBe(3);
    expect(r.sumaCuotas).toBe(4800);
    expect(r.totalVentas, 'se duplicaron registros al cifrar').toBe(1);
    expect(errores.filter(e => !/service|SW|font|Failed to fetch/i.test(e))).toEqual([]);
  });

  test('una base vieja (v3) migra sin perder lo que tenía', async ({ page }) => {
    test.setTimeout(120000);
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());

    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
      localStorage.setItem('pt_demo_seeded', '1');   // que no siembre demo encima
    });
    // La base se fabrica desde una URL del MISMO origen que no ejecuta la
    // app: si la app está cargada mantiene la base abierta y deleteDatabase
    // queda bloqueado para siempre.
    await page.goto(APP_URL + '/manifest.json', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const borrar = indexedDB.deleteDatabase('ParfumTrackDB');
        borrar.onblocked = () => reject(new Error('deleteDatabase bloqueado'));
        borrar.onerror = () => reject(borrar.error);
        borrar.onsuccess = () => {
          const req = indexedDB.open('ParfumTrackDB', 3);
          req.onupgradeneeded = (e) => {
            const d = e.target.result;
            for (const [n, idx] of [['perfumes', ['nombre']], ['ventas', ['fecha', 'perfumeId', 'cliente']],
              ['cuotas', ['ventaId', 'pagado', 'vence']], ['pedidos', ['estado', 'fecha']],
              ['caja', ['fecha', 'tipo']], ['gastos', ['fecha']]]) {
              const s = d.createObjectStore(n, { keyPath: 'id', autoIncrement: true });
              idx.forEach(i => s.createIndex(i, i, { unique: false }));
            }
            d.createObjectStore('config', { keyPath: 'key' });
          };
          req.onsuccess = (e) => {
            const d = e.target.result;
            const t = d.transaction(['perfumes', 'ventas', 'cuotas'], 'readwrite');
            t.objectStore('perfumes').add({ nombre: 'Viejo 1', stock: 4, precioCompra: 800, precioVenta: 1600 });
            t.objectStore('ventas').add({
              perfume: 'Viejo 1', perfumeId: 1, precioVenta: 1600, precioCompra: 800,
              cliente: 'Cliente Viejo', vendedor: 'V', formaPago: 'cuotas', numCuotas: 2,
              fecha: Date.now() - 86400000,   // sin `cantidad`: es de antes de F1
            });
            t.objectStore('cuotas').add({
              ventaId: 1, perfume: 'Viejo 1', cliente: 'Cliente Viejo', numero: 1, total: 2,
              monto: 800, montoTotal: 1600, pagado: true, montoPagado: 800, vence: Date.now(),
            });
            t.objectStore('cuotas').add({
              ventaId: 1, perfume: 'Viejo 1', cliente: 'Cliente Viejo', numero: 2, total: 2,
              monto: 800, montoTotal: 1600, pagado: false, montoPagado: 0, vence: Date.now() + 2592000000,
            });
            t.oncomplete = () => { d.close(); resolve(); };
          };
        };
      });
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof App !== 'undefined' && App.perfumes.length > 0, { timeout: 20000 });
    await page.waitForTimeout(1500);

    const r = await page.evaluate(async () => ({
      version: db.version,
      stores: [...db.objectStoreNames].sort(),
      perfumes: App.perfumes.map(p => p.nombre),
      ventas: App.ventas.map(v => ({ p: v.perfume, cant: v.cantidad, precio: v.precioVenta })),
      cuotas: App.cuotasData.length,
      deuda: App.cuotasData.filter(c => !c.pagado).reduce((s, c) => s + (c.monto - (c.montoPagado || 0)), 0),
      ganancia: document.getElementById('hero-ganancia')?.textContent,
    }));

    console.log('versión tras migrar:', r.version, '(era 3)');
    console.log('stores             :', r.stores.join(', '));
    console.log('perfumes           :', JSON.stringify(r.perfumes));
    console.log('ventas             :', JSON.stringify(r.ventas));
    console.log('cuotas             :', r.cuotas, '| deuda:', r.deuda);

    expect(r.version).toBeGreaterThanOrEqual(5);
    expect(r.stores).toContain('compras');
    expect(r.stores).toContain('reservas');
    // Lo que ya estaba tiene que seguir estando
    expect(r.perfumes).toEqual(['Viejo 1']);
    expect(r.ventas).toHaveLength(1);
    expect(r.cuotas).toBe(2);
    expect(r.deuda).toBe(800);
    expect(errores.filter(e => !/service|SW|font|Failed to fetch/i.test(e))).toEqual([]);
  });
});
