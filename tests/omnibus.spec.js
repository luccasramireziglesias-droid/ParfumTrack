// E2E de la app de recorridos (/omnibus/).
//
// Lo que importa verificar de punta a punta es la cadena completa: un
// recorrido guardado tiene que producir una hoja de ruta, y el modo manejo
// tiene que reaccionar a las posiciones del GPS con el aviso correcto. Los
// fixes se inyectan a mano — esperar un GPS real en CI no es una opción.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// Los tiles salen a internet: en CI no hay red y cada uno suma segundos de
// espera. El mapa se dibuja igual, que es lo único que se está probando.
async function sinTiles(page) {
  await page.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/, r => r.abort());
}

/** Recorrido en L: 300 m al norte, esquina a la derecha, 300 m al este. */
function recorridoEnEle() {
  const lat0 = -34.8235, lng0 = -55.9560;
  const mLat = 110574, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  const puntos = [];
  for (let d = 0; d <= 300; d += 10) puntos.push([lat0 + d / mLat, lng0]);
  const esq = puntos[puntos.length - 1];
  for (let d = 10; d <= 300; d += 10) puntos.push([esq[0], esq[1] + d / mLon]);
  return {
    nombre: '710 Solymar → Portones',
    linea: '710', sentido: 'Solymar → Portones', origen: 'dibujado', color: '#35c78a',
    puntos,
    // Seis paradas y no dos: un recorrido real tiene decenas, y el modo
    // test necesita al menos cuatro para poder armar opciones que no se
    // contesten solas. Con un fixture chico la prueba mediría otra cosa.
    paradas: [
      { id: 'p1', lat: lat0 + 100 / mLat, lng: lng0, nombre: 'Shopping Costa Urbana' },
      { id: 'p2', lat: lat0 + 180 / mLat, lng: lng0, nombre: 'Escuela 118' },
      { id: 'p3', lat: lat0 + 260 / mLat, lng: lng0, nombre: 'Plaza Solymar' },
      { id: 'p4', lat: esq[0], lng: esq[1] + 80 / mLon,  nombre: 'Policlínica' },
      { id: 'p5', lat: esq[0], lng: esq[1] + 150 / mLon, nombre: 'Feria de Lagomar' },
      { id: 'p6', lat: esq[0], lng: esq[1] + 200 / mLon, nombre: 'Terminal Portones' },
    ],
    hitos: [],
  };
}

async function sembrar(page, rec = recorridoEnEle()) {
  return page.evaluate(async (r) => {
    const guardado = await DB.guardar(r);
    await Lista.cargar();
    return guardado.id;
  }, rec);
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await sinTiles(page);
  // El proyecto "omnibus" de playwright.config.js apunta a un servidor que
  // sirve la carpeta omnibus/ como raíz, así que acá la app está en '/'.
  // En producción vive en /omnibus/, y como todas las rutas del HTML son
  // relativas, el mismo código funciona en los dos lados.
  await page.goto('/');
  await expect(page.locator('#splash')).toHaveClass(/oculto/, { timeout: 15000 });
  // Base limpia entre pruebas: si no, los recorridos de una se cuelan en la
  // siguiente y los conteos dejan de significar nada.
  await page.evaluate(async () => {
    for (const r of await DB.todos()) await DB.borrar(r.id);
    await Lista.cargar();
  });
});

test('arranca y muestra el estado vacío', async ({ page }) => {
  await expect(page.locator('#lista-vacia')).toBeVisible();
  await expect(page.locator('#lista-vacia h2')).toContainText('Todavía no cargaste');
});

test('un recorrido guardado aparece en la lista con sus números', async ({ page }) => {
  await sembrar(page);
  const tarjeta = page.locator('#lista-recorridos .tarjeta');
  await expect(tarjeta).toHaveCount(1);
  await expect(tarjeta).toContainText('710 Solymar → Portones');
  await expect(tarjeta).toContainText('6 paradas');
  await expect(tarjeta).toContainText('Línea 710');
});

