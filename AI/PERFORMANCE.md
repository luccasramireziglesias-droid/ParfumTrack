# PERFORMANCE — Rendimiento de ParfumTrack

**Contexto:** el usuario objetivo usa un celular de gama baja en LATAM con datos móviles
caros. Los umbrales de este proyecto asumen un dispositivo **4 a 6 veces más lento** que
el runner de CI.

---

## 1. Mediciones reales

`tests/volumen.spec.js` siembra el historial de alguien que usó la app **tres años**
(2000 ventas, 1500 cuotas, 120 perfumes) y mide pantalla por pantalla.

### Sin cifrado

| Métrica | Antes del fix | Ahora | Límite |
|---|---|---|---|
| Arranque en frío | 1117 ms | 1117 ms | 4000 ms |
| Dashboard | 26 ms | 26 ms | 400 ms |
| Lista de ventas | 25 ms | 18 ms | 400 ms |
| Estadísticas | 3 ms | 3 ms | 1200 ms |
| **Cuotas** | **297 ms** | **16 ms** | 600 ms |
| Stock | 18 ms | 25 ms | — |
| Clientes | 19 ms | 30 ms | — |
| Buscar | 15 ms | 14 ms | 300 ms |
| **Nodos en el DOM** | **22.040** | **6.532** | — |
| Cards en la lista | 50 (de 2000) | 50 | ≤ 60 |

### Con cifrado (con licencia)

| Métrica | Valor |
|---|---|
| Arranque en frío | 970 ms |
| Render tras cargar | 11 ms |
| Integridad de los datos | ✅ |

**Dato contraintuitivo:** el arranque cifrado no es más lento que el sin cifrar. Con
licencia se descifran miles de registros con AES-GCM, pero la operación es rápida y
está dominada por el I/O de IndexedDB.

Subir el volumen: `VOL_VENTAS=5000 npx playwright test tests/volumen.spec.js`

---

## 2. Optimizaciones implementadas

### a) `renderAll()` rinde solo la pantalla visible
Rendir las 17 pantallas en cada cambio era el cuello de botella original.
```js
renderAll() {
  const actual = this.currentScreen;
  if (actual === 'inicio') this.renderDashboard();
  else if (actual === 'cuotas') this.renderCuotas();
  // …
}
```

### b) Debounce de 100 ms
`renderAll()` pasa por `debounce()`. Evita repintar varias veces ante mutaciones seguidas.
⚠️ **Rompe los tests que leen el DOM enseguida** — por eso llaman al render directo.

### c) Paginado de listas

| Lista | Página | Estado | Método |
|---|---|---|---|
| Ventas | 50 | `_ventasVisibles` / `_VENTAS_PAGINA` | `verMasVentas()` |
| Cuotas | 30 | `_cuotasVisibles` / `_CUOTAS_PAGINA` | `verMasCuotas()` |

🔴 **Los totales se calculan sobre el conjunto completo, no sobre lo visible.**
Con paginado eso es fácil de romper y sería el peor bug posible en la pantalla de cobros.

### d) Precálculo fuera del comparador del `sort`

El fix de rendimiento más grande del proyecto. `renderCuotas()` buscaba el vencimiento más
próximo de cada venta **dentro del comparador del `sort`**: con 500 ventas en cuotas son
miles de `filter` + `sort` repetidos para ordenar una sola lista.

```js
// Ahora: se calcula UNA vez por grupo…
const conProxima = [];
for (const [ventaId, cuotas] of Object.entries(grouped)) {
  let proxima = null;
  for (const c of cuotas) {
    if (c.pagado) continue;
    if (!proxima || (c.vence || 0) < (proxima.vence || 0)) proxima = c;
  }
  if (proxima) conProxima.push({ ventaId, cuotas, proxima });
}
// …y el comparador es trivial
conProxima.sort((a, b) => (a.proxima.vence || 0) - (b.proxima.vence || 0));
```

**297 ms → 16 ms.** Hay un test que falla si vuelve a aparecer `filter` o `.map(` dentro
de un `sort` de esa función.

### e) `_renderVentaCard` recibe `index`
Sin él usaba `indexOf` para el número de venta: O(n²) sobre la lista entera.

### f) Alertas de stock colapsables
Con 14 perfumes agotados la lista tapaba el inventario. Ahora: resumen + 3 filas + "Ver todos".

### g) Lazy loading

| Recurso | Cómo |
|---|---|
| Chart.js 4.4.0 | Solo al entrar a Estadísticas |
| jsPDF 2.5.1 | Solo al exportar PDF |
| XLSX 0.18.5 | Solo al exportar/importar Excel |
| Fotos de stock | `IntersectionObserver` (`_lazyLoadStockPhotos()`) |

