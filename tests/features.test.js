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

describe('F3 — devoluciones y cambios', () => {
  const dev = read('src/app/22-devoluciones.js');
  const db = read('src/db.js');
  const render = read('src/app/02-render.js');
  const datos = read('src/app/10-data-management.js');
  const clientes = read('src/app/18-clientes.js');
  const tpl = read('src/index.template.html');
  const index = read('index.html');

  it('el modal de devolución existe y llega al build', () => {
    expect(tpl).toContain('id="modal-devolucion"');
    expect(tpl).toContain('id="devolucion-repone-stock"');
    expect(tpl).toContain('id="devolucion-motivos"');
    expect(index).toContain('id="modal-devolucion"');
    expect(read('src/styles/22-devoluciones.css')).toContain('.tag-devuelta');
  });

  it('la venta NO se borra: se marca como devuelta con motivo y fecha', () => {
    const idx = db.indexOf('async devolverVenta');
    const cuerpo = db.slice(idx, idx + 2000);
    expect(cuerpo).toMatch(/devuelta: true/);
    expect(cuerpo).toMatch(/fechaDevolucion: Date\.now\(\)/);
    expect(cuerpo).toMatch(/motivoDevolucion: motivo/);
    // Nunca borra el registro
    expect(cuerpo).not.toMatch(/this\.delete\('ventas'/);
  });

  it('no se puede devolver dos veces (el stock se repondría de más)', () => {
    const idx = db.indexOf('async devolverVenta');
    expect(db.slice(idx, idx + 400)).toMatch(/if \(v\.devuelta\) throw new Error\('YA_DEVUELTA'\)/);
    expect(dev).toMatch(/_once\('devolucion'/);
  });

  it('repone exactamente las unidades que la venta descontó', () => {
    const idx = db.indexOf('async devolverVenta');
    const cuerpo = db.slice(idx, idx + 2000);
    expect(cuerpo).toMatch(/v\.unidadesDescontadas !== undefined/);
    expect(cuerpo).toMatch(/p\.stock = \(p\.stock \|\| 0\) \+ unidades/);
    expect(cuerpo).toMatch(/unidadesRepuestas: repuestas/);
  });

  it('cancela las cuotas impagas y conserva las cobradas', () => {
    const idx = db.indexOf('async devolverVenta');
    const cuerpo = db.slice(idx, idx + 2000);
    expect(cuerpo).toMatch(/if \(pagado > 0\)/);
    expect(cuerpo).toMatch(/await this\.delete\('cuotas', c\.id\)/);
    expect(cuerpo).toMatch(/montoADevolver: cobrado/);
  });

  it('deshacer la devolución vuelve a descontar sin dejar stock negativo', () => {
    const idx = db.indexOf('async revertirDevolucion');
    const cuerpo = db.slice(idx, idx + 1200);
    expect(cuerpo).toMatch(/Math\.min\(repuestas, p\.stock \|\| 0\)/);
    expect(cuerpo).toMatch(/delete limpia\.devuelta/);
    expect(dev).toMatch(/revertirDevolucion\(id\)/);
  });

  it('las ventas devueltas no cuentan para ganancia, stats ni clientes', () => {
    expect(dev).toMatch(/_ventasActivas\(\)[\s\S]{0,120}filter\(v => !v\.devuelta\)/);
    // Todas las agregaciones pasan por el helper
    const agregaciones = render.match(/this\.ventas\.filter\(/g) || [];
    expect(agregaciones, 'quedan agregaciones sin filtrar devueltas').toHaveLength(0);
    expect(datos).toMatch(/const activas = this\._ventasActivas\(\)/);
    expect(clientes).toMatch(/for \(const v of this\._ventasActivas\(\)\)/);
  });

  it('la card marca la venta devuelta y ofrece deshacer en vez de editar', () => {
    expect(render).toMatch(/tag-devuelta/);
    expect(render).toMatch(/venta-card devuelta|\$\{cls\} devuelta/);
    expect(render).toMatch(/App\.revertirDevolucion/);
    expect(render).toMatch(/App\.abrirDevolucion/);
    // La ganancia de una venta devuelta no se muestra como si fuera real
    expect(render).toMatch(/devuelta \? '—' : this\.fmtSigned\(gan\)/);
  });

  it('el Excel exporta el estado y la ganancia en 0 de las devueltas', () => {
    expect(datos).toMatch(/Estado: v\.devuelta \?/);
    expect(datos).toMatch(/Ganancia: v\.devuelta \? 0 :/);
  });

  it('un cambio deja el form listo con el mismo cliente', () => {
    expect(dev).toMatch(/const esCambio = motivo === 'Cambio por otro'/);
    expect(dev).toMatch(/showScreen\('nueva-venta'\)/);
  });
});

describe('F4 — compras al proveedor', () => {
  const compras = read('src/app/23-compras.js');
  const db = read('src/db.js');
  const render = read('src/app/02-render.js');
  const core = read('src/app/00-core.js');
  const datos = read('src/app/10-data-management.js');
  const tpl = read('src/index.template.html');
  const stock = read('src/screens/stock.html');
  const index = read('index.html');

  it('la base sube a v4 y crea el store compras sin romper los existentes', () => {
    expect(tpl).toMatch(/const DB_VERSION = 4;/);
    expect(tpl).toMatch(/if \(!d\.objectStoreNames\.contains\('compras'\)\)/);
    // La migración es aditiva: ningún store se borra ni se recrea
    expect(tpl).not.toMatch(/deleteObjectStore/);
    expect(index).toMatch(/const DB_VERSION = 4;/);
  });

  it('las compras se guardan encriptadas como el resto de los datos', () => {
    expect(db).toMatch(/_encryptedStores: new Set\(\[[^\]]*'compras'/);
  });

  it('registrarCompra valida cantidad y precio antes de tocar el stock', () => {
    const idx = db.indexOf('async registrarCompra');
    const cuerpo = db.slice(idx, idx + 900);
    expect(cuerpo).toMatch(/throw new Error\('CANTIDAD_INVALIDA'\)/);
    expect(cuerpo).toMatch(/throw new Error\('PRECIO_INVALIDO'\)/);
    expect(cuerpo).toMatch(/throw new Error\('PERFUME_NO_ENCONTRADO'\)/);
  });

  it('la compra suma al stock y deja el costo real de la tanda', () => {
    const idx = db.indexOf('async registrarCompra');
    const cuerpo = db.slice(idx, idx + 1600);
    expect(cuerpo).toMatch(/p\.stock = \(p\.stock \|\| 0\) \+ cant/);
    expect(cuerpo).toMatch(/if \(actualizarCosto && precio > 0\) p\.precioCompra = precio/);
    expect(cuerpo).toMatch(/total: precio \* cant/);
  });

  it('borrar una compra no deja el stock en negativo', () => {
    const idx = db.indexOf('async eliminarCompra');
    expect(db.slice(idx, idx + 500)).toMatch(/Math\.max\(0, \(p\.stock \|\| 0\) - \(c\.cantidad \|\| 0\)\)/);
  });

  it('el alta tiene guarda anti doble-tap', () => {
    expect(compras).toMatch(/_once\('compra'/);
  });

  it('el modal y el botón Reponer existen y llegan al build', () => {
    expect(tpl).toContain('id="modal-compra"');
    expect(tpl).toContain('id="compra-actualiza-costo"');
    expect(render).toMatch(/App\.abrirCompra\(\$\{p\.id\}\)/);
    expect(stock).toContain('id="stock-compras-list"');
    expect(index).toContain('id="modal-compra"');
    expect(read('src/styles/23-compras.css')).toContain('.stock-reponer');
  });

  it('las compras se cargan al arrancar y viajan en backup, export y borrado', () => {
    expect(core).toMatch(/this\.comprasData = await DB\.getCompras\(\)/);
    expect(datos).toMatch(/compras: this\.comprasData/);
    // Todas las listas de stores incluyen compras: si no, un restore las perdería
    const listas = datos.match(/const stores = \[[^\]]+\]/g) || [];
    expect(listas.length).toBeGreaterThan(0);
    for (const l of listas) expect(l, l).toContain("'compras'");
  });

  it('el listado de compras se rinde también con el stock vacío', () => {
    // La DEFINICIÓN, no la llamada desde renderAll()
    const idx = render.indexOf('\n  renderStock() {');
    const cuerpo = render.slice(idx, idx + 3000);
    // Dos llamadas: la del early-return por lista vacía y la del final
    expect((cuerpo.match(/this\.renderCompras\(\)/g) || []).length).toBe(2);
  });
});