test('el buscador filtra por línea', async ({ page }) => {
  await sembrar(page);
  await sembrar(page, { ...recorridoEnEle(), nombre: '196 Pando', linea: '196' });
  await expect(page.locator('#lista-recorridos .tarjeta')).toHaveCount(2);
  await page.fill('#buscar', '196');
  await expect(page.locator('#lista-recorridos .tarjeta')).toHaveCount(1);
  await expect(page.locator('#lista-recorridos .tarjeta')).toContainText('196 Pando');
});

test('el detalle arma la hoja de ruta con el giro detectado solo', async ({ page }) => {
  await sembrar(page);
  await page.click('#lista-recorridos .tarjeta');
  await expect(page.locator('#p-detalle')).toBeVisible();
  await expect(page.locator('#det-nombre')).toHaveText('710 Solymar → Portones');

  // Las seis paradas + la esquina que ninguna persona cargó a mano.
  const pasos = page.locator('#det-pasos .paso');
  await expect(pasos).toHaveCount(7);
  await expect(page.locator('#det-pasos')).toContainText('girá a la derecha');
  await expect(page.locator('#det-pasos')).toContainText('Shopping Costa Urbana');

  // Y en el orden en que se manejan, no en el que se cargaron.
  const textos = await pasos.allTextContents();
  expect(textos[0]).toContain('Shopping Costa Urbana');
  expect(textos[6]).toContain('Terminal Portones');
});

test('el modo manejo anuncia el próximo paso y avanza el progreso', async ({ page }) => {
  const id = await sembrar(page);
  await page.evaluate(async (id) => {
    // Se entra por la API en vez de por el botón para no depender de que el
    // GPS del runner conteste: los fixes los inyecta la prueba.
    window._voz = [];
    Voz.decir = (t) => window._voz.push(t);
    await Manejar.arrancar(await DB.obtener(id));
  }, id);
  await expect(page.locator('#p-manejar')).toBeVisible();

  // Arrancando el recorrido: la primera parada está a 100 m.
  await page.evaluate(() => Manejar._alFix({
    lat: -34.8235, lng: -55.9560, precision: 8, velocidad: 10, rumbo: 0, ts: Date.now(),
  }));
  await expect(page.locator('#man-accion')).toContainText('Shopping Costa Urbana');
  await expect(page.locator('#man-dist')).toContainText('100 m');

  // Pasadas las paradas de la primera recta, lo próximo tiene que ser la
  // esquina: el paso siguiente es el más cercano hacia adelante, sea parada
  // o giro.
  await page.evaluate(() => Manejar._alFix({
    lat: -34.8235 + 285 / 110574, lng: -55.9560, precision: 8, velocidad: 10, rumbo: 0, ts: Date.now(),
  }));
  await expect(page.locator('#man-accion')).toContainText('girá a la derecha');

  // Y el progreso tiene que haberse movido de cero.
  const ancho = await page.locator('#man-progreso').evaluate(el => el.style.width);
  expect(parseFloat(ancho)).toBeGreaterThan(25);

  // La voz dijo algo del giro, que es el canal que se usa manejando.
  const dichos = await page.evaluate(() => window._voz.join(' | '));
  expect(dichos).toMatch(/derecha/);
});

test('avisa cuando te saliste del recorrido y cuando volvés', async ({ page }) => {
  const id = await sembrar(page);
  await page.evaluate(async (id) => {
    window._voz = [];
    Voz.decir = (t) => window._voz.push(t);
    await Manejar.arrancar(await DB.obtener(id));
  }, id);

  const enRuta = { lat: -34.8235 + 100 / 110574, lng: -55.9560, precision: 8, velocidad: 10, rumbo: 0 };
  await page.evaluate((f) => Manejar._alFix({ ...f, ts: Date.now() }), enRuta);
  await expect(page.locator('#man-alerta')).toBeHidden();

  // ~330 m al oeste de la traza. Un solo fix NO alcanza: hacen falta tres
  // seguidos, o el ruido del GPS entre edificios dispararía la alarma sola.
  const lejos = { ...enRuta, lng: -55.9596 };
  await page.evaluate((f) => Manejar._alFix({ ...f, ts: Date.now() }), lejos);
  await expect(page.locator('#man-alerta')).toBeHidden();

  await page.evaluate((f) => {
    Manejar._alFix({ ...f, ts: Date.now() });
    Manejar._alFix({ ...f, ts: Date.now() });
  }, lejos);
  await expect(page.locator('#man-alerta')).toBeVisible();
  await expect(page.locator('#man-banner')).toHaveClass(/peligro/);

  // Al volver a la traza la alerta se tiene que ir.
  await page.evaluate((f) => Manejar._alFix({ ...f, ts: Date.now() }), enRuta);
  await expect(page.locator('#man-alerta')).toBeHidden();

  const dichos = await page.evaluate(() => window._voz.join(' | '));
  expect(dichos).toMatch(/saliste del recorrido/);
  expect(dichos).toMatch(/Volviste al recorrido/);
});

