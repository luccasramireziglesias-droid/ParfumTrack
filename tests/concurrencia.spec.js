// @ts-check
// Concurrencia e interrupción.
//
// Dos huecos que ningún test cubría:
//   1. Dos pestañas abiertas escribiendo a la vez sobre la misma base.
//   2. La app cortada a la mitad de una operación (cerrar, recargar, quedarse
//      sin batería justo cuando se guardaba una venta).
//
// Los dos casos comparten la misma pregunta: ¿puede quedar un número de plata
// mal sin que nadie se entere? Un stock que no coincide con lo vendido, una
// venta sin sus cuotas, una cuota huérfana.
//
// Estos tests NO asumen que la app tiene locking (no lo tiene). Lo que
// verifican es que el estado que queda sea COHERENTE, aunque se pierda la
// escritura de una de las pestañas.
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

const PREPARAR = () => {
  localStorage.setItem('pt_onboarded', '1');
  localStorage.setItem('pt_consent_accepted', '1');
};

async function abrirPagina(context) {
  const page = await context.newPage();
  await page.route('**/*.googleapis.com/**', r => r.abort());
  await page.route('**/*.gstatic.com/**', r => r.abort());
  await page.route('**/plausible.io/**', r => r.abort());
  await page.addInitScript(PREPARAR);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
  await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });
  return page;
}

// Deja un solo perfume con stock conocido y sin historial
async function estadoLimpio(page, stock = 50) {
  return page.evaluate(async (stock) => {
    for (const s of ['ventas', 'cuotas', 'perfumes', 'compras', 'reservas']) {
      for (const r of await DB.getAll(s)) await DB.delete(s, r.id);
    }
    const id = await DB.addPerfume({
      nombre: 'Concurrente', stock, precioCompra: 500, precioVenta: 1000,
    });
    await App.loadData();
    return id;
  }, stock);
}

// Las reglas que tienen que valer pase lo que pase
async function revisarCoherencia(page, perfumeId, stockInicial) {
  return page.evaluate(async ({ perfumeId, stockInicial }) => {
    const perfume = await DB.get('perfumes', perfumeId);
    const ventas = await DB.getAll('ventas');
    const cuotas = await DB.getAll('cuotas');

    const problemas = [];

    if (!(perfume.stock >= 0)) problemas.push(`stock negativo: ${perfume.stock}`);

    // Lo que bajó el inventario tiene que coincidir con lo que las ventas
    // dicen haber descontado, menos lo que las devoluciones repusieron
    const descontado = ventas.reduce((s, v) => s + (v.unidadesDescontadas || 0), 0);
    const repuesto = ventas.reduce((s, v) => s + (v.unidadesRepuestas || 0), 0);
    const neto = descontado - repuesto;
    if (stockInicial - perfume.stock !== neto) {
      problemas.push(`el stock bajó ${stockInicial - perfume.stock} pero las ventas descontaron ${neto} neto (${descontado} − ${repuesto} repuestas)`);
    }

    // Ninguna cuota puede apuntar a una venta que no existe
    const ids = new Set(ventas.map(v => String(v.id)));
    for (const c of cuotas) {
      if (!ids.has(String(c.ventaId))) problemas.push(`cuota ${c.id} huérfana (venta ${c.ventaId})`);
    }

    // Una venta en cuotas tiene que tener TODAS sus cuotas o ninguna. Las
    // devueltas quedan afuera: cancelar las impagas es justamente el diseño.
    for (const v of ventas) {
      if (v.formaPago !== 'cuotas' || v.devuelta) continue;
      const suyas = cuotas.filter(c => String(c.ventaId) === String(v.id));
      if (suyas.length !== 0 && suyas.length !== v.numCuotas) {
        problemas.push(`venta ${v.id}: ${suyas.length} cuotas de ${v.numCuotas}`);
      }
    }

    // Ids duplicados: la misma venta guardada dos veces
    const vistos = new Set();
    for (const v of ventas) {
      if (vistos.has(v.id)) problemas.push(`venta ${v.id} duplicada`);
      vistos.add(v.id);
    }

    return { problemas, ventas: ventas.length, stock: perfume.stock, descontado };
  }, { perfumeId, stockInicial });
}

const vender = (page, cuantas, prefijo) => page.evaluate(async ({ cuantas, prefijo }) => {
  const p = App.perfumes.find(x => x.nombre === 'Concurrente');
  const ids = [];
  for (let i = 0; i < cuantas; i++) {
    ids.push(await DB.addVenta({
      perfume: p.nombre, perfumeId: p.id, cantidad: 1,
      precioVenta: 1000, precioCompra: 500, precioUnitario: 1000, precioCompraUnitario: 500,
      cliente: `${prefijo}${i}`, vendedor: 'Yo', formaPago: 'contado', numCuotas: 1,
      fecha: Date.now(),
    }));
  }
  return ids;
}, { cuantas, prefijo });

