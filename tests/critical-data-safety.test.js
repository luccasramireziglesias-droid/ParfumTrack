// Protege los 3 bugs críticos de pérdida de acceso / pérdida de datos
// encontrados en la auditoría multi-agente. Si alguien revierte estos fixes,
// estos tests fallan en CI antes del deploy.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('Bloqueo permanente por PIN (pérdida de acceso a los datos)', () => {
  const pin = read('src/app/14-pin-lock.js');

  it('guarda el hash del PIN en localStorage, no en sessionStorage', () => {
    // sessionStorage se borra al cerrar la app: si el hash viviera ahí, al
    // reabrir no habría con qué comparar y ningún PIN funcionaría jamás.
    expect(pin).toMatch(/localStorage\.setItem\(['"]pt_pin_hash['"]/);
    expect(pin).not.toMatch(/sessionStorage\.setItem\(['"]pt_pin_hash['"]/);
  });

  it('hace fail-open si el flag está activo pero no hay hash', () => {
    // Recupera a los usuarios que ya quedaron bloqueados por el bug anterior
    expect(pin).toMatch(/pinEnabled\s*&&\s*!savedHash/);
    expect(pin).toMatch(/removeItem\(['"]pt_pin_enabled['"]\)/);
  });

  it('al desactivar el PIN limpia el hash de localStorage', () => {
    expect(pin).toMatch(/localStorage\.removeItem\(['"]pt_pin_hash['"]\)/);
  });
});

describe('Restore destructivo (pérdida total del historial)', () => {
  const dm = read('src/app/10-data-management.js');

  it('valida el payload ANTES de borrar los stores', () => {
    // _restoreData hace DB.clear() de 7 stores; si el payload viene vacío el
    // usuario perdería todo sin recibir nada a cambio.
    expect(dm).toContain('_assertRestorable');
    const idx = dm.indexOf('async _restoreData');
    const cuerpo = dm.slice(idx, idx + 600);
    const posAssert = cuerpo.indexOf('_assertRestorable');
    const posClear = cuerpo.indexOf('DB.clear');
    expect(posAssert, 'la validación debe existir dentro de _restoreData').toBeGreaterThan(-1);
    expect(posAssert, 'la validación debe ir ANTES del primer clear').toBeLessThan(posClear);
  });

  it('la guarda rechaza un payload sin ningún registro', () => {
    expect(dm).toMatch(/registros\s*===\s*0/);
  });
});

describe('Re-inyección de datos demo sobre datos reales', () => {
  const db = read('src/db.js');

  it('seedDemo solo siembra una vez gracias a un flag persistente', () => {
    // Sin el flag, borrar los datos hacía reaparecer 8 perfumes y 13 ventas falsas
    expect(db).toMatch(/pt_demo_seeded/);
    const idx = db.indexOf('async seedDemo');
    const cuerpo = db.slice(idx, idx + 700);
    expect(cuerpo).toMatch(/getItem\(['"]pt_demo_seeded['"]\)\s*===\s*['"]1['"]/);
    expect(cuerpo).toMatch(/setItem\(['"]pt_demo_seeded['"]/);
  });

  it('tampoco siembra si ya existen ventas del usuario', () => {
    const idx = db.indexOf('async seedDemo');
    const cuerpo = db.slice(idx, idx + 700);
    expect(cuerpo).toMatch(/ventas\.length\s*>\s*0/);
  });
});

describe('Ganancia neta: los gastos del negocio impactan el resultado', () => {
  const render = read('src/app/02-render.js');

  it('el dashboard calcula la neta restando los gastos del mes', () => {
    expect(render).toContain('gastosMes');
    expect(render).toMatch(/ganancia\s*-\s*gastosMes/);
  });

  it('el gráfico de stats usa gastos reales, no el costo de mercadería', () => {
    // Antes: const gastos = thisMonth.reduce((s,v) => s + v.precioCompra, 0)
    const idx = render.indexOf('const gastos =');
    const linea = render.slice(idx, idx + 200);
    expect(linea).toContain('gastosData');
    expect(linea).not.toMatch(/precioCompra/);
  });
});
