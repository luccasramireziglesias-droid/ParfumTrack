// Importador de GTFS: lector de ZIP, CSV y armado de recorridos.
//
// El feed metropolitano real pesa cientos de MB descomprimido y no se puede
// meter en el repo, así que acá se fabrica un GTFS sintético con las mismas
// trampas que traen los feeds de verdad: filas desordenadas, nombres de
// parada con comas adentro, varios viajes por línea y alguna línea sin
// geometría.

import { describe, it, expect, beforeAll } from 'vitest';
import zlib from 'zlib';

let GTFS;

beforeAll(async () => {
  // GTFS.leer usa Blob.stream(), DecompressionStream y TextDecoderStream:
  // los tres existen en Node 18+, así que corre igual que en el navegador.
  globalThis.DB = { nuevoId: (p = 'x') => `${p}_${Math.random().toString(36).slice(2, 8)}` };
  GTFS = (await import('../omnibus/js/15-gtfs.js')).default;
});

// ── Generador de ZIP ──────────────────────────────────────────
/** Arma un .zip real (deflate crudo + directorio central) desde {nombre: texto}. */
function armarZip(archivos, { comprimir = true } = {}) {
  const locales = [], central = [];
  let off = 0;

  for (const [nombre, texto] of Object.entries(archivos)) {
    const crudo = Buffer.from(texto, 'utf8');
    const datos = comprimir ? zlib.deflateRawSync(crudo) : crudo;
    const metodo = comprimir ? 8 : 0;
    const crc = zlib.crc32 ? zlib.crc32(crudo) : crc32(crudo);
    const nom = Buffer.from(nombre, 'utf8');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(metodo, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(datos.length, 18);
    lh.writeUInt32LE(crudo.length, 22);
    lh.writeUInt16LE(nom.length, 26);
    locales.push(lh, nom, datos);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(metodo, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(datos.length, 20);
    ch.writeUInt32LE(crudo.length, 24);
    ch.writeUInt16LE(nom.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, nom);

    off += lh.length + nom.length + datos.length;
  }

  const cuerpo = Buffer.concat(locales);
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(archivos).length, 8);
  eocd.writeUInt16LE(Object.keys(archivos).length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(cuerpo.length, 16);

  const total = Buffer.concat([cuerpo, dir, eocd]);
  return total.buffer.slice(total.byteOffset, total.byteOffset + total.byteLength);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Feed de prueba ────────────────────────────────────────────
const FEED = {
  'agency.txt': 'agency_id,agency_name\nA1,COETC\nA2,Otra Empresa\n',

  'routes.txt': [
    'route_id,agency_id,route_short_name,route_long_name,route_color',
    'R710,A1,710,Solymar - Portones,35c78a',
    'R196,A1,196,Pando - Barros Blancos,',
    'RX,A2,999,Linea de otra empresa,',
  ].join('\n') + '\n',

  // Varios viajes por línea y sentido: un feed real trae uno por horario y
  // todos comparten el trazado. El importador tiene que quedarse con uno.
  'trips.txt': [
    'route_id,trip_id,shape_id,direction_id,trip_headsign',
    'R710,T1,S710I,0,A Portones',
    'R710,T2,S710I,0,A Portones',
    'R710,T3,S710V,1,A Solymar',
    'R196,T4,,0,A Barros Blancos',      // sin shape a propósito
    'RX,T9,SX,0,Otra',
  ].join('\n') + '\n',

  // Secuencias desordenadas: el orden de las filas del archivo no manda.
  'shapes.txt': [
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
    'S710I,-34.8215,-55.9560,2',
    'S710I,-34.8235,-55.9560,1',
    'S710I,-34.8215,-55.9500,3',
    'S710V,-34.8215,-55.9500,1',
    'S710V,-34.8235,-55.9560,2',
    'SX,-34.7000,-55.9000,1',
    'SX,-34.7100,-55.9000,2',
  ].join('\n') + '\n',

  // Nombre con coma adentro, entre comillas: si el parser parte por coma a
  // secas, corre todas las columnas y la parada aterriza en cualquier lado.
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon',
    'P1,"Giannattasio esq. Racine, Lagomar",-34.8230,-55.9560',
    'P2,Shopping Costa Urbana,-34.8220,-55.9560',
    'P3,Terminal Portones,-34.8215,-55.9505',
    'P4,Plaza Pando,-34.7200,-55.9500',
    'P5,Barros Blancos,-34.7100,-55.9400',
  ].join('\n') + '\n',

  'stop_times.txt': [
    'trip_id,stop_id,stop_sequence,arrival_time,departure_time',
    'T1,P3,3,08:20:00,08:20:00',
    'T1,P1,1,08:00:00,08:00:00',
    'T1,P2,2,08:10:00,08:10:00',
    'T3,P3,1,09:00:00,09:00:00',
    'T3,P1,2,09:20:00,09:20:00',
    'T4,P4,1,07:00:00,07:00:00',
    'T4,P5,2,07:30:00,07:30:00',
    'T9,P4,1,06:00:00,06:00:00',
  ].join('\n') + '\n',
};

describe('partirCsv', () => {
  it('respeta las comas que van adentro de comillas', () => {
    expect(GTFS.partirCsv('P1,"Giannattasio esq. Racine, Lagomar",-34.82'))
      .toEqual(['P1', 'Giannattasio esq. Racine, Lagomar', '-34.82']);
  });

  it('entiende la comilla escapada como doble comilla', () => {
    expect(GTFS.partirCsv('a,"dice ""hola""",b')).toEqual(['a', 'dice "hola"', 'b']);
  });

  it('deja vacíos los campos vacíos', () => {
    expect(GTFS.partirCsv('a,,c')).toEqual(['a', '', 'c']);
  });
});

describe('lector de ZIP', () => {
  it('encuentra las entradas de un zip comprimido', () => {
    const zip = GTFS.abrirZip(armarZip(FEED));
    expect([...zip.entradas.keys()].sort()).toEqual(
      ['agency.txt', 'routes.txt', 'shapes.txt', 'stop_times.txt', 'stops.txt', 'trips.txt']);
  });

  it('también lee un zip sin comprimir', () => {
    const zip = GTFS.abrirZip(armarZip(FEED, { comprimir: false }));
    expect(zip.entradas.has('routes.txt')).toBe(true);
  });

  it('rechaza algo que no es un zip', () => {
    const basura = new TextEncoder().encode('esto no es un zip para nada').buffer;
    expect(() => GTFS.abrirZip(basura)).toThrow(/no parece un \.zip/);
  });
});

describe('GTFS.leer', () => {
  it('arma un recorrido por línea y sentido, no uno por horario', async () => {
    // T1 y T2 son el mismo recorrido en distinto horario: tiene que salir uno.
    const { recorridos } = await GTFS.leer(armarZip(FEED), { empresa: 'COETC' });
    expect(recorridos).toHaveLength(3);   // 710 ida, 710 vuelta, 196 ida
    expect(recorridos.filter(r => r.linea === '710')).toHaveLength(2);
  });

  it('ordena los puntos del trazado por shape_pt_sequence', async () => {
    const { recorridos } = await GTFS.leer(armarZip(FEED), { empresa: 'COETC' });
    const ida = recorridos.find(r => r.linea === '710' && r.sentido === 'A Portones');
    expect(ida.puntos).toEqual([
      [-34.8235, -55.9560],
      [-34.8215, -55.9560],
      [-34.8215, -55.9500],
    ]);
  });

  it('trae las paradas en el orden del viaje, no en el del archivo', async () => {
    const { recorridos } = await GTFS.leer(armarZip(FEED), { empresa: 'COETC' });
    const ida = recorridos.find(r => r.sentido === 'A Portones');
    expect(ida.paradas.map(p => p.nombre)).toEqual([
      'Giannattasio esq. Racine, Lagomar',
      'Shopping Costa Urbana',
      'Terminal Portones',
    ]);
  });

  it('la vuelta tiene su propio trazado y sus paradas al revés', async () => {
    const { recorridos } = await GTFS.leer(armarZip(FEED), { empresa: 'COETC' });
    const vuelta = recorridos.find(r => r.sentido === 'A Solymar');
    expect(vuelta.puntos[0]).toEqual([-34.8215, -55.9500]);
    expect(vuelta.paradas.map(p => p.nombre)).toEqual([
      'Terminal Portones',
      'Giannattasio esq. Racine, Lagomar',
    ]);
  });

  it('avisa cuando una línea viene sin geometría y usa las paradas', async () => {
    // Sin shapes, el trazado son rectas de parada a parada: sirve para
    // ubicarse, NO para guiar. Si eso pasa callado, el chofer se entera
    // manejando.
    const { recorridos } = await GTFS.leer(armarZip(FEED), { empresa: 'COETC' });
    const r196 = recorridos.find(r => r.linea === '196');
    expect(r196._sinShape).toBe(true);
    expect(r196.puntos).toHaveLength(2);
    expect(r196.notas).toMatch(/NO sigue las calles/);
  });

  it('filtra por empresa y deja afuera las otras', async () => {
    const { recorridos } = await GTFS.leer(armarZip(FEED), { empresa: 'COETC' });
    expect(recorridos.some(r => r.linea === '999')).toBe(false);
  });

  it('sin filtro trae todas las empresas', async () => {
    const { recorridos } = await GTFS.leer(armarZip(FEED), { empresa: '' });
    expect(recorridos).toHaveLength(4);
  });

  it('si la empresa no existe, devuelve la lista de las que sí para poder corregir', async () => {
    const { recorridos, agencias, totalRutas } = await GTFS.leer(armarZip(FEED), { empresa: 'NoExiste' });
    expect(recorridos).toHaveLength(0);
    expect(agencias).toContain('COETC');
    expect(totalRutas).toBe(3);
  });

  it('cae al nombre de la línea cuando el feed tiene una sola agencia', async () => {
    // Caso real y frecuente: el feed metropolitano mete todas las empresas
    // bajo una agencia sola ("STM"), y lo único que las distingue es el
    // nombre de la línea.
    const unaSola = {
      ...FEED,
      'agency.txt': 'agency_id,agency_name\nA1,STM\n',
      'routes.txt': [
        'route_id,agency_id,route_short_name,route_long_name,route_color',
        'R710,A1,710,COETC Solymar - Portones,',
        'RX,A1,999,Otra empresa,',
      ].join('\n') + '\n',
    };
    const { recorridos } = await GTFS.leer(armarZip(unaSola), { empresa: 'coetc' });
    expect(recorridos.every(r => r.linea === '710')).toBe(true);
    expect(recorridos.length).toBeGreaterThan(0);
  });

  it('el filtro no distingue mayúsculas', async () => {
    const a = await GTFS.leer(armarZip(FEED), { empresa: 'coetc' });
    const b = await GTFS.leer(armarZip(FEED), { empresa: 'COETC' });
    expect(a.recorridos.length).toBe(b.recorridos.length);
  });

  it('rechaza un zip que no es un GTFS', async () => {
    const zip = armarZip({ 'cualquiera.txt': 'hola\n' });
    await expect(GTFS.leer(zip)).rejects.toThrow(/no parece un GTFS/);
  });

  it('funciona sin stop_times ni stops, quedándose con la geometría', async () => {
    // Algunos feeds recortados solo traen shapes. La geometría es lo
    // imprescindible; las paradas son un extra.
    const { 'stop_times.txt': _a, 'stops.txt': _b, ...recortado } = FEED;
    const { recorridos } = await GTFS.leer(armarZip(recortado), { empresa: 'COETC' });
    const ida = recorridos.find(r => r.sentido === 'A Portones');
    expect(ida.puntos).toHaveLength(3);
    expect(ida.paradas).toHaveLength(0);
  });

  it('informa el progreso para que la pantalla no parezca colgada', async () => {
    const avisos = [];
    await GTFS.leer(armarZip(FEED), { empresa: 'COETC', avisar: (t) => avisos.push(t) });
    expect(avisos.length).toBeGreaterThan(2);
    expect(avisos.join(' ')).toMatch(/geometría|paradas/i);
  });
});
