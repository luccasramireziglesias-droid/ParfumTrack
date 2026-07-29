# BUG_HISTORY — Historial de bugs

**Este archivo no se borra nunca.** Un bug arreglado sigue siendo información: explica por
qué el código tiene la forma que tiene, y evita que alguien "simplifique" una defensa que
existe por una razón.

**Antes de arreglar un bug, buscá acá.** Es probable que algo parecido ya haya pasado.

Formato: fecha · descripción · causa · solución · archivos · riesgo de reintroducción.

---

## BUG-01 — El restore de backup se comía los stores nuevos
**Fecha:** ~06/2026 · **Riesgo de reintroducción:** 🔴 ALTO

**Descripción.** Al restaurar un backup, los datos de los stores agregados después
(`compras`, `reservas`) desaparecían.

**Causa.** `10-data-management.js` tiene **5 listas separadas** `const stores = [...]`.
Al agregar un store hay que sumarlo a todas; si falta en una, el restore no lo contempla
y lo pisa con vacío.

**Solución.** Sumarlo a las 5 listas + un test de regresión que verifica que toda lista
`const stores = [...]` incluya los stores nuevos.

**Archivos.** `src/app/10-data-management.js`, `tests/features.test.js`

**Nota.** Sigue siendo la trampa más peligrosa del proyecto. Checklist en
[DATABASE.md](DATABASE.md) §8.

---

## BUG-02 — XSS vía `onclick` con datos del usuario
**Fecha:** ~05/2026 · **Riesgo:** 🔴 ALTO

**Descripción.** Los botones de WhatsApp y de pago de cuota metían datos del usuario
directamente dentro de un atributo `onclick=""`. Un nombre de cliente con comillas o
código rompía el HTML y podía ejecutar JS.

**Causa.** Generación de HTML por concatenación de strings sin separar dato de handler.

**Solución.** Delegación de eventos en `document` (`_initEventDelegation()`):
- `.btn-whatsapp[data-msg]` — mensaje en base64 **UTF-8-safe** (`atob` solo no soporta emojis)
- `.btn-pay[data-cuota-id]` — id JSON percent-encoded (tolera ids string y numéricos)

**Archivos.** `src/app/00-core.js`, `src/app/02-render.js`

**Regla derivada.** 🔴 **Nunca metas datos del usuario en un `onclick`.** `data-*` + delegación.

---

## BUG-03 — `montoPagado > monto` dejaba el total a cobrar en negativo
**Fecha:** ~06/2026 · **Riesgo:** 🟠 MEDIO

**Causa.** Datos viejos o backups adulterados con una cuota pagada de más.

**Solución.** Dos capas: `_fixCuotasSaldadas()` acota `montoPagado` al `monto` en cada
arranque (idempotente), y `pagarCuota()` **lanza un error** si el pago excede lo que resta.

**Archivos.** `src/app/00-core.js`, `src/db.js`

---

## BUG-04 — Sobrepago de cuotas sin validar
**Fecha:** ~05/2026 · **Riesgo:** 🟠 MEDIO

**Solución.** `DB.pagarCuota()` lanza
`Sobrepago de X: solo resta Y para esta cuota`. El fuzzer lo trata como rechazo legítimo,
no como falla.

**Archivos.** `src/db.js`

---

## BUG-05 — Borrar una venta hecha con stock 0 inventaba stock
**Fecha:** ~06/2026 · **Riesgo:** 🔴 ALTO

**Descripción.** Si vendías con stock en 0 (venta sin inventario) y después borrabas la
venta, la app **devolvía una unidad al inventario que nunca había existido**.

**Causa.** `deleteVenta` asumía que toda venta había descontado exactamente 1 unidad.

**Solución.** La venta ahora guarda `stockDescontado` (bool) y `unidadesDescontadas`
(número exacto). Al borrar se devuelve exactamente eso. Las ventas viejas sin el flag
mantienen el comportamiento anterior para no alterar historiales existentes.

**Archivos.** `src/db.js` (`addVenta`, `updateVenta`, `deleteVenta`)

---

## BUG-06 — Editar una venta movía el stock aunque no cambiara nada relevante
**Fecha:** ~06/2026 · **Riesgo:** 🟠 MEDIO

**Solución.** `updateVenta` calcula `cambioStock` (¿cambió el perfume o la cantidad?) y
solo reconcilia el inventario si es `true`. Editar cliente o nota no toca `perfumes`.

**Archivos.** `src/db.js`

---

## BUG-07 — El cifrado duplicaba registros en cada `put()`
**Fecha:** ~06/2026 · **Riesgo:** 🔴 ALTO

**Descripción.** Con licencia activa, cada actualización de un registro **creaba una copia**
en vez de actualizarlo. Las bases de usuarios reales se llenaron de duplicados.

