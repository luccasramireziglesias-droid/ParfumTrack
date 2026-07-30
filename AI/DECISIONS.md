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


---

## D-21 — Web Locks para serializar el stock, no una transacción única

**Decisión.** `DB._conLockStock()` serializa con `navigator.locks`; los métodos que tocan
stock son wrappers finos sobre un `_xImpl`.

**Contexto.** Dos pestañas vendiendo en paralelo perdían descuentos: 20 ventas bajaban el
stock 13 (BUG-21).

**Por qué no una sola transacción de IndexedDB.** Sería lo canónico, pero **no se puede**:
con cifrado activo, descifrar es `async`, y un `await` cierra la transacción. Leer,
descifrar, modificar, cifrar y escribir dentro de una transacción es imposible por diseño.

**Por qué Web Locks y no un mutex en memoria.** El caso que importa es **entre pestañas**,
y un mutex en memoria no cruza contextos. Web Locks sí, y está en todos los navegadores
que interesan. Igual hay fallback a una cola en memoria.

**Costo aceptado.** Las operaciones de stock se serializan globalmente. Es irrelevante:
son acciones del usuario, de a una.

**Trampa.** 🔴 Web Locks **no es reentrante**. `entregarReserva` no toma el lock porque
llama a `addVenta`, que ya lo tiene — si lo tomara, se trabaría para siempre.

---

## D-22 — El CSRF se exige en la app, no en la landing

**Decisión.** `CSRF_ROUTES` cubre `/trial`, `/validate-license`, `/backup` y `/sync`.
`/mp-create-preference` queda afuera.

**Por qué.** La landing es una página estática de marketing sin el objeto `App` ni el
token. Exigir el header ahí **rompe el checkout**, que es el camino de conversión
principal.

**Qué se pierde.** Poco: lo peor que puede lograr un atacante en ese endpoint es que
alguien genere una preferencia de pago a su propio nombre. No hay cambio de estado de
valor, y el pago lo autentica Mercado Pago.

**Alternativa evaluada.** Generar el token también en la landing. Descartada por ahora:
más superficie por una protección de bajo valor.

**Reabrir si.** La landing crece a llamar endpoints que sí mutan estado.

---

## D-23 — Los diálogos de confirmar van en su propia capa

**Decisión.** `#modal-confirm` y `#modal-prompt` tienen `z-index: 300`; el resto de los
modales, 200.

**Por qué.** Con todos en 200, entre dos overlays ganaba el que estaba más abajo en el
HTML. Cualquier `appConfirm()` disparado desde adentro de otro modal quedaba detrás y no se
podía tocar — **borrar un perfume desde el modal de edición estaba roto en producción**
(BUG-22).

**Regla derivada.** Un diálogo que puede abrirse desde adentro de otro modal necesita capa
propia. No alcanza con que "los modales tengan z-index".


---

## D-24 — El perfil del negocio va al store `config`, no a localStorage

**Decisión.** El perfil (nombre, tipo, teléfono, email, dirección, ciudad, documento, logo)
se guarda en el store `config` bajo la clave `negocio`. El nombre **además** sigue
escribiéndose en `localStorage.pt_negocio`.

**Por qué config.** `config` entra en el export JSON y en el backup a R2, así que el perfil
sobrevive a un cambio de teléfono. localStorage no se respalda.

**Por qué la copia en localStorage.** El header pinta el nombre del negocio **antes** de que
IndexedDB esté abierta. Leerlo de la base obligaría a esperar, o a mostrar "Parfum Track" y
después cambiarlo — un parpadeo en cada arranque.

**Costo aceptado.** 🟠 `config` es el único store **no cifrado**: tiene que ser legible
antes de que exista la clave. El perfil incluye dirección y documento fiscal.

**Confirmado el 29/07/2026** por el dueño del producto, después de plantearle explícitamente
la asimetría: el documento fiscal es el dato **más identificatorio** del perfil —para un
unipersonal argentino el CUIT sale del DNI— y es el único sin cifrar, mientras que sus
ventas, clientes y montos sí lo están.

Se evaluaron tres salidas: dejarlo, cifrar solo ese campo dentro de `config` (viable porque
el PDF es feature Pro y ahí la clave existe), o mover el perfil a un store cifrado.
**Se eligió dejarlo.** El riesgo es acotado —está en el dispositivo del usuario, hace falta
acceso físico o un script que pase la CSP— y el dato va impreso en cada factura que emite.
Pagar complejidad por un riesgo teórico no compensa mientras el cuello de botella del
producto sea la adquisición.

**Por qué se aceptó igual:** son datos que el usuario **elige publicar** — van impresos en
el catálogo que manda por WhatsApp y en los PDF que exporta. No son secretos. La venta
individual (cliente, monto) es más sensible y **sí** está cifrada.

**Reabrir si.** Se agrega al perfil algo que el usuario no querría compartir: datos
bancarios, credenciales de facturación electrónica, o cualquier campo que no vaya impreso
en el catálogo o la factura. Ese es el disparador concreto, no "cuando haya tiempo".

---

## D-25 — Los datos del negocio se usan, no solo se guardan

