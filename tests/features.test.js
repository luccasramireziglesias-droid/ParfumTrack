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

describe('F2 — recordatorios de cobro', () => {
  const rec = read('src/app/20-recordatorios.js');
  const render = read('src/app/02-render.js');
  const core = read('src/app/00-core.js');
  const inicio = read('src/screens/inicio.html');
  const index = read('index.html');

  it('la tarjeta de recordatorios está en el dashboard y en el build', () => {
    expect(inicio).toContain('id="dashboard-recordatorios"');
    expect(inicio).toContain('id="dashboard-recordatorios-list"');
    expect(index).toContain('id="dashboard-recordatorios"');
    expect(index).toContain('.recordatorios-card');
  });

  it('clasifica por vencidas / hoy / próximas dentro del horizonte', () => {
    const idx = rec.indexOf('_cobrosPendientes()');
    const cuerpo = rec.slice(idx, idx + 1200);
    expect(cuerpo).toMatch(/dias < 0/);
    expect(cuerpo).toMatch(/dias === 0/);
    expect(cuerpo).toMatch(/dias <= this\._RECORDATORIO_HORIZONTE/);
  });

  it('ignora las cuotas pagadas y las que ya no tienen saldo', () => {
    const idx = rec.indexOf('_cobrosPendientes()');
    const cuerpo = rec.slice(idx, idx + 1200);
    expect(cuerpo).toMatch(/if \(c\.pagado\) continue/);
    expect(cuerpo).toMatch(/if \(resta <= 0\) continue/);
  });

  it('compara fechas a medianoche local (no cuenta horas de diferencia)', () => {
    const idx = rec.indexOf('_diasHasta(ts)');
    const cuerpo = rec.slice(idx, idx + 250);
    expect(cuerpo).toMatch(/setHours\(0, 0, 0, 0\)/);
    expect(rec).toMatch(/_hoyTs\(\)[\s\S]{0,150}setHours\(0, 0, 0, 0\)/);
  });

  it('ordena por vencimiento y muestra primero lo vencido', () => {
    expect(rec).toMatch(/out\.vencidas\.sort\(porFecha\)/);
    expect(rec).toMatch(/\[\.\.\.vencidas, \.\.\.hoy, \.\.\.proximas\]/);
  });

  it('cada fila trae WhatsApp y cobro con los handlers delegados existentes', () => {
    expect(rec).toMatch(/class="btn-whatsapp recordatorio-btn" data-msg=/);
    expect(rec).toMatch(/class="btn-pay recordatorio-btn" data-cuota-id=/);
    // El id viaja percent-encoded, igual que en la pantalla de cuotas
    expect(rec).toMatch(/encodeURIComponent\(JSON\.stringify\(cuota\.id\)\)/);
  });

  it('el mensaje de WhatsApp se escapa vía base64 UTF-8 (soporta emojis)', () => {
    expect(rec).toMatch(/this\.b64Encode\(this\._mensajeRecordatorio\(item\)\)/);
  });

  it('el badge del nav se marca urgente solo con vencidas o de hoy', () => {
    // La DEFINICIÓN, no la llamada desde renderRecordatorios
    const idx = rec.indexOf('\n  _actualizarBadgeCuotas(urgentes) {');
    const cuerpo = rec.slice(idx, idx + 500);
    expect(cuerpo).toMatch(/classList\.toggle\('urgente'/);
    expect(read('src/styles/21-recordatorios.css')).toContain('.nav-badge.urgente');
    // Un solo lugar actualiza el badge: no hay copias desincronizadas
    expect(render).not.toMatch(/badge\.textContent = pendientes\.length/);
  });

  it('el dashboard y la pantalla de cuotas usan el mismo cálculo', () => {
    expect(render).toMatch(/this\.renderRecordatorios\(\)/);
    expect(render).toMatch(/this\._cobrosPendientes\(\)/);
  });

  it('el aviso del día se muestra una sola vez por jornada', () => {
    const idx = rec.indexOf('_avisoCobrosDelDia()');
    const cuerpo = rec.slice(idx, idx + 700);
    expect(cuerpo).toMatch(/pt_recordatorio_visto/);
    expect(cuerpo).toMatch(/=== hoyClave\) return/);
    expect(core).toMatch(/this\._avisoCobrosDelDia\(\)/);
  });
});

describe('Service Worker — recarga por actualización', () => {
  const tpl = read('src/index.template.html');
  const index = read('index.html');

  it('no recarga en la primera visita (cuando el SW recién hace claim)', () => {
    const idx = tpl.indexOf("addEventListener('controllerchange'");
    expect(idx, 'handler de controllerchange').toBeGreaterThan(-1);
    const cuerpo = tpl.slice(idx, idx + 500);
    expect(cuerpo).toMatch(/!ptTeniaController/);
    expect(tpl).toMatch(/const ptTeniaController = !!navigator\.serviceWorker\.controller/);
    // Se evalúa ANTES de registrar el SW, si no siempre daría true
    expect(tpl.indexOf('ptTeniaController =')).toBeLessThan(tpl.indexOf("addEventListener('controllerchange'"));
  });

  it('no recarga encima de un formulario a medio llenar', () => {
    const idx = tpl.indexOf("addEventListener('controllerchange'");
    expect(tpl.slice(idx, idx + 500)).toMatch(/_hayTrabajoEnCurso\(\)/);
  });

  it('el build incorpora la guarda', () => {
    expect(index).toMatch(/ptTeniaController/);
  });
});
