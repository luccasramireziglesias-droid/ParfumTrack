// Entrada de datos y derivados: unir ways de OSM, leer GeoJSON, recalcular
// paradas/giros y elegir los tiles a bajar.
//
// Estos módulos corren en el navegador y usan globales (Geo, DB, UI). Acá
// se los inyecta a mano en vez de simular un DOM entero: lo que se prueba
// es aritmética y armado de estructuras, no pintado.

import { describe, it, expect, beforeAll } from 'vitest';
import Geo from '../omnibus/js/00-geo.js';

let Importar, DB, Offline;

beforeAll(async () => {
  globalThis.Geo = Geo;
  DB = (await import('../omnibus/js/01-db.js')).default;
  globalThis.DB = DB;
  globalThis.Mapa = { CAPAS: { noche: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' } } };
  Importar = (await import('../omnibus/js/11-importar.js')).default;
  Offline  = (await import('../omnibus/js/13-offline.js')).default;
});

// ── OSM: unir los ways de una relación ────────────────────────
describe('Importar._unirWays', () => {
  const geo = (pares) => pares.map(([lat, lon]) => ({ lat, lon }));

  it('concatena dos ways ya orientados sin repetir el nodo compartido', () => {
    const puntos = Importar._unirWays([
      { type: 'way', geometry: geo([[-34.82, -55.95], [-34.82, -55.94]]) },
      { type: 'way', geometry: geo([[-34.82, -55.94], [-34.82, -55.93]]) },
    ]);
    expect(puntos).toHaveLength(3);
  });

  it('da vuelta un way digitalizado al revés', () => {
    // El segundo way va de -55.93 a -55.94, o sea en contra del recorrido.
    // Si no se invierte, el trazado vuelve sobre sí mismo y dibuja un
    // diente de sierra de una cuadra entera.
    const puntos = Importar._unirWays([
      { type: 'way', geometry: geo([[-34.82, -55.95], [-34.82, -55.94]]) },
      { type: 'way', geometry: geo([[-34.82, -55.93], [-34.82, -55.94]]) },
    ]);
    expect(puntos[puntos.length - 1][1]).toBeCloseTo(-55.93, 5);
    // Y el largo tiene que ser monótono hacia el este, sin retrocesos.
    for (let i = 1; i < puntos.length; i++) {
      expect(puntos[i][1]).toBeGreaterThan(puntos[i - 1][1]);
    }
  });

  it('ignora los miembros que son paradas, no calles', () => {
    const puntos = Importar._unirWays([
      { type: 'node', role: 'stop', lat: -34.82, lon: -55.95 },
      { type: 'way', role: 'platform', geometry: geo([[-34.80, -55.90], [-34.80, -55.89]]) },
      { type: 'way', role: '', geometry: geo([[-34.82, -55.95], [-34.82, -55.94]]) },
    ]);
    expect(puntos).toHaveLength(2);
  });

  it('devuelve vacío si la relación no tiene ways usables', () => {
    expect(Importar._unirWays([{ type: 'node', role: 'stop', lat: -34.8, lon: -55.9 }])).toEqual([]);
    expect(Importar._unirWays([])).toEqual([]);
  });
});

describe('Importar._aRecorrido', () => {
  const rel = {
    type: 'relation', id: 12345,
    tags: { name: '710 Solymar', ref: '710', from: 'Solymar', to: 'Portones', operator: 'COETC' },
    members: [
      { type: 'way', geometry: [{ lat: -34.82, lon: -55.95 }, { lat: -34.82, lon: -55.94 }] },
      { type: 'node', role: 'stop', lat: -34.82, lon: -55.945, tags: { name: 'Shopping' } },
    ],
  };

  it('arma nombre, línea y sentido desde los tags', () => {
    const r = Importar._aRecorrido(rel);
    expect(r.nombre).toBe('710 Solymar');
    expect(r.linea).toBe('710');
    expect(r.sentido).toBe('Solymar → Portones');
    expect(r.origen).toBe('osm');
  });

  it('rescata las paradas con su nombre', () => {
    const r = Importar._aRecorrido(rel);
    expect(r.paradas).toHaveLength(1);
    expect(r.paradas[0].nombre).toBe('Shopping');
  });

  it('descarta una relación sin geometría usable', () => {
    expect(Importar._aRecorrido({ type: 'relation', id: 1, tags: {}, members: [] })).toBeNull();
  });
});

// ── Archivos ──────────────────────────────────────────────────
describe('Importar._leerGeoJson', () => {
  it('invierte el orden lon,lat de GeoJSON a lat,lng', () => {
    // GeoJSON guarda [longitud, latitud]; el resto de la app usa [lat, lng].
    // Confundirlos manda el recorrido al otro lado del planeta.
    const [r] = Importar._leerGeoJson({
      type: 'LineString',
      coordinates: [[-55.95, -34.82], [-55.94, -34.82]],
    }, 'prueba');
    expect(r.puntos[0]).toEqual([-34.82, -55.95]);
  });

  it('lee una FeatureCollection con línea y paradas', () => {
    const recs = Importar._leerGeoJson({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: '710' },
          geometry: { type: 'LineString', coordinates: [[-55.95, -34.82], [-55.94, -34.82]] } },
        { type: 'Feature', properties: { name: 'Shopping' },
          geometry: { type: 'Point', coordinates: [-55.945, -34.82] } },
      ],
    }, 'prueba');
    expect(recs).toHaveLength(1);
    expect(recs[0].nombre).toBe('710');
    expect(recs[0].paradas).toHaveLength(1);
  });

  it('aplana un MultiLineString en un solo trazado', () => {
    const [r] = Importar._leerGeoJson({
      type: 'MultiLineString',
      coordinates: [[[-55.95, -34.82], [-55.94, -34.82]], [[-55.94, -34.82], [-55.93, -34.82]]],
    }, 'prueba');
    expect(r.puntos).toHaveLength(4);
  });

  it('no devuelve nada si el archivo solo tiene puntos sueltos', () => {
    const recs = Importar._leerGeoJson({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-55.9, -34.8] } }],
    }, 'prueba');
    expect(recs).toHaveLength(0);
  });
});

