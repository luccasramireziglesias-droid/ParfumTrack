# DECISIONS — Decisiones técnicas

**El propósito de este archivo es evitar volver a debatir lo ya decidido.**

Si estás por proponer "¿y si usamos React?" o "¿y si guardamos los datos en el servidor?",
leé la entrada correspondiente primero. Cada decisión tiene contexto, alternativas
evaluadas y el costo que se aceptó a sabiendas.

**Cuándo reabrir una decisión:** solo si cambió el contexto que la justificaba. Ese
contexto está escrito en cada entrada, justamente para poder verificarlo.

---

## D-01 — Sin framework ni bundler

**Decisión.** HTML + CSS + JS vanilla, todo en un único `index.html` con el JS y el CSS
inline.

**Contexto.** El usuario objetivo abre la app en un celular de gama baja, en LATAM, con
datos móviles caros y conexión inestable.

**Por qué.**
- Un solo request y la app entera funciona.
- Offline real sin resolver dependencias entre chunks.
- Cero superficie de build que pueda romperse.
- Sin costo de runtime de framework en dispositivos lentos.

**Alternativas evaluadas.** React/Vue/Svelte + Vite: mejor experiencia de desarrollo, pero
más bytes, más complejidad de build y un modelo offline más difícil de razonar.

**Costo aceptado.** Sin componentes reutilizables del tipo framework, sin tipado, y
`'unsafe-inline'` obligatorio en la CSP.

**Reabrir si.** El equipo crece a varias personas y la falta de aislamiento entre módulos
empieza a generar colisiones reales de nombres.

---

## D-02 — Modularizar el fuente y concatenar en el build

**Decisión.** Editar en `src/`; `scripts/build.js` genera `index.html` por concatenación
de texto.

**Contexto.** D-01 dejó un monolito de 6.400 líneas imposible de mantener.

**Por qué.** Se obtiene la mantenibilidad de módulos sin perder el artefacto de un solo
archivo. Y es concatenación pura: no hay transpilación que pueda alterar la semántica.

**Alternativas evaluadas.** ES modules nativos (rompía los ~200 `onclick="App.metodo()"`
del HTML) y un bundler (contradecía D-01).

**Costo aceptado.** El orden alfabético de los archivos importa; no puede haber nombres de
método duplicados (el último gana en silencio); no se pueden usar `import`/`export`.

**Salvaguarda.** `build.js` **falla ruidosamente** si queda un placeholder sin resolver o
falta el marcador de una pantalla. CI verifica que `index.html` esté commiteado sin drift.

---

## D-03 — Los datos del usuario viven solo en su dispositivo

**Decisión.** IndexedDB local. No hay base de datos de usuarios en el servidor.

**Por qué.**
- **Privacidad real, no declarada.** No hay una base central que filtrar.
- **Costo cero** de almacenamiento por usuario.
- **Offline por diseño**, no como feature agregada.
- Es un argumento de venta genuino frente a la competencia.

**Alternativas evaluadas.** Backend con Postgres/Supabase: habilita sync y multi-dispositivo,
pero agrega costo por usuario, responsabilidad legal sobre datos ajenos y dependencia de
conectividad.

**Costo aceptado.** 🔴 **Si el usuario pierde el dispositivo sin backup, no hay
recuperación.** Se mitiga con `navigator.storage.persist()`, export JSON y backup cifrado
a R2 — pero el riesgo residual es real y es del usuario.

**Reabrir si.** El plan Pro con sync multi-dispositivo pasa a ser el producto principal.
Incluso entonces, lo correcto sería sync cifrado extremo a extremo, no una base legible.

---

## D-04 — Cifrado solo con licencia

**Decisión.** AES-GCM se activa únicamente si existe `localStorage.pt_license_code`.

**Por qué.** El cifrado necesita una clave derivada del PIN, que forma parte del flujo de
cuenta. Sin licencia no hay cuenta ni PIN.

**Costo aceptado.** 🟠 Los usuarios del plan Free tienen los datos **en claro** en
IndexedDB. En un dispositivo compartido, cualquiera con acceso al navegador puede leerlos.

**Nota honesta.** Esto convierte al cifrado en algo cercano a una feature de pago, cuando
podría argumentarse que la privacidad no debería serlo. Está registrado como decisión
consciente, no como olvido.

**Reabrir si.** Se decide ofrecer cifrado con PIN también en el plan Free.

---

## D-05 — Los clientes no tienen object store

