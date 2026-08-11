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
ni service worker. En producción queda en
`https://parfumtrack.luccasramireziglesias.workers.dev/omnibus/`.

## Pantallas

| Pantalla | Para qué |
|---|---|
| **Recorridos** | Lista de lo cargado, con buscador |
| **Detalle** | Mapa, largo, paradas, giros y la hoja de ruta en orden |
| **Manejar** | La guía GPS. Pantalla completa, voz, alerta de desvío |
| **Grabar** | Registrar un recorrido manejándolo |
| **Editar** | Dibujar o corregir un trazado, poner paradas y avisos |
| **Importar** | Buscar en OpenStreetMap o leer GPX / GeoJSON / KML |
| **Estudiar** | Repaso en el mapa + test de memorización |

## De dónde salen los recorridos

Cuatro vías, en orden de fiabilidad:

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
│   └── 14-app.js       ← arranque, atrás, ajustes, service worker
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