test.describe('Concurrencia entre pestañas', () => {
  test('dos pestañas vendiendo a la vez no descuadran el stock', async ({ context }) => {
    test.setTimeout(180000);
    const a = await abrirPagina(context);
    const perfumeId = await estadoLimpio(a, 50);

    // La segunda pestaña arranca DESPUÉS: comparte la misma IndexedDB
    const b = await abrirPagina(context);
    await b.evaluate(() => App.loadData());

    // 10 ventas desde cada una, en paralelo de verdad
    await Promise.all([vender(a, 10, 'A'), vender(b, 10, 'B')]);

    const r = await revisarCoherencia(a, perfumeId, 50);
    console.log(`ventas: ${r.ventas} · stock: ${r.stock} · descontado: ${r.descontado}`);

    expect(r.problemas).toEqual([]);
    // Ninguna venta se puede perder: los ids son autoincrementales y las
    // transacciones de IndexedDB son atómicas
    expect(r.ventas).toBe(20);
    expect(r.stock).toBe(30);
  });

  test('editar la MISMA venta desde dos pestañas no duplica el descuento', async ({ context }) => {
    test.setTimeout(180000);
    const a = await abrirPagina(context);
    const perfumeId = await estadoLimpio(a, 50);
    const [ventaId] = await vender(a, 1, 'X');

    const b = await abrirPagina(context);
    await b.evaluate(() => App.loadData());

    // Las dos cambian la cantidad de la misma venta al mismo tiempo
    const editar = (page, cant) => page.evaluate(async ({ ventaId, cant }) => {
      const v = await DB.get('ventas', ventaId);
      await DB.updateVenta({ ...v, cantidad: cant });
    }, { ventaId, cant: page === a ? 5 : 8 });

    await Promise.all([editar(a, 5), editar(b, 8)]);

    const r = await revisarCoherencia(a, perfumeId, 50);
    console.log(`stock: ${r.stock} · descontado: ${r.descontado}`);

    // Sin locking, gana la última escritura. Lo que NO puede pasar es que el
    // stock quede descuadrado respecto de lo que la venta dice haber
    // descontado: eso sería inventario inventado o perdido.
    expect(r.problemas).toEqual([]);
    expect(r.ventas).toBe(1);
  });

  test('la pestaña B ve lo que vendió la A sin recargar', async ({ context }) => {
    test.setTimeout(180000);
    const a = await abrirPagina(context);
    await estadoLimpio(a, 50);
    const b = await abrirPagina(context);
    await b.evaluate(() => App.loadData());

    expect(await b.evaluate(() => App.ventas.length)).toBe(0);

    // BroadcastChannel: así avisa la app cuando cambian los datos
    await vender(a, 1, 'Sync');
    await a.evaluate(() => App._notifyTabs());

    await b.waitForFunction(() => App.ventas.length === 1, { timeout: 10000 });
    expect(await b.evaluate(() => App.ventas[0].cliente)).toBe('Sync0');
  });

  test('borrar en una pestaña no deja cuotas huérfanas en la otra', async ({ context }) => {
    test.setTimeout(180000);
    const a = await abrirPagina(context);
    const perfumeId = await estadoLimpio(a, 50);

    const ventaId = await a.evaluate(async () => {
      const p = App.perfumes.find(x => x.nombre === 'Concurrente');
      const id = await DB.addVenta({
        perfume: p.nombre, perfumeId: p.id, cantidad: 1,
        precioVenta: 3000, precioCompra: 500, precioUnitario: 3000,
        cliente: 'Deudor', vendedor: 'Yo', formaPago: 'cuotas', numCuotas: 3,
        fecha: Date.now(),
      });
      await App.loadData();
      return id;
    });

    const b = await abrirPagina(context);
    await b.evaluate(() => App.loadData());

    // A borra la venta mientras B cobra una de sus cuotas
    await Promise.all([
      a.evaluate((id) => DB.deleteVenta(id), ventaId),
      b.evaluate(async (id) => {
        const c = (await DB.getAll('cuotas')).find(x => String(x.ventaId) === String(id) && !x.pagado);
        if (c) { try { await DB.pagarCuota(c.id, c.monto); } catch (_) { /* puede haber desaparecido */ } }
      }, ventaId),
    ]);

    const r = await revisarCoherencia(a, perfumeId, 50);
    console.log(`tras el borrado concurrente → ventas: ${r.ventas} · problemas: ${r.problemas.length}`);
    // El riesgo real: que quede una cuota apuntando a una venta borrada, o
    // sea deuda de un cliente que la app ya no puede explicar
    expect(r.problemas).toEqual([]);
  });
});