Los tres scripts se cargan con `integrity` sha384 (ver [SECURITY.md](SECURITY.md)).

### h) Una sola lectura de cuotas en el arranque
Las tres migraciones idempotentes comparten `cuotasInit`. Antes: 3 lecturas + 3 descifrados
completos de la tabla en cada arranque.

### i) Reconciliación condicional de stock
`DB.updateVenta()` solo toca el inventario si cambió el perfume o la cantidad
(`cambioStock`). Editar el cliente o una nota no dispara escrituras en `perfumes`.

### j) Fuentes locales
`fonts/fonts.css` con woff2 propios, precacheados por el SW. Sin request a Google Fonts.

### k) Splash pintado antes que el JS
`#splash` está en el HTML **estático**, no lo genera el JS. Mínimo 420 ms visible para que
no sea un flash, y se saca del DOM al terminar el fundido (si queda, intercepta toques).

---

## 3. Cuellos de botella conocidos

### 🟠 `loadData()` recarga TODO, siempre

```js
async loadData() {
  this.perfumes = await DB.getPerfumes();
  this.ventas = await DB.getVentas();
  this.cuotasData = await DB.getCuotas();
  // …8 lecturas completas
}
```

Se llama después de **cada** mutación. Es el costo dominante del arranque y de cada
guardado.

**Por qué sigue así:** es deliberadamente simple y auditable. Con los volúmenes medidos
(hasta 2000 ventas) el costo es aceptable, y la alternativa —actualización incremental—
introduce la clase de bug más cara de esta app: un estado parcialmente desincronizado que
muestra un número de plata equivocado.

**Cuándo revisarlo:** si aparecen usuarios con más de ~5000 ventas. La mejora natural es
diferir los stores que no se usan en el arranque (`caja`, `gastos`, `compras`, `pedidos`).

### 🟡 Los índices de IndexedDB casi no se usan
`loadData()` hace `getAll()` y filtra en memoria. Además, **con datos cifrados los índices
sobre campos cifrados no sirven**: el valor real está dentro del blob.

### 🟡 Fotos como data URL
Las fotos de perfumes se guardan en IndexedDB como data URL. `_processPhoto()` redimensiona
y comprime antes de guardar, pero muchas fotos grandes inflan el backup JSON.

### 🟡 `02-render.js` genera HTML por concatenación de strings
Es rápido para los volúmenes actuales, pero repinta la lista entera en cada render. Sin
diffing. El paginado es lo que lo mantiene acotado.

---

## 4. Service Worker y cacheo

| Recurso | Estrategia |
|---|---|
| `STATIC_ASSETS` (HTML, iconos, fuentes, manifest) | Precache en `install` |
| Navegación | **Network-First** — el usuario ve la versión nueva apenas hay red |
| `/sw.js` | `no-cache, no-store, must-revalidate` (forzado por el Worker) |
| `/` y `/index.html` | `no-cache, must-revalidate` |

Cada versión tiene su propio cache (`parfumtrack-v1.8.0`); `activate` limpia los anteriores.

**🔴 La trampa de `controllerchange`:** el handler solo recarga si **ya había** un
controller. Sin ese guard, `clients.claim()` disparaba una recarga en la primera visita de
**cada usuario nuevo**.

---

## 5. Umbrales de CI

`tests/volumen.spec.js` falla el build si se superan:

```js
const LIMITES = {
  arranque:    4000,   // ms, en frío con 2000 ventas
  dashboard:    400,
  listaVentas:  400,
  stats:       1200,
  buscar:       300,
  cuotas:       600,
};
```

Más: cero errores de JS, y ≤ 60 cards en la lista (si vuelca las 2000, el paginado se rompió).

Los límites están calculados para que un celular de gama baja siga siendo usable.
**Son generosos a propósito** — si se superan, es un problema estructural, no ruido.

---

## 6. Reglas de rendimiento

1. 🔴 **Toda lista que puede crecer sin techo tiene que paginar.**
2. 🔴 **Los totales se calculan sobre el conjunto completo, nunca sobre lo visible.**
3. 🔴 **Nada de trabajo dentro de un comparador de `sort`.** Precalculá antes.
4. 🔴 **Nada de `indexOf` dentro de un `map` sobre la misma lista** (O(n²)).
5. 🟠 **No agregues pasos al arranque** sin medir: `_initInterno()` le pega a todos los usuarios.
6. 🟠 **Las librerías pesadas van lazy**, con SRI.
7. 🟠 **Las migraciones idempotentes comparten lecturas.** No leas la misma tabla dos veces.
8. 🟡 **Medí antes de optimizar.** `tests/volumen.spec.js` está para eso.
