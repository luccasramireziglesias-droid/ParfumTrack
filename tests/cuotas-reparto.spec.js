// @ts-check
// Reparto de cuotas — BUG-31.
//
// El pago inicial es la cuota 1 y lo que resta se reparte parejo entre las que siguen.
// Antes el excedente se derramaba sobre la cuota siguiente: cobrar $2.000 de una venta de
// $5.890 en 3 dejaba la cuota 2 con "pagado $37 de $1.963", y todos los recordatorios de
// cobro pedían $1.926 en vez de una cuota entera.
//
// Además el cálculo viejo de la última cuota (`total − round(total/n) × (n−1)`) podía dar
// **negativo** con montos chicos y muchas cuotas: 13 en 8 daba −1.

const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

test.describe('Reparto de cuotas', () => {
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
  });

  test('el caso reportado: $5.890 en 3 con $2.000 cobrados al vender', async ({ page }) => {
    const montos = await page.evaluate(() => DB._repartirCuotas(5890, 3, 2000));
    // El pago inicial es la cuota 1; los $3.890 que restan van mitad y mitad.
    expect(montos).toEqual([2000, 1945, 1945]);
    expect(montos.reduce((a, b) => a + b, 0)).toBe(5890);
    // Y ninguna cuota queda con un pago parcial de $37 encima.
  });

  test('la venta guardada no deja cuotas cobradas a medias', async ({ page }) => {
    const cuotas = await page.evaluate(async () => {
      for (const c of await DB.getAll('cuotas')) await DB.delete('cuotas', c.id);
      for (const v of await DB.getAll('ventas')) await DB.delete('ventas', v.id);
      const id = await DB.addVenta({
        perfume: 'BOSS PARFUM', cliente: 'SASHA', precioVenta: 5890, precioCompra: 3000,
        cantidad: 1, formaPago: 'cuotas', numCuotas: 3, primerPago: 2000, fecha: Date.now(),
      });
      return (await DB.getAll('cuotas'))
        .filter(c => c.ventaId === id)
        .sort((a, b) => a.numero - b.numero)
        .map(c => ({ n: c.numero, monto: c.monto, pagado: c.montoPagado, cerrada: c.pagado }));
    });

    expect(cuotas).toEqual([
      { n: 1, monto: 2000, pagado: 2000, cerrada: true },
      { n: 2, monto: 1945, pagado: 0, cerrada: false },
      { n: 3, monto: 1945, pagado: 0, cerrada: false },
    ]);

    // Lo que de verdad molestaba: ninguna cuota pendiente arranca con plata encima.
    const aMedias = cuotas.filter(c => !c.cerrada && c.pagado > 0);
    expect(aMedias, 'una cuota pendiente no puede nacer con un pago parcial').toEqual([]);
  });

  test('sin cobrar nada al vender, se reparte parejo entre todas', async ({ page }) => {
    const montos = await page.evaluate(() => DB._repartirCuotas(5890, 3, 0));
    expect(montos.reduce((a, b) => a + b, 0)).toBe(5890);
    // La diferencia entre la mayor y la menor nunca pasa de 1.
    expect(Math.max(...montos) - Math.min(...montos)).toBeLessThanOrEqual(1);
  });

  test('🔴 ninguna cuota puede quedar negativa (13 en 8 daba −1)', async ({ page }) => {
    const { nuevo, viejo } = await page.evaluate(() => ({
      nuevo: DB._repartirCuotas(13, 8, 0),
      // el cálculo que estaba antes, para dejar constancia de qué se arregló
      viejo: (() => { const m = Math.round(13 / 8); return [...Array(7).fill(m), 13 - m * 7]; })(),
    }));
    expect(viejo[7], 'el cálculo viejo daba una cuota negativa').toBeLessThan(0);
    expect(nuevo.every(x => x >= 0)).toBe(true);
    expect(nuevo.reduce((a, b) => a + b, 0)).toBe(13);
  });

  test('la suma cierra exacta en todo el rango de montos y cuotas', async ({ page }) => {
    const fallas = await page.evaluate(() => {
      const malas = [];
      for (const total of [0, 1, 7, 10, 13, 100, 999, 2650, 5890, 5890.5, 12345.67]) {
        for (let n = 1; n <= 12; n++) {
          for (const inicial of [0, 1, Math.floor(total / 2), total]) {
            const m = DB._repartirCuotas(total, n, inicial);
            const suma = m.reduce((a, b) => a + b, 0);
            if (Math.abs(suma - total) > 0.005) malas.push(`$${total} en ${n} (ini ${inicial}) suma ${suma}`);
            if (m.some(x => x < 0)) malas.push(`$${total} en ${n} (ini ${inicial}) tiene cuota negativa`);
            if (m.length !== n) malas.push(`$${total} en ${n} devolvió ${m.length} cuotas`);
          }
        }
      }
      return malas;
    });
    expect(fallas).toEqual([]);
  });

  test('deshacer una devolución recrea las cuotas con los mismos montos', async ({ page }) => {
    // Las dos copias del cálculo tienen que dar lo mismo, si no las cuotas recreadas
    // quedan con montos que no coinciden con los originales.
    const r = await page.evaluate(async () => {
      for (const c of await DB.getAll('cuotas')) await DB.delete('cuotas', c.id);
      for (const v of await DB.getAll('ventas')) await DB.delete('ventas', v.id);
      const id = await DB.addVenta({
        perfume: 'BOSS PARFUM', cliente: 'SASHA', precioVenta: 5890, precioCompra: 3000,
        cantidad: 1, formaPago: 'cuotas', numCuotas: 3, primerPago: 2000, fecha: Date.now(),
      });
      const antes = (await DB.getAll('cuotas')).filter(c => c.ventaId === id)
        .sort((a, b) => a.numero - b.numero).map(c => c.monto);
      await DB.devolverVenta(id, { motivo: 'prueba' });
      await DB.revertirDevolucion(id);
      const despues = (await DB.getAll('cuotas')).filter(c => c.ventaId === id)
        .sort((a, b) => a.numero - b.numero).map(c => c.monto);
      return { antes, despues };
    });
    expect(r.despues).toEqual(r.antes);
    expect(r.despues.reduce((a, b) => a + b, 0)).toBe(5890);
  });
});