**Causa.** El payload se cifraba entero, **incluido el `id`**. IndexedDB no podía leer la
clave del blob, así que `put()` no encontraba el registro existente y lo insertaba nuevo.

**Solución.**
1. El `id` se conserva **fuera** del payload cifrado: `{ _encrypted, _v, id }`.
2. Al descifrar, la clave real del store sana el `id` del payload.
3. `dedupEncryptedRecords()` limpia las bases ya afectadas: agrupa por el `id` interno, se
   queda con la escritura más reciente y borra las copias. Idempotente, corre en cada init.

**Archivos.** `src/db.js:12-77`

**Regla derivada.** 🔴 Al tocar el cifrado, **la clave del store nunca puede quedar dentro
del blob**.

---

## BUG-08 — `/version` devolvía `1.1.0` fijo
**Fecha:** ~07/2026 · **Riesgo:** 🟠 MEDIO

**Descripción.** El endpoint devolvía una versión **más vieja que la app**, así que
`_isNewerVersion()` siempre daba `false` y el chequeo de actualizaciones nunca disparaba.

**Causa.** Tres copias manuales de la versión: `package.json`, `sw.js` (decía `1.7.0`) y
`functions/version.js` (decía `1.1.0`).

**Solución.** La versión vive **solo en `package.json`**. `scripts/build.js` la propaga a
`index.html`, `sw.js` y `functions/version.js`, y **falla el build** si no encuentra dónde
escribirla.

**Archivos.** `scripts/build.js`, `sw.js`, `functions/version.js`

**⚠️ Segunda mitad del bug, cerrada después (07/2026):** aunque la versión ya se
sincronizaba, `/version` **no estaba ruteado en `worker.js`** — no figuraba en `GET_ROUTES`
ni se importaba, así que la request caía en `ASSETS.fetch()` y devolvía 404. Además el
handler exportaba `export default { fetch }` en vez de `onRequestGet`, así que el router
no podía consumirlo. Durante ~3 semanas la app no tuvo canal de actualización.

**Regla derivada.** 🔴 Agregar un endpoint son **tres** pasos en `worker.js`: importarlo,
listarlo en `POST_ROUTES`/`GET_ROUTES` y agregar el `if`. Saltear el segundo da 404 aunque
el archivo exista y esté importado.

---

## BUG-09 — El Service Worker recargaba la app en la primera visita de cada usuario
**Fecha:** ~07/2026 · **Riesgo:** 🟠 MEDIO

**Descripción.** Cada usuario nuevo entraba y la app se recargaba sola a los dos segundos.
Primera impresión pésima.

**Causa.** El handler de `controllerchange` recargaba siempre. En la primera visita,
`clients.claim()` dispara ese evento aunque no haya ninguna actualización.

**Solución.** Guard `ptTeniaController`: solo recarga si **ya había** un controller.
Además, `_hayTrabajoEnCurso()` impide recargar encima de un formulario en curso o un
modal abierto.

**Archivos.** `sw.js`, `src/app/17-auto-update.js`

---

## BUG-10 — Cuotas con vencimiento inválido a fin de mes
**Fecha:** ~05/2026 · **Riesgo:** 🟡 BAJO

**Descripción.** Sumar meses a una fecha del 31 producía fechas inválidas (31 de febrero).

**Solución.** Cálculo seguro en `addVenta`: fija año y mes, y acota el día al último día
real de ese mes.

**Archivos.** `src/db.js`

---

## BUG-11 — Los datos de demo reaparecían mezclados con los reales
**Fecha:** ~06/2026 · **Riesgo:** 🟠 MEDIO

**Descripción.** Si el usuario borraba todos sus datos (o se quedaba sin perfumes), al
reabrir la app **reaparecían 8 perfumes y 13 ventas de demo** mezclados con los reales.

**Causa.** `seedDemo()` sembraba si la base estaba vacía, sin recordar que ya había sembrado.

**Solución.** Bandera `localStorage.pt_demo_seeded`: se siembra **una sola vez en la vida
de la instalación**. Si ya hay datos del usuario, marca la bandera y no toca nada.

**Archivos.** `src/db.js:651-665`

**Nota.** Los tests E2E usan esa bandera como señal de "la app terminó de arrancar".

---

## BUG-12 — Número de cuotas sin límite superior
**Solución.** Máximo 12, validado en `db.js` (lanza error) y en el formulario de edición.

## BUG-14 — Si fallaba la creación de cuotas, la venta quedaba huérfana
**Solución.** `addVenta` captura, loguea y **propaga** el error en vez de tragárselo.

---

## BUG-15 — Fechas leídas al revés al importar de Excel
**Fecha:** ~07/2026 · **Riesgo:** 🟠 MEDIO

**Descripción.** Una planilla con formato mes/día (`7/20/2026`) se leía como día/mes: la
venta terminaba en **agosto de 2027**, silenciosamente.