test('salir del modo manejo suelta el GPS y vuelve al detalle', async ({ page }) => {
  const id = await sembrar(page);
  await page.evaluate(async (id) => Manejar.arrancar(await DB.obtener(id)), id);
  await expect(page.locator('#p-manejar')).toBeVisible();

  await page.click('#man-salir');
  await page.locator('.dialogo .btn.peligro').click();

  await expect(page.locator('#p-detalle')).toBeVisible();
  expect(await page.evaluate(() => Manejar.activo())).toBe(false);
});

test('el modo estudio arma un test con preguntas del propio recorrido', async ({ page }) => {
  const id = await sembrar(page);
  await page.evaluate(async (id) => Estudio.abrir(await DB.obtener(id)), id);
  await expect(page.locator('#p-estudio')).toBeVisible();
  await expect(page.locator('#est-pasos .paso')).toHaveCount(7);

  await page.click('#est-modo .seg[data-modo="test"]');
  await expect(page.locator('#test-opciones .btn').first()).toBeVisible();
  await expect(page.locator('#test-pregunta')).not.toHaveText('—');

  // Responder tiene que bloquear el resto de las opciones: sin eso, dos
  // toques rápidos suman dos puntos por una sola respuesta.
  await page.locator('#test-opciones .btn').first().click();
  await expect(page.locator('#test-opciones .btn').first()).toBeDisabled();
  await expect(page.locator('#test-siguiente')).toBeVisible();
});

test('el editor deja dibujar un recorrido nuevo y guardarlo', async ({ page }) => {
  await page.evaluate(() => Editar.nuevo());
  await expect(page.locator('#p-editar')).toBeVisible();

  await page.evaluate(() => {
    const m = Mapa.get('mapa-editar').map;
    m.setView([-34.8235, -55.9560], 16);
    m.fire('click', { latlng: L.latLng(-34.8235, -55.9560) });
    m.fire('click', { latlng: L.latLng(-34.8215, -55.9560) });
    m.fire('click', { latlng: L.latLng(-34.8215, -55.9530) });
  });
  await expect(page.locator('#edit-stats')).toContainText('3');

  await page.click('#edit-deshacer');
  await expect(page.locator('#edit-stats')).toContainText('2');

  await page.click('#edit-guardar');
  await page.fill('#dlg-texto', 'Recorrido dibujado');
  await page.locator('.dialogo .btn.ok').click();

  await expect(page.locator('#p-detalle')).toBeVisible();
  await expect(page.locator('#det-nombre')).toHaveText('Recorrido dibujado');
});

test('el botón de atrás recorre la jerarquía sin quedarse trabado', async ({ page }) => {
  await sembrar(page);
  await page.click('#lista-recorridos .tarjeta');
  await expect(page.locator('#p-detalle')).toBeVisible();

  await page.click('#det-estudiar');
  await expect(page.locator('#p-estudio')).toBeVisible();

  await page.click('#btn-atras');
  await expect(page.locator('#p-detalle')).toBeVisible();

  await page.click('#btn-atras');
  await expect(page.locator('#p-lista')).toBeVisible();
  await expect(page.locator('#btn-atras')).toBeHidden();
});