// ── Derivados del recorrido ───────────────────────────────────
describe('DB.recalcular', () => {
  /** Recorrido en L: 300 m al norte y después 300 m al este. */
  function enEle() {
    const puntos = [];
    for (let d = 0; d <= 300; d += 10) puntos.push([-34.8235 + d / 110574, -55.9560]);
    const esq = puntos[puntos.length - 1];
    for (let d = 10; d <= 300; d += 10) {
      puntos.push([esq[0], esq[1] + d / (111320 * Math.cos(esq[0] * Math.PI / 180))]);
    }
    return puntos;
  }

  it('calcula el largo y ubica cada parada por su avance', () => {
    const rec = DB.recalcular({
      puntos: enEle(),
      paradas: [
        { id: 'p2', lat: -34.8235 + 250 / 110574, lng: -55.9560 },
        { id: 'p1', lat: -34.8235 + 50 / 110574,  lng: -55.9560 },
      ],
      hitos: [],
    });
    expect(rec.largo).toBeGreaterThan(590);
    expect(rec.largo).toBeLessThan(610);
    // Se ordenan por avance, no por el orden en que se cargaron.
    expect(rec.paradas.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(rec.paradas[0].metros).toBeCloseTo(50, -1);
  });

  it('detecta el giro de la esquina solo', () => {
    const rec = DB.recalcular({ puntos: enEle(), paradas: [], hitos: [] });
    const autos = rec.hitos.filter(h => h.auto);
    expect(autos).toHaveLength(1);
    expect(autos[0].tipo).toBe('der');
  });

  it('regenera los giros automáticos pero respeta los escritos a mano', () => {
    // Los automáticos apuntan a esquinas que pueden dejar de existir al
    // editar el trazado; los manuales son información que puso el chofer
    // ("acá hay un badén") y perderlos sería imperdonable.
    const rec = DB.recalcular({
      puntos: enEle(),
      paradas: [],
      hitos: [
        { id: 'h-viejo', lat: -34.8235, lng: -55.9560, tipo: 'izq', auto: true },
        { id: 'h-mio', lat: -34.8235 + 100 / 110574, lng: -55.9560, tipo: 'aviso', texto: 'Badén', auto: false },
      ],
    });
    expect(rec.hitos.find(h => h.id === 'h-viejo')).toBeUndefined();
    expect(rec.hitos.find(h => h.id === 'h-mio').texto).toBe('Badén');
  });

  it('un hito manual tapa al automático que cae encima', () => {
    const puntos = enEle();
    const esq = puntos[30];
    const rec = DB.recalcular({
      puntos, paradas: [],
      hitos: [{ id: 'h-mio', lat: esq[0], lng: esq[1], tipo: 'der', texto: 'Girá en Giannattasio', auto: false }],
    });
    // Uno solo: el manual. Si aparecieran los dos, la app cantaría el giro
    // dos veces en la misma esquina.
    expect(rec.hitos).toHaveLength(1);
    expect(rec.hitos[0].texto).toBe('Girá en Giannattasio');
  });

  it('no explota con un recorrido vacío', () => {
    const rec = DB.recalcular({ puntos: [], paradas: [], hitos: [] });
    expect(rec.largo).toBe(0);
  });
});

// ── Mapas offline ─────────────────────────────────────────────
describe('Offline', () => {
  const rectaLarga = (() => {
    const p = [];
    for (let d = 0; d <= 5000; d += 500) p.push([-34.8235, -55.9560 + d / (111320 * Math.cos(-34.8235 * Math.PI / 180))]);
    return p;
  })();

  it('muestrea la traza a paso fijo, sin importar cómo esté vertexada', () => {
    const m = Offline._muestrear(rectaLarga);
    // 5 km cada 120 m ≈ 42 muestras; los vértices originales eran 11.
    expect(m.length).toBeGreaterThan(35);
    for (let i = 1; i < m.length - 1; i++) {
      expect(Geo.distancia(m[i - 1], m[i])).toBeLessThan(200);
    }
  });

  it('elige el corredor del recorrido y no el rectángulo que lo contiene', () => {
    // Una diagonal de 5 km: la bbox al zoom 16 son miles de tiles, casi
    // todos lejos de la calle. El corredor tiene que ser mucho más chico.
    const diagonal = [];
    for (let i = 0; i <= 40; i++) {
      diagonal.push([-34.8235 + i * 0.001, -55.9560 + i * 0.001]);
    }
    // Se compara zoom contra zoom: el corredor baja los cuatro niveles, así
    // que sumar todo contra una bbox de un solo zoom no diría nada.
    const enZ16 = Offline._tilesDeRecorrido(diagonal).filter(t => t.startsWith('16/'));
    const b = Geo.bbox(diagonal);
    const x = (lon) => Math.floor((lon + 180) / 360 * 2 ** 16);
    const y = (lat) => {
      const r = lat * Math.PI / 180;
      return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** 16);
    };
    const bboxTiles = (Math.abs(x(b.este) - x(b.oeste)) + 1) * (Math.abs(y(b.norte) - y(b.sur)) + 1);
    expect(enZ16.length).toBeLessThan(bboxTiles);
  });

  it('no repite tiles', () => {
    const tiles = Offline._tilesDeRecorrido(rectaLarga);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('cubre los cuatro niveles de zoom', () => {
    const zooms = new Set(Offline._tilesDeRecorrido(rectaLarga).map(t => t.split('/')[0]));
    expect([...zooms].sort()).toEqual(['13', '14', '15', '16']);
  });
});

// ── Copia de seguridad ────────────────────────────────────────
// Los recorridos viven solo en el IndexedDB del teléfono. El backup es la
// única red que hay contra perder el teléfono o limpiar los datos del
// navegador, así que su formato tiene que ser estricto: restaurar basura en
// silencio es peor que fallar con un mensaje.
describe('backup completo', () => {
  const unRecorrido = (id, nombre) => ({
    id, nombre, linea: '710', puntos: [[-34.82, -55.95], [-34.81, -55.95]],
    paradas: [], hitos: [],
  });

  it('el ida y vuelta conserva los recorridos', () => {
    const originales = [unRecorrido('r1', '710 ida'), unRecorrido('r2', '710 vuelta')];
    const leidos = Importar.leerBackup(JSON.stringify(Importar.armarBackup(originales)));
    expect(leidos).toHaveLength(2);
    expect(leidos[0].nombre).toBe('710 ida');
    expect(leidos[1].puntos).toEqual(originales[1].puntos);
  });

  it('el archivo se identifica a sí mismo', () => {
    const b = Importar.armarBackup([unRecorrido('r1', 'x')]);
    expect(b.formato).toBe('recorridos-backup');
    expect(b.version).toBe(1);
    expect(b.cantidad).toBe(1);
  });

  it('rechaza un JSON que no es una copia de recorridos', () => {
    expect(() => Importar.leerBackup('{"hola":1}')).toThrow(/no es una copia de recorridos/);
  });

  it('rechaza algo que ni siquiera es JSON', () => {
    expect(() => Importar.leerBackup('esto no es json')).toThrow(/no es un JSON válido/);
  });

  it('rechaza una copia sin ningún recorrido con trazado', () => {
    const vacio = { formato: 'recorridos-backup', version: 1, recorridos: [{ nombre: 'sin puntos' }] };
    expect(() => Importar.leerBackup(JSON.stringify(vacio))).toThrow(/ningún recorrido con trazado/);
  });

  it('descarta los recorridos rotos pero conserva los sanos', () => {
    // Un archivo a medio escribir no puede tirar abajo la restauración
    // entera: lo que se pueda salvar, se salva.
    const mezcla = {
      formato: 'recorridos-backup', version: 1,
      recorridos: [unRecorrido('r1', 'bueno'), { nombre: 'roto' }, { nombre: 'roto2', puntos: [] }],
    };
    const leidos = Importar.leerBackup(JSON.stringify(mezcla));
    expect(leidos).toHaveLength(1);
    expect(leidos[0].nombre).toBe('bueno');
  });
});
