// @ts-check
// Fuzzer de invariantes.
//
// En vez de escribir casos a mano, tira secuencias largas de operaciones al
// azar (vender, editar, borrar, devolver, reponer, cobrar cuotas, encargar)
// y después de CADA una verifica reglas que nunca pueden romperse. Si una
// falla, imprime la secuencia exacta que llevó hasta ahí para reproducirla.
//
// Encuentra la clase de bug más cara de esta app: la que hace que un número
// de plata quede mal sin que nadie se dé cuenta.
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

const CORRIDAS = Number(process.env.FUZZ_CORRIDAS || 12);
const OPS = Number(process.env.FUZZ_OPS || 60);

test.describe('Fuzz de integridad', () => {
  test('ninguna secuencia de operaciones rompe las invariantes', async ({ page }) => {
    test.setTimeout(300000);
    const errores = [];
    page.on('pageerror', e => errores.push('pageerror: ' + e.message));

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

    const fallas = await page.evaluate(async ({ corridas, ops }) => {
      // PRNG con semilla: una falla se tiene que poder repetir
      const rng = (semilla) => () => {
        semilla = (semilla * 1664525 + 1013904223) % 4294967296;
        return semilla / 4294967296;
      };

      const limpiar = async () => {
        for (const s of ['ventas', 'cuotas', 'perfumes', 'compras', 'reservas']) {
          for (const r of await DB.getAll(s)) await DB.delete(s, r.id);
        }
        await App.loadData();
      };

      // Las reglas del negocio que tienen que valer SIEMPRE
      const revisar = async () => {
        const rotas = [];
        const perfumes = await DB.getAll('perfumes');
        const ventas = await DB.getAll('ventas');
        const cuotas = await DB.getAll('cuotas');
        const compras = await DB.getAll('compras');
        const reservas = await DB.getAll('reservas');

        for (const p of perfumes) {
          if (!(p.stock >= 0)) rotas.push(`stock negativo: ${p.nombre} = ${p.stock}`);
          if (!Number.isFinite(p.stock)) rotas.push(`stock no numérico: ${p.nombre} = ${p.stock}`);
        }

        for (const v of ventas) {
          if (!Number.isFinite(v.precioVenta)) rotas.push(`venta ${v.id} con precio no numérico`);
          if (v.unidadesDescontadas !== undefined) {
            const cant = Math.max(1, parseInt(v.cantidad, 10) || 1);
            if (v.unidadesDescontadas > cant) {
              rotas.push(`venta ${v.id} descontó ${v.unidadesDescontadas} de ${cant} unidades`);
            }
          }
        }

        // Las cuotas de una venta tienen que sumar exactamente su precio
        const porVenta = {};
        for (const c of cuotas) {
          if (!porVenta[c.ventaId]) porVenta[c.ventaId] = [];
          porVenta[c.ventaId].push(c);
          const pagado = c.montoPagado || 0;
          if (pagado > c.monto + 0.01) {
            rotas.push(`cuota ${c.id} pagada de más: ${pagado} de ${c.monto}`);
          }
          if (pagado < 0) rotas.push(`cuota ${c.id} con pago negativo`);
        }
        for (const [ventaId, cs] of Object.entries(porVenta)) {
          const v = ventas.find(x => String(x.id) === String(ventaId));
          if (!v) { rotas.push(`cuotas huérfanas de la venta ${ventaId}`); continue; }
          const suma = cs.reduce((s, c) => s + (c.monto || 0), 0);
          if (v.devuelta) {
            // Al devolver se borran las impagas a propósito y quedan las
            // cobradas: la suma tiene que ser menor, y lo que sobreviva
            // tiene que tener plata puesta
            if (suma > v.precioVenta + 1.5) {
              rotas.push(`venta devuelta ${v.id}: las cuotas suman ${suma}, más que los ${v.precioVenta} de la venta`);
            }
            const sinPagar = cs.filter(c => !(c.montoPagado > 0));
            if (sinPagar.length) {
              rotas.push(`venta devuelta ${v.id}: quedaron ${sinPagar.length} cuotas impagas que debían cancelarse`);
            }
          } else if (Math.abs(suma - v.precioVenta) > 1.5) {
            rotas.push(`las cuotas de la venta ${v.id} suman ${suma} y la venta es ${v.precioVenta}`);
          }
        }

        // Una venta devuelta no puede seguir contando para la ganancia
        const activas = App._ventasActivas();
        if (activas.some(v => v.devuelta)) rotas.push('una venta devuelta sigue contando como activa');

        for (const c of compras) {
          if (!(c.cantidad > 0)) rotas.push(`compra ${c.id} sin cantidad`);
          if (Math.abs((c.precioUnitario * c.cantidad) - c.total) > 0.01) {
            rotas.push(`compra ${c.id}: total ${c.total} != ${c.precioUnitario}x${c.cantidad}`);
          }
        }

        for (const r of reservas) {
          if ((r.sena || 0) > (r.total || 0) + 0.01) {
            rotas.push(`reserva ${r.id}: seña ${r.sena} mayor al total ${r.total}`);
          }
          if (r.estado === 'entregada' && !r.ventaId) {
            rotas.push(`reserva ${r.id} entregada sin venta asociada`);
          }
        }
        return rotas;
      };

      const fallas = [];

      for (let corrida = 0; corrida < corridas; corrida++) {
        const semilla = 1000 + corrida * 7919;
        const rand = rng(semilla);
        const ri = (n) => Math.floor(rand() * n);
        await limpiar();

        // Un catálogo chico para que las operaciones choquen entre sí
        const ids = [];
        for (let i = 0; i < 4; i++) {
          ids.push(await DB.addPerfume({
            nombre: `P${i}`, stock: ri(6), precioCompra: 500 + ri(500), precioVenta: 1000 + ri(2000),
          }));
        }
        await App.loadData();

        const historia = [];
        for (let paso = 0; paso < ops; paso++) {
          const ventas = await DB.getAll('ventas');
          const cuotas = await DB.getAll('cuotas');
          const compras = await DB.getAll('compras');
          const reservas = await DB.getAll('reservas');
          const op = ri(10);
          let desc = '';
          try {
            if (op === 0 || op === 1) {
              const pid = ids[ri(ids.length)];
              const cant = 1 + ri(4);
              const nc = ri(3) === 0 ? 2 + ri(3) : 1;
              const precio = 1000 + ri(3000);
              desc = `vender p=${pid} cant=${cant} cuotas=${nc} precio=${precio}`;
              await DB.addVenta({
                perfume: `P${ids.indexOf(pid)}`, perfumeId: pid, cantidad: cant,
                precioVenta: precio, precioCompra: 500 * cant, cliente: 'C' + ri(3),
                vendedor: 'V', formaPago: nc > 1 ? 'cuotas' : 'contado', numCuotas: nc,
                fecha: Date.now(),
              });
            } else if (op === 2 && ventas.length) {
              const v = ventas[ri(ventas.length)];
              desc = `borrar venta ${v.id}`;
              await DB.deleteVenta(v.id);
            } else if (op === 3 && ventas.length) {
              const v = ventas[ri(ventas.length)];
              const nuevaCant = 1 + ri(5);
              desc = `editar venta ${v.id} -> cant=${nuevaCant}`;
              await DB.updateVenta({ ...v, cantidad: nuevaCant, perfumeId: ids[ri(ids.length)] });
            } else if (op === 4 && ventas.length) {
              const v = ventas[ri(ventas.length)];
              desc = `devolver venta ${v.id}`;
              await DB.devolverVenta(v.id, { motivo: 'test', reponerStock: ri(2) === 0 });
            } else if (op === 5 && ventas.length) {
              const v = ventas[ri(ventas.length)];
              desc = `revertir devolución ${v.id}`;
              await DB.revertirDevolucion(v.id);
            } else if (op === 6) {
              const pid = ids[ri(ids.length)];
              const cant = 1 + ri(10);
              desc = `comprar p=${pid} cant=${cant}`;
              await DB.registrarCompra({ perfumeId: pid, cantidad: cant, precioUnitario: 300 + ri(400) });
            } else if (op === 7 && compras.length) {
              const c = compras[ri(compras.length)];
              desc = `borrar compra ${c.id}`;
              await DB.eliminarCompra(c.id);
            } else if (op === 8 && cuotas.length) {
              const c = cuotas[ri(cuotas.length)];
              const resta = c.monto - (c.montoPagado || 0);
              const monto = Math.max(1, Math.round(resta * (rand() * 1.1)));  // a veces de más
              desc = `pagar cuota ${c.id} monto=${monto} (resta ${resta})`;
              await DB.pagarCuota(c.id, monto);
            } else {
              const pid = ids[ri(ids.length)];
              const precio = 1000 + ri(2000);
              const sena = Math.round(precio * rand() * 1.2);   // a veces mayor al total
              desc = `reservar p=${pid} precio=${precio} sena=${sena}`;
              const r = await DB.addReserva({
                cliente: 'C' + ri(3), perfume: `P${ids.indexOf(pid)}`, perfumeId: pid,
                cantidad: 1, precioAcordado: precio, sena,
              });
              if (ri(3) === 0) await DB.entregarReserva(r.id, { precioCompra: 400 });
            }
          } catch (e) {
            // Los rechazos con mensaje son válidos: la app se está
            // defendiendo. Lo que no puede pasar es un TypeError.
            if (!/SOBREPAGO|Sobrepago|YA_DEVUELTA|NO_PENDIENTE|NO_ENCONTRAD|INVALID|Maximum/i.test(e.message)) {
              fallas.push({ semilla, paso, desc, error: 'excepción inesperada: ' + e.message, historia: historia.slice(-6) });
            }
          }
          historia.push(desc);
          await App.loadData();

          const rotas = await revisar();
          if (rotas.length) {
            fallas.push({ semilla, paso, desc, rotas, historia: historia.slice(-6) });
            break;   // esta corrida ya está contaminada
          }
        }
      }
      return fallas;
    }, { corridas: CORRIDAS, ops: OPS });

    if (fallas.length) {
      console.log(`\n=== ${fallas.length} INVARIANTES ROTAS ===`);
      for (const f of fallas.slice(0, 8)) {
        console.log(`\n[semilla ${f.semilla}, paso ${f.paso}] ${f.desc}`);
        (f.rotas || [f.error]).forEach(r => console.log('   ✗', r));
        console.log('   últimas operaciones:');
        f.historia.forEach(h => console.log('     ·', h));
      }
    }
    expect(errores, 'errores de JS').toEqual([]);
    expect(fallas, 'invariantes rotas').toEqual([]);
  });
});