test('exportar e importar devuelve el mismo recorrido', async ({ page }) => {
  const id = await sembrar(page);
  // El viaje de ida y vuelta por GeoJSON es cómo un chofer le pasa un
  // recorrido a otro. Si el par lat/lng se invierte en el camino, el
  // recorrido reaparece en el otro hemisferio.
  const iguales = await page.evaluate(async (id) => {
    const original = await DB.obtener(id);
    const geo = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: original.nombre },
        geometry: { type: 'LineString', coordinates: original.puntos.map(([lat, lng]) => [lng, lat]) },
      }],
    };
    const [leido] = Importar._leerGeoJson(geo, 'x');
    return leido.puntos.every((p, i) =>
      Math.abs(p[0] - original.puntos[i][0]) < 1e-9 && Math.abs(p[1] - original.puntos[i][1]) < 1e-9);
  }, id);
  expect(iguales).toBe(true);
});

// ── GTFS ───────────────────────────────────────────────────────
// Prueba del camino completo del importador estrella: un .zip de verdad
// entra por el <input type="file"> y tiene que terminar en recorridos
// guardados, con la geometría y las paradas del feed.

/** Un .zip real (deflate crudo + directorio central) desde {nombre: texto}. */
function armarZip(archivos) {
  const crc32 = (buf) => {
    let c, crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = (crc ^ buf[i]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const locales = [], central = [];
  let off = 0;
  for (const [nombre, texto] of Object.entries(archivos)) {
    const crudo = Buffer.from(texto, 'utf8');
    const datos = zlib.deflateRawSync(crudo);
    const crc = crc32(crudo);
    const nom = Buffer.from(nombre, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(datos.length, 18);
    lh.writeUInt32LE(crudo.length, 22); lh.writeUInt16LE(nom.length, 26);
    locales.push(lh, nom, datos);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(datos.length, 20);
    ch.writeUInt32LE(crudo.length, 24); ch.writeUInt16LE(nom.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nom);
    off += lh.length + nom.length + datos.length;
  }
  const cuerpo = Buffer.concat(locales), dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(archivos).length, 8);
  eocd.writeUInt16LE(Object.keys(archivos).length, 10);
  eocd.writeUInt32LE(dir.length, 12); eocd.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, dir, eocd]);
}

const FEED_GTFS = {
  'agency.txt': 'agency_id,agency_name\nA1,COETC\nA2,Otra Empresa\n',
  'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_color\n'
    + 'R710,A1,710,Solymar - Portones,35c78a\nRX,A2,999,Otra,\n',
  'trips.txt': 'route_id,trip_id,shape_id,direction_id,trip_headsign\n'
    + 'R710,T1,S1,0,A Portones\nR710,T2,S1,0,A Portones\nRX,T9,S9,0,Otra\n',
  'shapes.txt': 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n'
    + 'S1,-34.8215,-55.9560,2\nS1,-34.8235,-55.9560,1\nS1,-34.8215,-55.9500,3\n'
    + 'S9,-34.7,-55.9,1\nS9,-34.71,-55.9,2\n',
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n'
    + 'P1,"Giannattasio esq. Racine, Lagomar",-34.8230,-55.9560\n'
    + 'P2,Terminal Portones,-34.8215,-55.9505\n',
  'stop_times.txt': 'trip_id,stop_id,stop_sequence\nT1,P2,2\nT1,P1,1\nT9,P1,1\n',
};

test('importa un GTFS real desde el selector de archivos', async ({ page }) => {
  const zip = path.join(os.tmpdir(), `gtfs-prueba-${Date.now()}.zip`);
  fs.writeFileSync(zip, armarZip(FEED_GTFS));

  await page.click('.tab[data-ir="importar"]');
  await expect(page.locator('#p-importar')).toBeVisible();

  await page.setInputFiles('#gtfs-archivo', zip);

  // Un solo recorrido: T1 y T2 son la misma línea y sentido en distinto
  // horario, y la línea 999 es de otra empresa.
  const tarjetas = page.locator('#gtfs-resultados .tarjeta');
  await expect(tarjetas).toHaveCount(1, { timeout: 15000 });
  await expect(tarjetas.first()).toContainText('710');
  await expect(tarjetas.first()).toContainText('3 puntos');
  await expect(tarjetas.first()).toContainText('2 paradas');

  await tarjetas.first().click();
  await expect(page.locator('#p-detalle')).toBeVisible();
  await expect(page.locator('#det-nombre')).toContainText('710');

  // La parada con coma en el nombre tiene que haber sobrevivido al CSV.
  await expect(page.locator('#det-pasos')).toContainText('Giannattasio esq. Racine, Lagomar');
  fs.unlinkSync(zip);
});

