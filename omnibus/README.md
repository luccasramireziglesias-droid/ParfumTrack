# Recorridos — guía GPS de líneas de ómnibus

PWA para choferes: todos los recorridos en el mapa, elegís el que te toca y el GPS te va
guiando calle por calle, con avisos por voz, alerta si te desviás y un modo de estudio
para memorizarlos.

**No tiene nada que ver con ParfumTrack.** Comparte el repositorio y el Worker de
Cloudflare, nada más. Vive en `/omnibus/`, no toca `index.html`, ni `src/`, ni la base de
datos de ParfumTrack, ni ninguno de sus endpoints.

## Correrla

```bash
npx serve -l 8788 omnibus       # http://localhost:8788
```

Tiene que ser **HTTPS o localhost**: sin contexto seguro el navegador no da geolocalización
ni service worker. Ojo con servirla desde la PC a un teléfono por `http://192.168.x.x`:
eso NO es contexto seguro y Chrome no da ubicación. La app lo detecta y lo avisa.

En producción queda en `https://parfumtrack.luccasramireziglesias.workers.dev/omnibus/`.

### Archivo único, sin servidor

```bash
node scripts/build-omnibus-standalone.js   # omnibus/recorridos-standalone.html (~307 KB)
```

Mete la app entera —CSS, los 15 módulos, Leaflet y las imágenes— en un solo HTML que se
abre haciendo doble clic o se manda por WhatsApp. Está en `.gitignore`: se regenera, no se
versiona.

Qué se pierde ahí: **no hay service worker** (no se puede registrar desde un archivo
suelto), así que no hay precache ni mapas offline — necesita internet para los tiles. El
GPS depende de si el navegador le da permiso a un origen `file://`; Chrome de escritorio
suele hacerlo, en Android es menos confiable. Para manejar de verdad, usá la versión
servida por https.

### Carpeta lista para un hosting propio

```bash
node scripts/build-omnibus-dist.js   # dist-recorridos/ + recorridos-para-subir.zip
```

La app con la raíz en `/` (no en `/omnibus/`), con su `_headers` y un `LEEME.txt`. Se
arrastra a Netlify Drop o Cloudflare Pages y queda en https con dominio propio: ahí sí hay
service worker, mapas offline y GPS confiable. Es la versión para usar manejando.

⚠️ El `_headers` que genera **no restringe `geolocation`**. En el Worker de ParfumTrack hay
que reescribirlo porque el global lo apaga; en un hosting propio el default ya permite el
propio origen y lo único que se logra tocándolo es romper la app entera.

## Pantallas

| Pantalla | Para qué |
|---|---|
| **Recorridos** | Lista de lo cargado, con buscador |
| **Detalle** | Mapa, largo, paradas, giros y la hoja de ruta en orden |
| **Manejar** | La guía GPS. Pantalla completa, voz, alerta de desvío |
| **Grabar** | Registrar un recorrido manejándolo |
| **Editar** | Dibujar o corregir un trazado, poner paradas y avisos |
| **Importar** | GTFS oficial, OpenStreetMap, GPX/GeoJSON/KML y la copia de seguridad |
| **Estudiar** | Repaso en el mapa + test de memorización |

## De dónde salen los recorridos

Cinco vías, en orden de fiabilidad:

0. **GTFS oficial ⭐ — la mejor.** El `.zip` de datos abiertos del transporte trae la
   geometría exacta de cada recorrido (`shapes.txt`) y todas las paradas en orden. Es la
   misma fuente que usan las apps de horarios tipo Nextbus, pero de primera mano. Para
   Uruguay: `catalogodatos.gub.uy` → MTOP → "Horarios Metropolitanos GTFS".
   Se lee entero en el navegador, sin librerías: `DecompressionStream('deflate-raw')`
   descomprime el zip y `stop_times.txt` (que puede pesar cientos de MB) se recorre en
   streaming, fila por fila, descartando lo que no interesa.
   Del feed se toma **un viaje por línea y sentido**: un feed real trae cientos de viajes
   por línea, uno por horario, todos con el mismo trazado.
   ⚠️ Si una línea viene sin `shape_id`, el trazado se arma uniendo paradas con rectas.
   Sirve para ubicarse, **no para guiar**, y el recorrido queda marcado con ese aviso.

1. **Grabarlo manejando.** La más fiel: sale por donde realmente pasa el ómnibus, con los
   desvíos por obra y los atajos que ningún mapa tiene. Al terminar, el trazado se
   simplifica y **los giros se detectan solos** por geometría.
2. **Dibujarlo en el mapa.** Para cargarlo desde casa mirando la hoja de ruta.
3. **Importar un archivo** GPX, GeoJSON o KML. También sirve para pasarle un recorrido a
   un compañero (exportar está en Detalle → Más).
4. **OpenStreetMap.** Trae las relaciones `route=bus` que ya estén mapeadas.
   ⚠️ Depende de que alguien las haya cargado; puede no haber nada para tu empresa, o
   estar incompleto. Es un atajo, no la fuente principal.

## Modo manejo

- El **banner grande** muestra el próximo evento, sea giro o parada. Nada más: manejando
  no se lee otra cosa.
- **Voz** a 400 / 150 / 40 m de un giro y a 250 / 60 m de una parada, una sola vez por
  umbral.