test.describe('Interrupción a mitad de una operación', () => {
  test('recargar justo después de vender deja la venta completa o nada', async ({ context }) => {
    test.setTimeout(180000);
    const page = await abrirPagina(context);
    const perfumeId = await estadoLimpio(page, 50);

    // Disparar la venta SIN esperarla y recargar encima
    await page.evaluate(() => {
      const p = App.perfumes.find(x => x.nombre === 'Concurrente');
      // sin await a propósito: simula que el usuario cierra la app justo ahí
      window.__pendiente = DB.addVenta({
        perfume: p.nombre, perfumeId: p.id, cantidad: 3,
        precioVenta: 3000, precioCompra: 1500, precioUnitario: 1000,
        cliente: 'Cortado', vendedor: 'Yo', formaPago: 'cuotas', numCuotas: 3,
        fecha: Date.now(),
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });

    const r = await revisarCoherencia(page, perfumeId, 50);
    console.log(`tras la interrupción → ventas: ${r.ventas} · stock: ${r.stock} · problemas: ${JSON.stringify(r.problemas)}`);

    // No importa si la venta llegó a guardarse o no; importa que lo que haya
    // quedado sea coherente. Las migraciones idempotentes del arranque
    // (_fixCuotasSaldadas, _fixStringCuotaIds) corren justo antes de esto.
    expect(r.problemas).toEqual([]);
  });

  test('recargar durante una devolución no deja la deuda a medias', async ({ context }) => {
    test.setTimeout(180000);
    const page = await abrirPagina(context);
    const perfumeId = await estadoLimpio(page, 50);

    const ventaId = await page.evaluate(async () => {
      const p = App.perfumes.find(x => x.nombre === 'Concurrente');
      const id = await DB.addVenta({
        perfume: p.nombre, perfumeId: p.id, cantidad: 2,
        precioVenta: 3000, precioCompra: 1000, precioUnitario: 1500,
        cliente: 'Devuelve', vendedor: 'Yo', formaPago: 'cuotas', numCuotas: 3,
        fecha: Date.now(),
      });
      await App.loadData();
      return id;
    });

    await page.evaluate((id) => {
      window.__pendiente = DB.devolverVenta(id, { motivo: 'test', reponerStock: true });
    }, ventaId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });

    const estado = await page.evaluate(async (id) => {
      const v = await DB.get('ventas', id);
      const cuotas = (await DB.getAll('cuotas')).filter(c => String(c.ventaId) === String(id));
      const impagas = cuotas.filter(c => !c.pagado && !(c.montoPagado > 0));
      return { devuelta: !!v.devuelta, cuotas: cuotas.length, impagas: impagas.length };
    }, ventaId);
    console.log(`devolución interrumpida → ${JSON.stringify(estado)}`);

    // Si la devolución se completó, no puede quedar ninguna cuota impaga
    // (se cancelan). Si no se completó, tienen que estar las 3.
    if (estado.devuelta) {
      expect(estado.impagas, 'venta devuelta con cuotas impagas colgadas').toBe(0);
    } else {
      expect(estado.cuotas, 'devolución no aplicada pero faltan cuotas').toBe(3);
    }

    const r = await revisarCoherencia(page, perfumeId, 50);
    expect(r.problemas).toEqual([]);
  });

  test('el arranque sana una cuota que quedó pagada de más', async ({ context }) => {
    // Simula el resultado de una interrupción o de un backup adulterado:
    // montoPagado > monto dejaba el total a cobrar en NEGATIVO
    test.setTimeout(180000);
    const page = await abrirPagina(context);
    await estadoLimpio(page, 50);

    const ventaId = await page.evaluate(async () => {
      const p = App.perfumes.find(x => x.nombre === 'Concurrente');
      const id = await DB.addVenta({
        perfume: p.nombre, perfumeId: p.id, cantidad: 1,
        precioVenta: 3000, precioCompra: 500, precioUnitario: 3000,
        cliente: 'Roto', vendedor: 'Yo', formaPago: 'cuotas', numCuotas: 3,
        fecha: Date.now(),
      });
      await App.loadData();
      return id;
    });

    await page.evaluate(async (id) => {
      const c = (await DB.getAll('cuotas')).find(x => String(x.ventaId) === String(id) && !x.pagado);
      c.montoPagado = c.monto * 5;   // corrupción
      await DB.put('cuotas', c);
    }, ventaId);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });

    const deuda = await page.evaluate((id) => {
      const cs = App.cuotasData.filter(c => String(c.ventaId) === String(id));
      return {
        sobrepagadas: cs.filter(c => (c.montoPagado || 0) > c.monto).length,
        aCobrar: cs.filter(c => !c.pagado).reduce((s, c) => s + (c.monto - (c.montoPagado || 0)), 0),
      };
    }, ventaId);
    console.log(`tras sanear → ${JSON.stringify(deuda)}`);

    expect(deuda.sobrepagadas, 'quedó una cuota pagada de más').toBe(0);
    expect(deuda.aCobrar, 'el total a cobrar quedó negativo').toBeGreaterThanOrEqual(0);
  });
});