test('con un filtro de empresa que no existe, ofrece las que sí están', async ({ page }) => {
  const zip = path.join(os.tmpdir(), `gtfs-vacio-${Date.now()}.zip`);
  fs.writeFileSync(zip, armarZip(FEED_GTFS));

  await page.click('.tab[data-ir="importar"]');
  await page.fill('#gtfs-empresa', 'EmpresaQueNoExiste');
  await page.setInputFiles('#gtfs-archivo', zip);

  await expect(page.locator('#gtfs-resultados')).toContainText('COETC', { timeout: 15000 });
  await expect(page.locator('#gtfs-resultados')).toContainText('ninguna coincide');
  fs.unlinkSync(zip);
});

// ── Grabación y copia de seguridad ─────────────────────────────
// Acá el GPS NO se inyecta: se usa la geolocalización del navegador que
// mueve Playwright, o sea que pasa por watchPosition de verdad. Es lo más
// cerca del ómnibus que se puede llegar sin subirse a uno.

/** Mueve el "teléfono" a lo largo de una recta, un paso por vez. */
async function manejar(context, page, pasos = 8, metrosPorPaso = 40) {
  const lat0 = -34.8235, lng0 = -55.9560;
  for (let i = 1; i <= pasos; i++) {
    await context.setGeolocation({
      latitude: lat0 + (i * metrosPorPaso) / 110574,
      longitude: lng0,
      accuracy: 8,
    });
    await page.waitForTimeout(220);
  }
}

test('la grabación se va guardando sola y se puede recuperar', async ({ page, context }) => {
  await context.setGeolocation({ latitude: -34.8235, longitude: -55.9560, accuracy: 8 });
  await page.click('.tab[data-ir="grabar"]');
  await page.click('#grab-toggle');
  await expect(page.locator('#grab-estado')).toHaveText('● Grabando…');

  await manejar(context, page);

  // Puntos de verdad, llegados por watchPosition.
  const puntos = await page.evaluate(() => Grabar.puntos().length);
  expect(puntos).toBeGreaterThan(3);

  // El techo de tiempo entre escrituras: pasado eso, no puede quedar nada
  // sin guardar. Si esto se rompiera, la pérdida dejaría de estar acotada.
  await page.waitForTimeout(1600);
  const borrador = await page.evaluate(() => DB.getConfig('grabacion_en_curso', null));
  expect(borrador).not.toBeNull();
  expect(borrador.puntos.length).toBe(puntos);

  // Simula que Android mató la pestaña. El `beforeunload` de la app abriría
  // un diálogo del navegador que cancelaría la recarga; se acepta, que es
  // justo lo que NO pasa cuando el sistema mata el proceso por su cuenta.
  page.on('dialog', d => d.accept());
  await page.reload();
  await expect(page.locator('#splash')).toHaveClass(/oculto/, { timeout: 15000 });

  const dialogo = page.locator('.overlay .dialogo');
  await expect(dialogo).toBeVisible({ timeout: 10000 });
  await expect(dialogo).toContainText('grabación sin terminar');

  await dialogo.locator('.btn.ok').click();
  await expect(page.locator('#p-grabar')).toBeVisible();
  // Vuelve EN PAUSA, nunca grabando: la app se está abriendo de nuevo y
  // reanudar sola metería una recta desde donde se cortó hasta acá.
  await expect(page.locator('#grab-estado')).toHaveText('⏸ En pausa');
  expect(await page.evaluate(() => Grabar.puntos().length)).toBe(puntos);
  // Y el mapa vuelve a dibujar el trazado recuperado, no una pantalla vacía.
  expect(await page.evaluate(() => !!Mapa.get('mapa-grabar').capas.recorrido)).toBe(true);
});