**Decisión.** Se derivan al vuelo de `ventas` + `cuotas` en `18-clientes.js`.

**Por qué.** Un store de clientes se desincroniza: borrás una venta y el total del cliente
queda viejo. Derivarlos hace **imposible** esa inconsistencia.

**Costo aceptado.** Se recalcula en cada render (barato para los volúmenes medidos) y no se
pueden guardar datos propios del cliente (teléfono, notas) sin crear el store.

**Consecuencia visible.** Devolver la única venta de un cliente hace que el cliente
**desaparezca** de la lista. Es correcto, y hay un test que lo verifica.

**Reabrir si.** Se quiere guardar teléfono, dirección o notas por cliente.

---

## D-06 — Sin router de URL

**Decisión.** `showScreen(nombre)` alterna la clase `.active`. La URL nunca cambia.

**Por qué.** Es una PWA con bottom nav que se usa como app nativa. Un router agregaba
complejidad sin resolver un problema real.

**Costo aceptado.** No se puede compartir un link a una pantalla; el botón "atrás" del
navegador sale de la app; recargar vuelve siempre a `inicio`.

**Reabrir si.** Aparece la necesidad de deep links a pantallas específicas (hoy solo existe
`?activate=` para licencias).

---

## D-07 — La versión vive solo en `package.json`

**Decisión.** `build.js` la propaga a `index.html`, `sw.js` y `functions/version.js`.

**Por qué.** Había tres copias manuales desincronizadas: `sw.js` decía `1.7.0` y
`functions/version.js` decía `1.1.0` — **más vieja que la app**, así que el chequeo de
actualizaciones nunca disparaba. Ver [BUG_HISTORY.md](BUG_HISTORY.md) §BUG-08.

**Salvaguarda.** `build.js` **falla** si no encuentra dónde escribir la versión.

---

## D-08 — Migraciones aditivas, nunca destructivas

**Decisión.** `onupgradeneeded` solo crea stores que no existen. Nunca `deleteObjectStore`,
nunca cambiar un `keyPath`.

**Por qué.** Hay usuarios reales con bases v3 en la calle. Una migración destructiva les
borra el historial del negocio.

**Patrón.** Guarda por existencia, no por número de versión — así un salto v3 → v5 crea
`compras` y `reservas` en una sola pasada.

**Salvaguarda.** Un test E2E abre una base v3 real y verifica que llegue a ≥5 con los datos
intactos.

---

## D-09 — Migraciones de datos idempotentes, no one-time

**Decisión.** `dedupEncryptedRecords()`, `_fixStringCuotaIds()` y `_fixCuotasSaldadas()`
corren en **cada** arranque, sin bandera.

**Por qué.** Un import puede reintroducir el problema en cualquier momento. Una migración
one-time solo lo arregla una vez.

**Excepción.** `_fixCorruptDates()` sí usa bandera (`pt_dates_fixed_v3`) porque recorre
todas las ventas y es cara.

**Costo aceptado.** Trabajo en cada arranque. Se mitiga compartiendo una sola lectura de
cuotas entre las tres migraciones.

---

## D-10 — La venta guarda totales; el formulario trabaja por unidad

**Decisión.** `precioVenta` y `precioCompra` son **totales**. Los unitarios se guardan
aparte.

**Por qué.** Toda agregación de plata suma `precioVenta` directo. Si guardara unitarios,
cada suma tendría que multiplicar por `cantidad`, y **cualquier lugar donde te olvides**
produce un número mal en silencio.

**Costo aceptado.** El formulario tiene que convertir en ambos sentidos, y las ventas
viejas sin `cantidad` valen 1.

---

## D-11 — Devolver marca, no borra

**Decisión.** `devolverVenta()` marca `devuelta: true`. La venta sigue en el historial.

**Por qué.** Una devolución **es un hecho del negocio**, no un error de carga. Borrarla
perdía el registro de que pasó y por qué.

**Consecuencia estructural.** 🔴 **Toda agregación de plata tiene que usar
`_ventasActivas()`**, nunca `this.ventas`. Hay un test que falla si aparece
`this.ventas.filter(` en `02-render.js`.

**Regla de cuotas.** Al devolver se cancelan las impagas (dejan de ser deuda) y se
conservan las cobradas (ese cobro sí ocurrió).

---

## D-12 — Una reserva no descuenta stock

**Decisión.** Las reservas (F5) no tocan el inventario hasta entregarse.

**Por qué.** El caso más común es señar un perfume que **todavía no está en stock**
(lista de espera). Descontar rompería el inventario.

