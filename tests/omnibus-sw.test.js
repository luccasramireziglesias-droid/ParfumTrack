// El service worker de la app de recorridos.
//
// El caso del píxel de respaldo justifica todo este archivo: el blob que
// estaba puesto era un verde a media transparencia en vez de un píxel
// invisible, así que sin señal el mapa se pintaba entero de verde. No
// tiraba ningún error, no había log, la imagen "cargaba" bien. La única
// forma de que algo así no vuelva a pasar es decodificar el blob y mirarle
// los bytes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import zlib from 'zlib';

const sw = readFileSync(path.join(import.meta.dirname, '..', 'omnibus', 'sw.js'), 'utf8');

/** Decodifica un PNG de 1×1 y devuelve sus canales. */
function pixelDe(base64) {
  const buf = Buffer.from(base64, 'base64');
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  let off = 8, idat = [], ihdr = null;
  while (off < buf.length) {
    const largo = buf.readUInt32BE(off);
    const tipo = buf.toString('ascii', off + 4, off + 8);
    const datos = buf.subarray(off + 8, off + 8 + largo);
    if (tipo === 'IHDR') {
      ihdr = { ancho: datos.readUInt32BE(0), alto: datos.readUInt32BE(4), bits: datos[8], tipoColor: datos[9] };
    }
    if (tipo === 'IDAT') idat.push(datos);
    off += 12 + largo;
  }
  const crudo = zlib.inflateSync(Buffer.concat(idat));
  // Scanline de un PNG: un byte de filtro y después los canales del píxel.
  return { ihdr, filtro: crudo[0], canales: Array.from(crudo.subarray(1)) };
}

describe('píxel de respaldo de los tiles', () => {
  const encontrado = sw.match(/atob\('([A-Za-z0-9+/=]+)'\)/);

  it('está definido en el service worker', () => {
    expect(encontrado).not.toBeNull();
  });

  it('es un PNG de 1×1 con canal alfa', () => {
    const { ihdr } = pixelDe(encontrado[1]);
    expect(ihdr.ancho).toBe(1);
    expect(ihdr.alto).toBe(1);
    expect(ihdr.bits).toBe(8);
    expect(ihdr.tipoColor).toBe(6);   // 6 = RGBA; sin alfa no puede ser invisible
  });

  it('es COMPLETAMENTE transparente', () => {
    // El bug original: alfa 127 y verde 255. Leaflet estira el tile a
    // 256×256, así que cualquier alfa distinto de 0 tiñe el mapa entero.
    const { canales } = pixelDe(encontrado[1]);
    expect(canales).toHaveLength(4);
    expect(canales[3]).toBe(0);
  });
});

describe('cachés', () => {
  it('la caché de tiles NO lleva la versión de la app en el nombre', () => {
    // Si el nombre incluyera la versión, cada actualización tiraría los
    // mapas offline que el usuario bajó con sus datos móviles.
    const linea = sw.match(/const CACHE_TILES\s*=\s*'([^']+)'/);
    expect(linea).not.toBeNull();
    expect(linea[1]).not.toMatch(/\$\{|APP_VERSION/);
  });

  it('la caché de la app SÍ la lleva, para que una versión nueva reemplace a la vieja', () => {
    expect(sw).toMatch(/const CACHE_APP\s*=\s*`[^`]*\$\{APP_VERSION\}/);
  });

  it('al activarse solo borra cachés viejas de la app, nunca las de tiles', () => {
    const activate = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf("addEventListener('fetch'"));
    expect(activate).toMatch(/startsWith\('recorridos-app-'\)/);
    expect(activate).not.toMatch(/CACHE_TILES|tiles-v/);
  });
});

describe('precache', () => {
  it('no usa addAll, que es todo-o-nada', () => {
    // Con addAll, un solo 404 deja la app SIN nada cacheado y sin abrir
    // offline, en silencio.
    expect(sw).not.toMatch(/\.addAll\(/);
  });

  it('lista el index, el CSS y Leaflet', () => {
    for (const archivo of ['./index.html', './css/app.css', './vendor/leaflet.js', './vendor/leaflet.css']) {
      expect(sw).toContain(`'${archivo}'`);
    }
  });
});