test('descartar la grabación recuperada no la vuelve a ofrecer', async ({ page, context }) => {
  await context.setGeolocation({ latitude: -34.8235, longitude: -55.9560, accuracy: 8 });
  await page.click('.tab[data-ir="grabar"]');
  await page.click('#grab-toggle');
  await manejar(context, page, 5);
  await page.waitForTimeout(1600);

  page.on('dialog', d => d.accept());
  await page.reload();
  await expect(page.locator('#splash')).toHaveClass(/oculto/, { timeout: 15000 });
  await page.locator('.overlay .dialogo .btn.peligro').click();

  // Borrar es una escritura asíncrona: sin esperar a que termine, la recarga
  // puede ganarle la carrera y el borrador sigue ahí. Eso haría fallar la
  // prueba por un motivo que no es el que se está midiendo.
  await expect.poll(() => page.evaluate(() => DB.getConfig('grabacion_en_curso', null)))
    .toBeNull();

  await page.reload();
  await expect(page.locator('#splash')).toHaveClass(/oculto/, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await expect(page.locator('.overlay')).toHaveCount(0);
});

test('terminar y guardar deja de ofrecer la recuperación', async ({ page, context }) => {
  await context.setGeolocation({ latitude: -34.8235, longitude: -55.9560, accuracy: 8 });
  await page.click('.tab[data-ir="grabar"]');
  await page.click('#grab-toggle');
  await manejar(context, page, 6);

  await page.click('#grab-fin');
  await page.fill('#dlg-texto', 'Recorrido grabado');
  await page.locator('.dialogo .btn.ok').click();
  await expect(page.locator('#p-detalle')).toBeVisible();
  await expect(page.locator('#det-nombre')).toHaveText('Recorrido grabado');

  // El borrador tiene que haberse limpiado al guardar.
  expect(await page.evaluate(() => DB.getConfig('grabacion_en_curso', null))).toBeNull();
});

test('la copia de seguridad restaura todo sin pisar lo que ya está', async ({ page }) => {
  await sembrar(page);
  await sembrar(page, { ...recorridoEnEle(), nombre: '196 Pando', linea: '196' });

  const backup = await page.evaluate(async () =>
    JSON.stringify(Importar.armarBackup(await DB.todos())));

  // Se borra todo, como si fuera un teléfono nuevo.
  await page.evaluate(async () => {
    for (const r of await DB.todos()) await DB.borrar(r.id);
    await Lista.cargar();
  });
  await expect(page.locator('#lista-recorridos .tarjeta')).toHaveCount(0);

  await page.evaluate((json) => {
    const f = new File([json], 'copia.json', { type: 'application/json' });
    Importar.restaurarTodo(f);
  }, backup);
  await page.locator('.dialogo .btn.peligro').click();

  await expect(page.locator('#lista-recorridos .tarjeta')).toHaveCount(2);
  await expect(page.locator('#lista-recorridos')).toContainText('196 Pando');

  // Restaurar la MISMA copia otra vez agrega duplicados en vez de pisar:
  // en la duda, nunca se pierde lo que ya estaba.
  await page.evaluate((json) => {
    const f = new File([json], 'copia.json', { type: 'application/json' });
    Importar.restaurarTodo(f);
  }, backup);
  await page.locator('.dialogo .btn.peligro').click();
  await expect(page.locator('#lista-recorridos .tarjeta')).toHaveCount(4);
});

test('un archivo que no es una copia se rechaza con un motivo', async ({ page }) => {
  await page.evaluate(() => {
    const f = new File(['{"hola":1}'], 'cualquiera.json', { type: 'application/json' });
    Importar.restaurarTodo(f);
  });
  await expect(page.locator('#toast')).toContainText('no es una copia de recorridos');
  await expect(page.locator('#lista-recorridos .tarjeta')).toHaveCount(0);
});