**Causa.** El importador asumía día/mes (formato LATAM) sin verificar.

**Solución.** `_impDetectarFormatoFecha()` analiza **toda la columna** y deduce el formato
por evidencia (un valor > 12 en la primera posición descarta mes/día). El usuario puede
corregirlo a mano.

**Archivos.** `src/app/26-importar-excel.js`

---

## BUG-16 — Cuota `1/3` interpretada al revés
**Fecha:** ~07/2026 · **Riesgo:** 🟡 BAJO

**Descripción.** Se interpretaba el numerador como "cuota número N". El usuario aclaró que
en su planilla el numerador es **cuántas cuotas ya están pagas**: `1/2` = 2 cuotas, 1 paga;
`0/2` = 2 cuotas, ninguna paga; `1/1` = pago directo.

**Solución.** `tipo: 'cuotas'` devuelve `{ total, pagadas }` con la semántica correcta.

**Archivos.** `src/app/26-importar-excel.js`

**Lección.** El dato del usuario mandaba sobre mi interpretación. Cuando algo del dominio
no cierra, se pregunta.

---

## BUG-17 — Deshacer una devolución perdía la deuda del cliente 🐛⭐
**Fecha:** 07/2026 · **Riesgo:** 🔴 ALTO · **Lo encontró el fuzzer**

**Descripción.** Al deshacer una devolución, la venta **volvía a contar para la ganancia**
pero las cuotas canceladas **no se recreaban**. Una venta de $3000 en 3 cuotas con una
paga quedaba con **$0 por cobrar** en vez de $2000. El cliente debía plata y la app decía
que no.

**Causa.** `devolverVenta()` borra las cuotas impagas (correcto). `revertirDevolucion()`
reponía el stock y limpiaba las marcas, pero nunca recreaba las cuotas.

**Solución.** `revertirDevolucion()` recrea las cuotas faltantes (por `numero`), respetando
las ya cobradas y recalculando montos con la última cuota absorbiendo el resto.

**Archivos.** `src/db.js:351-378`, `tests/f3.spec.js`

**Por qué importa.** Es exactamente la clase de bug más cara de esta app: un número de
plata mal, sin ningún error visible. Lo encontró una secuencia aleatoria del fuzzer, no
una revisión humana. **Ese fue el argumento para dejar el fuzzer en CI.**

**⚠️ Deuda pendiente:** el comentario en `db.js:331-333` todavía dice que las cuotas *no*
se recrean. Ver [TODO.md](TODO.md) §T-02.

---

## BUG-18 — La lista de alertas de stock tapaba el inventario
**Fecha:** 07/2026 · **Riesgo:** 🟡 BAJO

**Descripción.** Con 14 perfumes agotados, la lista de alertas ocupaba toda la pantalla y
el inventario quedaba abajo, invisible.

**Solución.** Resumen colapsable: 3 visibles + "Ver todos" (`toggleAlertasStock()`).
Además cuenta unidades, no ventas.

**Archivos.** `src/app/02-render.js`

---

## BUG-19 — La imagen Open Graph estaba corrupta y además no se usaba
**Fecha:** 07/2026 · **Riesgo:** 🟢 BAJO

**Descripción.** El PNG tenía el titular superpuesto y sin fuentes cargadas. Y la landing
**ni siquiera lo referenciaba**.

**Solución.** `scripts/build-og.js` rasteriza `scripts/og-image.html` con Chromium
(`npm run build:og`), y la landing ahora sí lo usa.

---

## BUG-20 — La pantalla de cuotas se congelaba con historial grande
**Fecha:** 07/2026 · **Riesgo:** 🟠 MEDIO · **Lo encontró la prueba de volumen**

**Descripción.** Con 2000 ventas, la pantalla de cobros tardaba **297 ms** y dejaba
**22.040 nodos** en el DOM. Era la única pantalla fuera de rango.

**Causa.** Dos problemas sumados:
1. `renderCuotas()` recalculaba el vencimiento más próximo **dentro del comparador del
   `sort`** — miles de `filter` + `sort` repetidos.
2. Volcaba las cientos de tarjetas de una sola vez.

**Solución.** Precálculo del vencimiento más próximo por grupo + paginado de a 30
(`_CUOTAS_PAGINA`, `verMasCuotas()`, reset al reentrar).
**297 ms → 16 ms**, DOM de 22.040 → 6.532 nodos.

**Archivos.** `src/app/02-render.js`, `tests/volumen.spec.js`

**Salvaguarda.** El total adeudado sigue calculándose sobre **todas** las cuotas.
Hay tests que lo verifican y que fallan si vuelve a aparecer trabajo dentro del `sort`.

---

## Bugs de la suite de tests (no de producción)

Se documentan porque cuestan tiempo y se repiten.