**Al entregar.** La reserva se convierte en venta vía `addVenta()`, que ahí sí descuenta.
La seña ya cobrada **no se suma de nuevo**: es parte del precio acordado, y queda anotada
en la nota de la venta.

---

## D-13 — Importar Excel AGREGA; importar JSON REEMPLAZA

**Decisión.** Dos operaciones deliberadamente opuestas.

**Por qué.** Son intenciones distintas: restaurar un backup propio quiere volver a un
estado conocido; traer una planilla quiere **sumar** el historial anterior a lo que ya
hay en la app.

**Costo aceptado.** 🟠 Importar la misma planilla dos veces duplica las ventas. No hay
deduplicación.

---

## D-14 — Las ventas importadas van sin `perfumeId`

**Decisión.** Intencional, no un bug.

**Por qué.** Son ventas **históricas**: el stock que el usuario carga desde la planilla ya
las tiene descontadas. Ponerles `perfumeId` haría que descuenten stock **dos veces**.

**Costo aceptado.** Esas ventas no aparecen en las estadísticas por perfume. Es el
compromiso correcto: un stock mal es peor que una estadística incompleta.

---

## D-15 — Fuzzer y sondas de riesgo en CI

**Decisión.** `tests/fuzz.spec.js` tira secuencias aleatorias con semilla fija y verifica
invariantes después de **cada** operación. `tests/riesgos.spec.js` prueba las zonas que
nada cubría.

**Por qué.** Encontró un bug real de pérdida de datos que ninguna revisión humana había
visto (BUG-17: deshacer una devolución perdía la deuda del cliente). Ese solo hallazgo
justificó dejarlo en CI.

**Semilla fija.** Una falla se tiene que poder reproducir. El fuzzer imprime la secuencia
exacta de operaciones que llevó al problema.

**Costo aceptado.** Suma tiempo a CI. Configurable: `FUZZ_CORRIDAS=30 FUZZ_OPS=120`.

---

## D-16 — Los E2E frenan el deploy

**Decisión.** El job `deploy` depende de `[test, e2e]`.

**Por qué.** La suite E2E estuvo **rota en silencio** (4/8 pasando) por el modal de
consentimiento y una espera de arranque que se cumplía siempre. Si no frena el deploy, se
vuelve a romper y nadie se entera.

**Costo aceptado.** ~3 minutos más por deploy.

---

## D-17 — Cloudflare Workers con Assets (no Pages)

**Decisión.** Un solo Worker sirve la API y los estáticos.

**Por qué.** Un solo artefacto, un solo deploy, control total de headers por ruta
(`/sw.js` y `/index.html` necesitan `no-cache` forzado).

**Costo aceptado.** El routing es manual: agregar un endpoint requiere tocar `worker.js`
en tres lugares. **Ese es justamente el paso que se olvidó con `/version`** — el archivo
existe pero nunca se ruteó. Ver [TODO.md](TODO.md) §T-01.

---

## D-18 — Android vía Capacitor con `server.url`

**Decisión.** La app nativa **carga la web remota**, no empaqueta el HTML.

**Por qué.** Una sola base de código y las actualizaciones llegan sin pasar por la revisión
de Play Store.

**Costo aceptado.** 🟠 La app Android **no funciona sin conexión en el primer arranque**
(después el SW cachea). Contradice parcialmente la promesa de "funciona offline" en ese
caso puntual.

---

## D-19 — El español es el idioma fuente de i18n

**Decisión.** Las claves de traducción **son** los textos en español. `t()` devuelve el
texto tal cual si no hay diccionario.

**Por qué.** El mercado es LATAM; el español no es una traducción, es el original. Y
permitió introducir i18n **sin tocar ningún call site**.

**Para sumar un idioma** (ej. pt-BR) alcanza con completar `_i18n.pt`: `toast()` y
`appConfirm()` ya pasan por `t()`.

---

## D-20 — El splash está en el HTML estático

**Decisión.** `#splash` se pinta antes de que corra el JS, y se oculta en el `finally`
de `init()`.

**Por qué.** Si lo generara el JS, la pantalla quedaría en blanco justo durante el tramo
que se quiere cubrir.

**El `finally` importa.** Si el arranque falla, el splash se saca igual y el usuario ve la
pantalla de error con un botón de reintentar, en vez de quedarse mirando el logo.

**Detalles.** Mínimo 420 ms visible (para que no sea un flash) y se **saca del DOM** al
terminar el fundido: si queda, intercepta toques.