- **Alerta de desvío** a más de 45 m de la traza, y solo después de 3 fixes seguidos
  afuera (un fix malo entre edificios no es un desvío). Vuelve a apagarse a menos de 22 m.
- **Contramano**: si el avance sobre la traza baja de forma sostenida mientras te movés.
- El mapa **no rota**: queda con el norte arriba y lo que gira es la flecha de posición.
- La pantalla se mantiene encendida (`wakeLock`).
- **Modo demo** en Ajustes: recorre la traza sin GPS, para probar en casa que los avisos
  suenan donde tienen que sonar antes de depender del recorrido arriba del ómnibus.

## Offline

Detalle → **Mapa offline** baja los tiles del corredor del recorrido (zooms 13 a 16) a la
Cache API. Después el recorrido funciona con el teléfono en avión. Los mapas bajados
**no se borran** al actualizar la app; se limpian a mano desde Ajustes.

## No perder trabajo

Grabar un recorrido cuesta manejarlo entero, así que hay dos redes:

- **Borrador automático.** La grabación se escribe en IndexedDB cada 5 puntos y, como
  techo, cada 1,2 s. Si Android mata la pestaña con la pantalla apagada —que es lo que
  pasa— al abrir la app se ofrece recuperarla. Vuelve **en pausa**, nunca grabando:
  reanudar sola metería una recta desde donde se cortó hasta donde estés ahora.
  `pagehide` y `visibilitychange` también fuerzan un guardado, pero no alcanzan por sí
  solos: escribir en IndexedDB es asíncrono y la página se descarga antes de que termine.
  Por eso el techo de tiempo es lo que de verdad acota la pérdida.
- **Copia de todo.** Importar → “Guardar copia de todo” baja un JSON con todos los
  recorridos. Restaurar **agrega, nunca pisa**: un id repetido recibe uno nuevo, así que
  restaurar una copia vieja te deja duplicados (que se borran en dos toques) en lugar de
  perder meses de trabajo.

## Datos

Todo en **IndexedDB local**, en el teléfono. No hay servidor, no hay cuenta, no hay
backend: la app es HTML estático. Lo único que sale a la red son los tiles del mapa y, si
lo pedís, OpenStreetMap para importar y Nominatim para los nombres de calles.

Un recorrido:

```js
{ id, nombre, linea, sentido, color, notas, origen,   // grabado|dibujado|importado|osm
  puntos:  [[lat, lng], ...],                          // el trazado
  paradas: [{ id, lat, lng, nombre, metros }],
  hitos:   [{ id, lat, lng, tipo, texto, metros, auto }],
  largo, creado, actualizado }
```

`metros` es el **avance sobre el recorrido**, no una distancia al usuario. Lo recalcula
`DB.guardar()` en cada escritura, junto con los giros automáticos, para que nunca queden
desincronizados del trazado.

## Estructura

```
omnibus/
├── index.html          ← el shell; los <script> se cargan en orden, sin bundler
├── css/app.css
├── js/
│   ├── 00-geo.js       ← distancias, proyección sobre la traza, detección de giros
│   ├── 01-db.js        ← IndexedDB + derivados
│   ├── 02-ui.js        ← escapado, navegación, diálogos
│   ├── 03-mapa.js      ← capa fina sobre Leaflet
│   ├── 04-gps.js       ← un solo watchPosition para toda la app
│   ├── 05-voz.js       ← avisos hablados
│   ├── 06-lista.js · 07-detalle.js · 08-manejar.js · 09-grabar.js
│   ├── 10-editar.js · 11-importar.js · 12-estudio.js · 13-offline.js
│   ├── 15-gtfs.js      ← lector de ZIP y GTFS, sin librerías
│   └── 99-app.js       ← arranque, atrás, ajustes, SW. Va último a propósito
├── vendor/             ← Leaflet 1.9.4 local (no CDN: tiene que andar offline)
├── sw.js · manifest.json · icono.svg · icon-*.png
└── README.md
```

## Al tocar el código

- **Módulo nuevo en `js/`** → sumalo a `index.html` **y** a `ESTATICOS` de `sw.js`.
  `scripts/build-omnibus.js` falla el build si te olvidás (si no, la app abre bien online
  y explota sin señal, que es el peor momento para enterarse).
- **La versión** se propaga desde `package.json` con `npm run build`. No editar a mano
  el `<meta app-version>` ni el `APP_VERSION` del SW.
- **Cabeceras**: las de `/omnibus/` las escribe `worker.js` (`cabecerasOmnibus`), no
  `_headers`. El `_headers` global trae `geolocation=()`, que apaga el GPS.
- **`esc()` es para texto, `escAttr()` para atributos.** Los nombres de parada los escribe
  el usuario y terminan dentro de `title="..."`.
- Nunca `deleteObjectStore` en una migración: un recorrido perdido son horas de manejo.

## Tests

```bash
npx vitest run tests/omnibus-geo.test.js tests/omnibus-datos.test.js tests/omnibus-sw.test.js
npx playwright test --project=omnibus
```

54 unitarios (geometría, unión de ways de OSM, parseo de archivos, derivados, tiles,
service worker) y 11 E2E que inyectan fixes de GPS sintéticos y verifican los avisos.
