// Regresión de la ronda de hardening (tandas 1-5 de la auditoría multi-agente).
// Cada test protege un fix concreto: si alguien lo revierte, CI falla.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('Tanda 1 — performance de arranque', () => {
  const enc = read('src/app/15-encryption.js');
  const core = read('src/app/00-core.js');

  it('la clave derivada se cachea (evita 100k iteraciones por registro)', () => {
    expect(enc).toContain('_keyCache');
    const idx = enc.indexOf('async deriveKeyFromLicense');
    const cuerpo = enc.slice(idx, idx + 500);
    expect(cuerpo).toMatch(/_keyCache\[licenseCode\]/);
  });

  it('el caché se invalida al bloquear la clave maestra', () => {
    const idx = enc.indexOf('lockMasterKey()');
    expect(enc.slice(idx, idx + 250)).toMatch(/_keyCache\s*=\s*\{\}/);
  });

  it('las migraciones comparten una sola lectura de cuotas', () => {
    expect(core).toMatch(/_fixStringCuotaIds\(cuotasInit\)/);
    expect(core).toMatch(/_fixCuotasSaldadas\(/);
  });

  it('no agrupa cuotas sin ventaId (no condona deuda ajena)', () => {
    const idx = core.indexOf('async _fixCuotasSaldadas');
    const cuerpo = core.slice(idx, idx + 1500);
    expect(cuerpo).toMatch(/ventaId === undefined/);
  });
});

describe('Tanda 2 — integridad en ediciones y pagos', () => {
  const edit = read('src/app/06-ventas-edit-delete.js');
  const db = read('src/db.js');
  const cuotas = read('src/app/05-cuotas.js');

  it('updateVenta valida precio, descuento y cuotas como el alta', () => {
    expect(edit).toMatch(/precioVenta <= 0/);
    expect(edit).toMatch(/descuento < 0 \|\| descuento > 100/);
    expect(edit).toMatch(/numCuotas < 1 \|\| numCuotas > 12/);
  });

  it('la venta registra si descontó stock (evita stock fantasma)', () => {
    expect(db).toMatch(/stockDescontado/);
    const idx = db.indexOf('async deleteVenta');
    expect(db.slice(idx, idx + 500)).toMatch(/stockDescontado !== false/);
  });

  it('el pago de cuota tiene guarda anti doble-tap', () => {
    expect(cuotas).toMatch(/_once\(['"]pago-cuota['"]/);
  });
});

describe('Tanda 3 — UX de cobros', () => {
  const render = read('src/app/02-render.js');
  const stock = read('src/app/04-stock.js');

  it('las cuotas se ordenan por vencimiento más próximo', () => {
    expect(render).toContain('gruposOrdenados');
  });

  it('marca las cuotas vencidas', () => {
    expect(render).toMatch(/estaVencida/);
    expect(render).toMatch(/Vencida hace/);
  });

  it('los filtros de stock marcan el chip activo correcto', () => {
    const idx = stock.indexOf('filterStockBy');
    const cuerpo = stock.slice(idx, idx + 400);
    expect(cuerpo).toMatch(/todos:\s*0/);
    expect(cuerpo).toMatch(/toggle\(['"]active['"]/);
  });
});

describe('Tanda 4 — listas grandes', () => {
  const render = read('src/app/02-render.js');

  it('el número de venta usa el índice, no indexOf O(n²)', () => {
    // Buscar la DEFINICIÓN (usa valores por defecto), no una llamada
    const idx = render.indexOf('_renderVentaCard(v, { compact = false');
    expect(idx, 'definición de _renderVentaCard').toBeGreaterThan(-1);
    const cuerpo = render.slice(idx, idx + 500);
    expect(cuerpo).toMatch(/index !== undefined/);
    expect(cuerpo).toMatch(/index\s*\}/); // el índice llega por parámetro
  });

  it('renderAll solo rinde la pantalla visible', () => {
    const idx = render.indexOf('renderAll()');
    const cuerpo = render.slice(idx, idx + 900);
    expect(cuerpo).toMatch(/currentScreen/);
  });

  it('el listado de ventas pagina', () => {
    expect(render).toContain('_VENTAS_PAGINA');
    expect(render).toContain('verMasVentas');
  });
});

describe('Tanda 5 — robustez y datos del usuario', () => {
  const core = read('src/app/00-core.js');
  const upd = read('src/app/17-auto-update.js');

  it('init atrapa errores y muestra una pantalla útil', () => {
    const idx = core.indexOf('async init()');
    const cuerpo = core.slice(idx, idx + 400);
    expect(cuerpo).toMatch(/try\s*\{/);
    expect(cuerpo).toMatch(/_mostrarErrorArranque/);
  });

  it('solicita persistencia para que el navegador no borre los datos', () => {
    expect(core).toMatch(/navigator\.storage\.persist/);
  });

  it('la recarga automática no pisa un formulario en curso', () => {
    expect(upd).toContain('_hayTrabajoEnCurso');
    const idx = upd.indexOf('_hayTrabajoEnCurso()');
    expect(upd.slice(idx, idx + 900)).toMatch(/modalAbierto|activeElement/);
  });
});
