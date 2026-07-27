// Regresión de las features nuevas (F1-F5). Cada test protege una decisión de
// diseño concreta: si alguien la revierte, CI falla.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('F1 — cantidad en la venta', () => {
  const nueva = read('src/app/03-nueva-venta.js');
  const edit = read('src/app/06-ventas-edit-delete.js');
  const db = read('src/db.js');
  const render = read('src/app/02-render.js');
  const screen = read('src/screens/nueva-venta.html');
  const index = read('index.html');

  it('el form tiene stepper de cantidad con botones accesibles', () => {
    expect(screen).toContain('id="venta-cantidad"');
    expect(screen).toMatch(/App\.cambiarCantidad\(-1\)/);
    expect(screen).toMatch(/App\.cambiarCantidad\(1\)/);
    expect(screen).toMatch(/aria-label="Cantidad de unidades"/);
    // El build tiene que haber incorporado la pantalla
    expect(index).toContain('id="venta-cantidad"');
  });

  it('los precios del form son por unidad', () => {
    expect(screen).toMatch(/PRECIO VENTA[\s\S]{0,80}por unidad/);
    expect(screen).toMatch(/PRECIO COMPRA[\s\S]{0,80}por unidad/);
  });

  it('la cantidad se sanitiza (entero, 1..999)', () => {
    const idx = nueva.indexOf('_getCantidad()');
    const cuerpo = nueva.slice(idx, idx + 300);
    expect(cuerpo).toMatch(/replace\(\/\[\^\\d\]\/g/);
    expect(cuerpo).toMatch(/Math\.min\(n, 999\)/);
  });

  it('la ganancia en vivo multiplica por la cantidad', () => {
    // La DEFINICIÓN, no una llamada `this.calcLiveProfit()`
    const idx = nueva.indexOf('\n  calcLiveProfit() {');
    const cuerpo = nueva.slice(idx, idx + 700);
    expect(cuerpo).toMatch(/pvUnit \* cant/);
    expect(cuerpo).toMatch(/pcUnit \* cant/);
  });

  it('avisa si la cantidad supera el stock disponible', () => {
    expect(nueva).toContain('venta-cantidad-hint');
    expect(nueva).toMatch(/Solo hay \$\{perf\.stock \|\| 0\} en stock/);
  });

  it('la venta guarda el total y también el unitario', () => {
    const idx = nueva.indexOf('_guardarVentaImpl');
    const cuerpo = nueva.slice(idx, idx + 1200);
    expect(cuerpo).toMatch(/precioVentaUnit \* cantidad/);
    expect(cuerpo).toMatch(/precioCompraUnit \* cantidad/);
    expect(nueva).toMatch(/precioUnitario: precioVentaUnit/);
    expect(nueva).toMatch(/precioCompraUnitario: precioCompraUnit/);
  });

  it('addVenta descuenta N unidades sin dejar stock negativo', () => {
    const idx = db.indexOf('async addVenta');
    const cuerpo = db.slice(idx, idx + 900);
    expect(cuerpo).toMatch(/Math\.min\(cantidad, p\.stock\)/);
    expect(cuerpo).toMatch(/unidadesDescontadas/);
  });

  it('deleteVenta devuelve exactamente las unidades que descontó', () => {
    const idx = db.indexOf('async deleteVenta');
    const cuerpo = db.slice(idx, idx + 600);
    expect(cuerpo).toMatch(/v\.unidadesDescontadas !== undefined/);
  });

  it('updateVenta reconcilia el stock solo si cambió perfume o cantidad', () => {
    const idx = db.indexOf('async updateVenta');
    const cuerpo = db.slice(idx, idx + 1800);
    expect(cuerpo).toMatch(/cambioStock/);
    expect(cuerpo).toMatch(/prevPerfumeId !== nuevoPerfumeId \|\| prevCantidad !== cantidad/);
    expect(cuerpo).toMatch(/Math\.min\(cantidad, p\.stock\)/);
  });

  it('editar prellena cantidad y precios unitarios', () => {
    expect(edit).toMatch(/venta-cantidad'\)\.value = cantOrig/);
    expect(edit).toMatch(/v\.precioUnitario \?\?/);
    expect(edit).toMatch(/cantidad, precioUnitario: precioVentaUnit/);
  });

  it('las ventas viejas sin cantidad valen 1 unidad', () => {
    // El fallback tiene que estar en los tres lugares que leen `cantidad`
    for (const [nombre, src] of [['render', render], ['edit', edit], ['db', db]]) {
      expect(src, nombre).toMatch(/parseInt\((?:v|prev)\.cantidad, 10\) \|\| 1/);
    }
  });

  it('la card muestra el badge ×N solo con más de una unidad', () => {
    expect(render).toMatch(/cant > 1 \?/);
    expect(render).toContain('venta-cant');
    expect(read('src/styles/07-venta-card.css')).toContain('.venta-cant');
  });
});