**Decisión.** Cada campo del perfil tiene un lugar donde sale: nombre y logo en el header,
contacto al pie del catálogo de WhatsApp, contacto y documento en el encabezado del PDF.

**Por qué.** Un formulario que junta datos que nadie lee es trabajo perdido y ruido para el
usuario. Si un campo no tiene destino, no va en el formulario.

**Consecuencia para quien agregue un campo:** definí primero **dónde se ve**. Si la
respuesta es "en ningún lado por ahora", no lo agregues todavía.


---

## D-26 — El header muestra la marca; el catálogo y el PDF, el negocio

**Decisión.** Sin nombre de negocio cargado:
- **Header de la app** → "Parfum Track"
- **Catálogo de WhatsApp y PDF** → "Mi negocio"

**Por qué la diferencia.** Son dos audiencias distintas. El header lo ve el **usuario**, en
la pantalla de la app: mostrar la marca ahí es correcto y es dónde la app se presenta. El
catálogo y el PDF los ve **su cliente**: encabezarlos con "Parfum Track" le estaría
diciendo al cliente que el negocio se llama así.

**Estado.** Confirmado explícitamente por el dueño del producto el 29/07/2026. Cubierto por
el test *"sin nombre cargado muestra la marca"* en `tests/header.spec.js`.

**No reabrir** salvo que cambie la estrategia de marca (por ejemplo, si se decide sacar
"Parfum Track" de la vista del usuario final).

---

## D-27 — El PIN se queda en "Más" (provisional)

**Decisión.** El toggle de PIN sigue en la pantalla `mas`, no en la card del perfil del
negocio.

**Por qué.** El PIN protege el **dispositivo**, no es parte de la identidad del negocio.
La card de "Mi negocio" agrupa lo que ve el cliente (nombre, logo, contacto); el PIN no
sale en ningún lado hacia afuera.

**Estado.** 🟡 **Provisional.** El dueño del producto lo dejó ahí "por ahora" el
29/07/2026. A diferencia del resto de las decisiones de este archivo, esta se puede mover
sin discusión: no hay test que la fije, justamente para no trabar el cambio.

**Reabrir si.** Se agrupa la configuración de seguridad (PIN + cifrado + backup) en un solo
lugar, que sería el momento natural para moverlo.

---

## D-28 — La landing no afirma tener usuarios hasta tenerlos

**Decisión.** Ningún número de usuarios, ventas o clientes en la landing mientras no sea
real y sostenible con datos.

**Qué había.** El hero decía *"+340 revendedores en LATAM ya organizan su negocio con
Parfum Track"* y la barra de stats repetía *"+340 · Revendedores en LATAM"*, con el
producto en 0 usuarios (ver `MARKETING-SEMANA-1.md`, cuya Fase 0 es justamente conseguir
los primeros 20-30).

**Por qué.**
1. **Es publicidad engañosa** y está regulada en los cuatro mercados objetivo
   (AR/UY/CO/MX). Con una app que cobra suscripción y maneja la plata del usuario, es un
   riesgo desproporcionado al beneficio.
2. **Pelea con la propia estrategia.** El plan apuesta al ángulo "sé de los primeros" y a
   conseguir testimonios reales. No se puede pedir eso mientras el hero dice que ya son 340.
3. **Quema lo único que cuesta construir.** Un usuario que descubre el número inflado no
   te va a confiar los números de su negocio. Ver `ROADMAP.md` §7: la confianza es la
   objeción #1.

**Con qué se reemplazó.** Hero: *"Recién lanzada · Probala gratis y contanos qué le falta"*
— honesto, y además invita al feedback que la Fase 0 necesita. Stat: *"Tus datos · Solo en
tu celular"*, que es la ventaja real y verificable (D-03).

**Cuándo se puede volver a poner un número.** Cuando exista y se pueda sostener. El lugar
es el mismo; hay que actualizar `tests/landing-contenido.test.js`, que hoy falla ante
cualquier afirmación de la forma "N revendedores/usuarios/clientes".

---

## D-29 — Los títulos de la landing van en Cormorant Garamond

**Decisión.** `.hero h1`, `.section-h2`, `.cta-final-h2`, `.feature-hero-title` y
`.demo-title` usan Cormorant Garamond, igual que la app.

**Por qué.** Es la regla de marca del proyecto ("Cormorant Garamond títulos, DM Sans
body"), pero la landing la cumplía en **un solo** elemento (el h2 del footer) contra 18
lugares en la app: parecían dos productos distintos. Y para un producto de perfumería, la
serif comunica el registro que el palo seco geométrico no da.

**Tres cosas que hay que respetar al tocar esto** (las fija
`tests/landing-contenido.test.js`):
- **Peso máximo 700.** `fonts/fonts.css` solo trae Cormorant en 400, 600 y 700. Pedir
  800/900 hace que el navegador lo simule engrosando los trazos y queda sucio.
- **Tamaño ~15% mayor.** Cormorant tiene la x más chica que DM Sans; al mismo `px` se ve
  más chico.
- **Sin tracking negativo.** El `letter-spacing: -1.5px` es un recurso de palo seco; en una
  serif junta las letras.

**Lo que NO cambió.** El body, los botones, las stats y todo el texto corrido siguen en
DM Sans. La serif es solo para titular.