| Problema | Causa | Solución |
|---|---|---|
| El test lee `App.ventas` y ya está poblado | `App.ventas` es `[]` desde el objeto literal: `!== undefined` resuelve al instante | Esperar `pt_demo_seeded === '1'` + settle |
| El test lee el DOM viejo | `renderAll()` está debounceado 100 ms | Llamar `App.renderDashboard()` directo |
| Violación de strict-mode del locator | `.tag-devuelta` matcheaba en `#ventas-recientes` **y** `#ventas-all-list` | Scopear el locator |
| "datos íntegros: false" en volumen | Esperaba `App.ventas.length > 100` pero leía `App.cuotasData`, que `loadData()` llena después | Esperar `#splash` detached |
| Paginación mostraba 1 card en vez de 30 | `sembrar()` escribe en la base pero no llama `App.loadData()` | Agregar `await App.loadData()` |
| Suite E2E rota (4/8) | Modal de consentimiento bloqueante + espera de arranque que se cumplía siempre + recarga del SW | Setear banderas en `addInitScript` + guard de `controllerchange` |

---

## Falsos positivos que costaron tiempo

| "Bug" | Realidad |
|---|---|
| Las cuotas de una venta devuelta no suman su `precioVenta` | **Es el diseño.** Al devolver se cancelan las impagas. La invariante del fuzzer estaba mal escrita, no el código |
| `registrarCompra` cambia el `precioCompra` del perfume | **Es intencional.** El costo de la última tanda es el costo de referencia (F4) |
| Una venta importada de Excel no descuenta stock | **Es intencional.** Van sin `perfumeId`: son históricas y la planilla ya las descontó |
| `2/2` deja 2 cuotas pagas, no 1 | Correcto: el numerador es cuántas están pagas |

---

## BUG-21 — Dos pestañas inventaban inventario 🐛⭐
**Fecha:** 07/2026 · **Riesgo:** 🔴 ALTO · **Lo encontraron los tests de concurrencia**

**Descripción.** Con dos pestañas abiertas vendiendo en paralelo: 20 ventas que decían
haber descontado 20 unidades, y el stock bajaba solo **13**. Siete unidades de inventario
inventadas, sin ningún error a la vista. El usuario creía tener 37 frascos y tenía 30.

**Causa.** Leer-modificar-escribir en dos transacciones distintas. `DB.get()` y `DB.put()`
abren transacciones separadas, así que las dos pestañas leían `stock = 50` y las dos
escribían `49`: un descuento se perdía.

No se pueden unir en una sola transacción: con cifrado activo, descifrar es `async`, y un
`await` cierra la transacción de IndexedDB.

**Solución.** `DB._conLockStock()` serializa con **Web Locks** (`navigator.locks`), que es
lo único que cruza pestañas del mismo origen. Donde no está, cae a una cola en memoria: no
cubre dos pestañas pero sí dos operaciones simultáneas en la misma.

Quedan envueltos `addVenta`, `updateVenta`, `deleteVenta`, `devolverVenta`,
`revertirDevolucion`, `registrarCompra` y `eliminarCompra`.

**⚠️ `entregarReserva` NO se envuelve**: llama a `addVenta`, que ya toma el lock, y
**Web Locks no es reentrante** — se trabaría para siempre.

**Archivos.** `src/db.js`, `tests/concurrencia.spec.js`

**Por qué importa.** Es la misma clase que BUG-17: un número mal, sin error visible. Y es
la razón por la que "escribir los tests que faltan" no es trabajo de segunda: el test no
documentó un hueco teórico, encontró corrupción real.

---

## BUG-22 — El diálogo de confirmar quedaba detrás de otro modal
**Fecha:** 07/2026 · **Riesgo:** 🟠 MEDIO

**Descripción.** Cualquier `appConfirm()` disparado desde adentro de otro modal aparecía
**detrás** y no se podía tocar el botón. Afectaba a **borrar un perfume desde el modal de
edición**, que estaba roto en producción.

**Causa.** `.modal-overlay` tenía `z-index: 200` para todos. Entre dos elementos con el
mismo z-index gana el que está más abajo en el HTML, y `#modal-add-perfume` (línea 468)
va después de `#modal-confirm` (línea 438).

**Solución.** `#modal-confirm` y `#modal-prompt` pasan a `z-index: 300`. Son diálogos que
por definición van arriba de todo.

**Archivos.** `src/styles/17-modal.css`

**Cómo apareció.** Agregando el aviso de perfume duplicado, que también usa `appConfirm`
desde adentro del modal de alta. El test E2E nuevo falló con
*"subtree intercepts pointer events"* y ahí saltó que el bug ya existía.

**Regla derivada.** 🟠 Un diálogo que puede abrirse desde adentro de otro modal necesita
z-index propio. No alcanza con que "los modales tengan z-index".
