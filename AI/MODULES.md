# MODULES — Módulos de ParfumTrack

**Leé solo la sección del módulo que vas a tocar.** No leas este archivo entero.

Todos los módulos de `src/app/` aportan métodos al mismo objeto global `App`
(salvo `15-encryption.js`, que define `ENCRYPTION`). No hay imports: cualquier módulo
puede llamar `this.metodoDeOtroModulo()`.

**Convención de nombres:** un `_` inicial marca método interno. Los métodos sin `_` son
los que el HTML llama vía `onclick="App.metodo()"` — **cambiarles el nombre rompe la UI
silenciosamente**, porque el HTML es texto.

**Patrón `_once`:** los handlers de guardado se parten en dos —
`guardarX()` (público, envuelve en `App._once()` como guarda anti doble-tap) y
`_guardarXImpl()` (la lógica real). Si tocás la lógica, tocá el `Impl`.

---

## `00-core.js` — Estado y arranque · 307 líneas

**Objetivo.** Sostener el estado global y orquestar el arranque.

**Responsabilidad.**
- Declarar los 8 arrays de estado y los flags de UI.
- `init()` con `try/catch/finally` y pantalla de error de arranque.
- Correr las migraciones idempotentes antes de que la app sea usable.
- `loadData()` — la única función que llena el estado.
- Splash, persistencia de storage, CSRF, delegación de eventos, sync entre pestañas.

**Métodos clave.**

| Método | Qué hace |
|---|---|
| `init()` | Wrapper seguro. El splash se oculta en el `finally` |
| `_initInterno()` | La secuencia real de arranque (ver ARCHITECTURE §7) |
| `loadData()` | 8 lecturas completas → 8 arrays. **Recarga todo, siempre** |
| `_mostrarErrorArranque(e)` | Pantalla de error con botón de reintentar |
| `_ocultarSplash()` | Mínimo 420 ms visible; se saca del DOM al terminar el fundido |
| `_pedirPersistencia()` | `navigator.storage.persist()` — evita el desalojo de IndexedDB |
| `_fixCorruptDates()` | Migración **one-time** (bandera `pt_dates_fixed_v3`) |
| `_fixStringCuotaIds(cuotasPre)` | **Idempotente** — los imports reintroducen ids string |
| `_fixCuotasSaldadas(cuotasPre)` | **Idempotente** — sana deuda fantasma y `montoPagado > monto` |
| `_initEventDelegation()` | Clicks delegados en `document` para WhatsApp y pago de cuota |
| `_initTabSync()` / `_notifyTabs()` | `BroadcastChannel('pt_sync')` |
| `_initCsrfToken()` / `_getCsrfToken()` / `_rotateCsrfToken()` | Token CSRF. 🔴 **Síncronos**: el backend rechaza sin token, y una generación async era un 403 en la cara del usuario. `_getCsrfToken()` se cura solo |

**Dependencias.** `DB` (todo), `ENCRYPTION` (indirecto), `02-render` (`renderAll`),
`19-i18n`, `13-onboarding`, `14-pin-lock`, `17-auto-update`.

**Riesgos.**
- 🔴 Agregar un paso lento a `_initInterno()` sube el arranque para **todos** los usuarios.
- 🟠 `_fixCuotasSaldadas()` **condona deuda**: marca cuotas como pagadas. Salta las cuotas
  sin `ventaId` a propósito — agruparlas mezclaría deudas de clientes distintos.
- 🟠 `loadData()` es O(todo). Con volúmenes grandes es el costo dominante del arranque.

**Mejoras futuras.** Carga diferida de los stores que no se usan en el arranque
(`caja`, `gastos`, `compras`, `pedidos`). Ver [TODO.md](TODO.md).

---

## `01-navigation.js` — Navegación · 138 líneas

**Objetivo.** Cambiar de pantalla y manejar el modal de demo.

**Métodos.**

| Método | Qué hace |
|---|---|
| `showScreen(name)` | Alterna `.active`, actualiza la bottom nav y **dispara el render de esa pantalla** |
| `showDemoModal()` / `closeDemoModal()` | Modal del video demo |
| `expandDemoVideo()` | Toggle fullscreen: 100vw/100vh, oculta controles |

**Detalle importante.** `showScreen()` tiene un `if` por pantalla que llama a su render.
**Si agregás una pantalla, tenés que agregar su línea acá** o la pantalla queda en blanco.

**Riesgos.**
- 🟡 `expandDemoVideo()` y `closeDemoModal()` manipulan ~15 estilos inline cada una y
  duplican la lógica de "volver a tamaño normal". Candidato claro a mover a una clase CSS.

---

## `02-render.js` — Render · 831 líneas · ⭐ el módulo central

**Objetivo.** Convertir el estado en HTML. Todo el render de la app vive acá.

**Responsabilidad.** Dashboard, lista de ventas, stock, cuotas, deudores, estadísticas,
rankings, badges de navegación.

**Métodos.**

| Método | Notas |
|---|---|
| `renderAll()` | Rinde **solo** `currentScreen`. Debounce 100 ms |
| `debounce(key, fn, ms)` | Utilidad genérica |
| `renderDashboard()` | Ganancia del mes, navegación por mes, deudores, ventas recientes |
| `changeDashboardMonth(offset)` / `resetDashboardMonth()` | Navegación temporal |
| `_renderVentaCard(v, opts)` | **Compartido** por dashboard y lista. `index` evita `indexOf` O(n²) |
| `renderAllVentas(reset = true)` | Historial + búsqueda. Pagina de a 50 |
| `verMasVentas()` | Suma una página |
| `renderStock()` | Inventario + filtros |
| `_lazyLoadStockPhotos()` | `IntersectionObserver` para las fotos |
| `_renderStockAlerts()` / `toggleAlertasStock()` | Resumen colapsable: 3 visibles + "Ver todos" |
| `renderCuotas(reset = true)` | Pagina de a 30. **Precalcula el vencimiento más próximo** |
| `verMasCuotas()` | Suma una página |
| `switchCuotasView(view)` | Alterna cuotas ↔ deudores |
| `renderDeudores()` | Agrupado por cliente |
| `renderStats()` | Chart.js cargado lazy |
| `renderRankings(ventas)` | Top perfumes / clientes |
| `updateNavBadge()` | Badge de cobros pendientes |

**Invariantes protegidas por tests.**
1. 🔴 **Toda agregación usa `this._ventasActivas()`**, nunca `this.ventas.filter(`.
   Hay un test que falla si aparece esa cadena en este archivo.
2. 🔴 **El total adeudado se calcula sobre TODAS las cuotas**, no sobre las visibles.
3. 🟠 El comparador del `sort` de cuotas **no puede hacer trabajo adentro** (nada de
   `filter`/`map`). Precalculá antes.
4. 🟠 `_renderVentaCard` recibe `index`; no puede usar `indexOf`.

**Riesgos.**
- 🔴 Es el archivo más grande y el que más se toca. Casi todo el riesgo de regresión está acá.
- 🟠 Todo va por `innerHTML`: **cualquier dato del usuario tiene que pasar por `this.esc()`**.

**Mejoras futuras.** Partirlo por pantalla (`02a-dashboard`, `02b-listas`, `02c-stats`).
El build no cambia — solo hay que respetar el orden alfabético.

---

## `03-nueva-venta.js` — Alta de venta · 496 líneas

**Objetivo.** El formulario más usado de la app. Meta: 10 segundos de punta a punta.

**Métodos.**

| Grupo | Métodos |
|---|---|
| Defaults | `_defaultVendedor()`, `_defaultProveedor()`, `_checkVendedorRestriction()` |
| Formulario | `resetVentaForm()`, `toggleVentaDetalles()`, `repetirVenta()` |
| Cantidad (F1) | `_getCantidad()`, `cambiarCantidad()` |
| Cálculo | `calcLiveProfit()` — ganancia en vivo mientras se escribe |
| Autocompletado | `setupAutocomplete()`, `showAutocomplete()` |
| Forma de pago | `setFormaPago()`, `setPrimeraCuota()` |
| Selector de perfume | `openPerfumeSelector()`, `renderPerfumeModal()`, `filterPerfumeModal()`, `selectPerfume()`, `usarPerfumeLibre()`, `crearPerfumeDesdeVenta()` |
| Guardar | `guardarVenta()` → `_guardarVentaImpl()` |

**Regla crítica de datos.** 🔴 El formulario trabaja **por unidad**; la venta guarda
**totales**:

```
precioVenta   = precioUnitario × cantidad
precioCompra  = precioCompraUnitario × cantidad
```

Los unitarios también se guardan (`precioUnitario`, `precioCompraUnitario`) para poder
reabrir el formulario. Las ventas viejas sin `cantidad` valen 1.

**Dependencias.** `DB.addVenta()`, `11-utils` (`parseMonto`, `_once`, `toast`),
`02-render`, `04-stock` (crear perfume al vuelo).

**Riesgos.**
- 🔴 Confundir unitario con total corrompe la ganancia de forma silenciosa.
- 🟠 `_defaultVendedor()` busca el último vendedor usado — nunca hardcodear un nombre.

---

## `04-stock.js` — Inventario · 255 líneas

**Objetivo.** Catálogo de perfumes: alta, edición, foto, ajuste de stock.

**Métodos.** `venderDesdeStock()`, `filterStock()`, `filterStockBy()`, `openAddPerfume()`,
`openEditPerfume()`, `savePerfume()` → `_savePerfumeImpl()`, `adjustStock()`,
`deletePerfumeDesdeModal()`, `handlePerfumePhoto()`, `changeStockPhoto()`, `_processPhoto()`.

**Nota.** `_processPhoto()` está **compartido** con el alta de perfume (DRY): redimensiona
y comprime antes de guardar la imagen en IndexedDB.

**Duplicados.** `_mismoNombre()` compara ignorando mayúsculas, tildes y espacios de más.
Al crear uno que ya existe **avisa** (no bloquea) diciendo cuánto stock tiene el existente
y ofrece editarlo; si el usuario insiste lo crea igual, porque puede ser a propósito (otro
tamaño, otro proveedor).

**Riesgo.** 🟡 Las fotos van a IndexedDB como data URL. Muchas fotos grandes inflan el backup.

---

## `05-cuotas.js` — Pago de cuotas · 78 líneas

**Métodos.** `abrirPagoCuota(id)`, `cerrarPagoCuota()`,
`confirmarPagoCuota()` → `_confirmarPagoCuotaImpl()`, `marcarPagada()`, `cobrarWhatsApp(msg)`.

**Detalles.**
- `abrirPagoCuota` es **tolerante a ids string vs numérico** (backups viejos importados).
- El pago va a `DB.pagarCuota()`, que **lanza `Sobrepago`** si te pasás del monto.
- `_once('pago-cuota', …)` es guarda anti doble-tap — hay un test que lo verifica.

---

## `06-ventas-edit-delete.js` — Editar y borrar · 181 líneas

**Métodos.** `editVenta(id)`, `updateVenta()`, `deleteVenta(id)`.

**Validaciones (obligatorias, hay tests).**
```
precioVenta > 0
0 ≤ descuento ≤ 100
1 ≤ numCuotas ≤ 12
```

**Riesgo.** 🔴 `DB.updateVenta()` reconcilia stock **solo si cambió el perfume o la
cantidad** (`cambioStock`). Editar el cliente o la nota no toca el inventario. Romper esa
condición hace que el stock se mueva en cada edición.

---

## `07-pedidos.js` — Pedidos al proveedor · 374 líneas

**Objetivo.** Armar un pedido con varios perfumes y cantidades, y seguir su estado.

**Métodos.** `renderPedidos()`, `filterPedidos()`, `resetPedidoForm()`,
`addPerfumeToPedido()`, `removePerfumeFromPedido()`, `adjustPedidoPerfumeQty()`,
`guardarPedido()` → `_guardarPedidoImpl()`, `editPedido()`, `showPedidoDetalle()`,
`marcarPedidoEnviado()`, `marcarPedidoPendiente()`, `updatePedido()`, `deletePedido()`,
`updatePedidosBadge()`.

**Estados.** `pendiente` → `enviado` (reversible).

**Riesgo.** 🟡 Los pedidos **no** afectan el stock. La reposición real se registra con
compras (F4). Son dos conceptos distintos que se confunden fácil.

---

## `08-caja.js` — Caja · 79 líneas
**Métodos.** `setCajaTipo()`, `renderCaja()`, `guardarCaja()`, `deleteCaja()`.
Movimientos `entrada`/`salida`. Independiente de ventas y gastos.

## `09-gastos.js` — Gastos · 120 líneas
**Métodos.** `setGastoCat()`, `_renderGastoChips()`, `guardarGasto()` → `_guardarGastoImpl()`,
`renderGastos()`, `deleteGasto()`.
Los chips de montos frecuentes salen del historial del propio usuario.
Los gastos **sí** entran en la ganancia neta del dashboard.

---

## `10-data-management.js` — Datos, export e import · 813 líneas

**Objetivo.** Todo lo que entra y sale de la app.

| Área | Métodos |
|---|---|
| Export JSON | `exportData()`, `_backupFilename()` |
| Import JSON | `importData()`, `_handleImportFile()`, `_normalizeBackupData()`, `_assertRestorable()`, `_restoreData()`, `_parseDate()` |
| PDF / Excel | `exportPDF()`, `exportExcel()` (jsPDF y XLSX lazy, con SRI) |
| Catálogo WA | `compartirCatalogo()`, `previewCatalogo()`, `enviarCatalogo()`, `enviarCatalogoTexto()`, `_renderCatalogoPage()` |
| Nube | `backupToCloud()`, `restoreFromCloud()`, `_getAuthToken()`, `_refreshAuthToken()` |
| Destructivo | `clearData()` |
| Infra | `_loadScript(url)` — carga CDN con `integrity` sha384 |

**🔴 REGLA CRÍTICA.** Este archivo tiene **5 listas `const stores = [...]`**
(líneas ~96, 197, 211, 250, 806). Al agregar un object store hay que sumarlo a **todas**.
Si te olvidás de una, **un restore borra los datos de ese store**. Hay un test que lo verifica.

> La lista de la línea 197 (`_assertRestorable`) es la única que **no** incluye `config`,
> a propósito: valida stores de negocio.

**Riesgos.**
- 🔴 `_restoreData()` **reemplaza** todo. El importador de Excel, en cambio, **agrega**.
- 🟠 `_normalizeBackupData()` es la línea de defensa contra backups viejos o adulterados.
- 🟠 `_loadScript()` es la única carga remota de la app. El SRI sha384 es obligatorio.

---

## `11-utils.js` — Utilidades · 179 líneas

| Método | Qué hace |
|---|---|
| `_once(key, fn, btnEl)` | 🔴 Guarda anti doble-tap. Envolvé **todo** guardado async |
| `fmt(n, forceAbs)` / `fmtSigned(n)` | Formato de moneda. Tope de **2 decimales** (`_MONTO_OPTS`); los dos comparten `_abs()` |
| `esc(s)` | 🔴 Escape HTML. **Obligatorio** para datos del usuario |
| `parseMonto(str)` | Tolera `1.500`, `1,500`, `1500`, `$1.500` |
| `fmtDate(ts)` | Fecha legible |
| `b64Encode` / `b64Decode` | Base64 **UTF-8-safe** (soporta emojis) |
| `toast(msg, icon)` | Notificación efímera, pasa por `t()` |
| `appConfirm()` / `appPrompt()` | Diálogos propios, pasan por `t()` |
| `haptic(type)` | Vibración |
| `track(event, props)` | Plausible |
| `setMoneda` / `loadMoneda` / `setNombreNegocio` / `loadNombreNegocio` | Preferencias |

**Nota.** `fmt()` mostraba hasta 3 decimales (`toLocaleString` sin opciones): `$1.234,567`
se lee como un error en una app de plata. Ahora tope de 2 y los enteros sin coma.

---

## `12-cuenta-licencia.js` — Cuenta y licencia · 329 líneas

**Objetivo.** Trial, registro por OTP, activación de licencia, suscripción, sync manual.

**Métodos.** `_getDeviceId()`, `loadAccount()`, `saveAccount()`, `isPro()`, `updatePlanUI()`,
`updateCuentaScreen()`, `registrarCuenta()`, `verificarOTP()`, `activarLicencia()` /
`_activarLicencia()`, `activarLicenciaInput()`, `activarLicenciaLoggedInput()`,
`suscribirPro()`, `syncToCloud()`, `syncFromCloud()`, `cerrarSesion()`.

**🔴 Efecto lateral crítico.** Activar una licencia escribe `pt_license_code` en
localStorage, y **eso activa el cifrado de los 8 stores de negocio**. La activación no es
solo un cambio de plan: cambia el formato en disco de todos los datos.

**Dependencias.** Endpoints `/trial`, `/validate-license`, `/mp-create-preference`,
`/sync`. `16-key-management` para la master key.

---

## `13-onboarding.js` — Consentimiento · 68 líneas
`checkConsent()`, `acceptConsent()`, `rejectConsent()`, `checkOnboarding()`,
`dismissOnboarding()`, `showTutorial()`.
Banderas: `pt_consent_accepted`, `pt_onboarded`.
> ⚠️ El modal de consentimiento **bloquea la UI**. Los tests E2E setean las dos banderas
> en `addInitScript`, si no la suite entera se cuelga.

## `14-pin-lock.js` — PIN · 127 líneas
`checkPinOnStart()`, `pinInput()`, `pinDelete()`, `_updatePinDots()`, `_hashPin()`,
`_getPinHash()`, `togglePin()`.
El PIN se guarda como **hash SHA-256**, nunca en claro. Alimenta la master key de cifrado.

---

## `15-encryption.js` — Cifrado · 336 líneas · ⚠️ NO es parte de `App`

Define `const ENCRYPTION = {…}`, inyectado en su propio placeholder **antes** de `App`
porque `DB` lo necesita.

- **Algoritmo:** AES-GCM 256 bits.
- **Derivación:** PBKDF2.
- **Versionado:** `encryptDataWithVersion` / `decryptDataWithVersion` guardan `_v` para
  poder migrar el formato sin romper datos viejos.

**🔴 Cualquier cambio acá puede volver ilegibles los datos de usuarios reales.** No se
toca sin una migración probada y un test de ida y vuelta.

## `16-key-management.js` — Master key · 82 líneas
`_setupEncryptionWithPIN()`, `_ensureEncryptionUnlocked()`, `_checkAndRotateKeyIfNeeded()`,
`_initializeEncryption()`, `_initDOMContentLoaded()`.
La master key se protege con el PIN del usuario.

---

## `17-auto-update.js` — Actualización automática · 152 líneas

**Flujo.** Lee la versión del meta `app-version` → hace `fetch('/version')` al arrancar y
cada 5 minutos → si la remota es mayor, recarga.

**Métodos.** `_initAutoUpdate()`, `_checkForUpdates()`, `_isNewerVersion(a, b)`,
`_reloadWithNewVersion()`, `_hayTrabajoEnCurso()`.

**Estado: funcionando.** Estuvo ~3 semanas roto porque `/version` no estaba ruteado en
`worker.js` y devolvía 404 (el `catch` se lo comía con un `console.warn`). Ver
[BUG_HISTORY.md](BUG_HISTORY.md) §BUG-08.

**Salvaguarda que sí funciona.** `_hayTrabajoEnCurso()` impide recargar encima de un
formulario en curso o un modal abierto. Hay un test que lo protege.

---

## `18-clientes.js` — Clientes · 134 líneas

**🔵 Decisión de diseño.** Los clientes **no tienen object store**. Se derivan al vuelo de
`ventas` + `cuotas`, así nunca quedan desincronizados con las ventas.

**Métodos.** `_clienteKey()`, `_agregarClientes()`, `renderClientes()`, `filterClientes()`,
`abrirClienteDetalle()`, `renderClienteDetalle()`.

**Consecuencia probada.** Devolver la única venta de un cliente hace que el cliente
**desaparezca** de la lista. Es correcto: `_agregarClientes()` respeta `_ventasActivas()`.

**Riesgo.** 🟡 La clave es el nombre normalizado. "Ana" y "ana " son el mismo cliente;
"Ana Gómez" y "Ana" no.

---

## `19-i18n.js` — Internacionalización · 64 líneas

El **español es el idioma fuente**: las claves *son* los textos en español. `t()` traduce
si hay diccionario para el idioma activo; si no, devuelve el texto tal cual.

**Métodos.** `_initLang()`, `setLang()`, `t(texto)`.

Para sumar un idioma alcanza con completar `_i18n.pt` — sin tocar ningún call site,
porque `toast()` y `appConfirm()` ya pasan por `t()`.

---

## `20-recordatorios.js` — Recordatorios de cobro (F2) · 146 líneas

**Por qué existe.** El problema del revendedor no es anotar la cuota: es acordarse de
cobrarla.

**Métodos.** `_hoyTs()`, `_diasHasta()`, `_cobrosPendientes()`, `_textoVencimiento()`,
`_mensajeRecordatorio()`, `renderRecordatorios()`, `_actualizarBadgeCuotas()`,
`_avisoCobrosDelDia()`.

`_cobrosPendientes()` devuelve `{ vencidas, hoy, proximas }` y alimenta tanto el dashboard
como el badge de la bottom nav.

---

## `22-devoluciones.js` — Devoluciones y cambios (F3) · 147 líneas

**Por qué existe.** Antes, devolver un perfume obligaba a **borrar la venta**: desaparecía
del historial sin dejar rastro. Una devolución es un hecho del negocio, no un error de carga.

**Métodos.** `_ventasActivas()` ⭐, `abrirDevolucion()`, `_renderMotivosDevolucion()`,
`elegirMotivoDevolucion()`, `cerrarDevolucion()`,
`confirmarDevolucion()` → `_confirmarDevolucionImpl()`, `revertirDevolucion()`.

**🔴 `_ventasActivas()` es la función más importante de este módulo.** Devuelve las ventas
no devueltas. **Toda agregación de plata la usa.** Está definida acá pero se consume desde
`02-render.js`, `18-clientes.js` y el resto.

**Reglas de negocio.**
- Devolver **no borra**: marca `devuelta`, `motivoDevolucion`, `fechaDevolucion`.
- Repone stock (opcional, checkbox).
- Cancela las cuotas **impagas**; conserva las que tienen plata puesta.
- "Cambio por otro" abre Nueva Venta con el mismo cliente precargado.
- Deshacer vuelve a descontar stock **y recrea las cuotas canceladas**.

---

## `23-compras.js` — Compras al proveedor (F4) · 164 líneas

**Por qué existe.** Reponer stock con el botón "+" no dejaba rastro de cuánto costó la
tanda, y el precio de compra quedaba viejo. Sin eso la ganancia deja de ser real.

**Métodos.** `abrirCompra()`, `cerrarCompra()`, `_getCantidadCompra()`,
`cambiarCantidadCompra()`, `calcTotalCompra()`,
`registrarCompra()` → `_registrarCompraImpl()`, `renderCompras()`, `eliminarCompra()`.

**🟠 Efecto lateral esperado.** `DB.registrarCompra()` **actualiza `perfume.precioCompra`**
al precio de la última tanda (si `actualizarCosto` y `precio > 0`). Es intencional: el
costo de la última compra es el costo de referencia. Sorprende en los tests.

---

## `24-reservas.js` — Señas y encargos (F5) · 295 líneas

**Por qué existe.** El cliente deja un adelanto por un perfume que muchas veces todavía no
está en stock. Antes eso vivía en un chat de WhatsApp.

**Métodos.** `_reservasPorEstado()`, `_reservadasDe()`, `abrirReserva()`, `cerrarReserva()`,
`_renderSugerenciasReserva()`, `elegirPerfumeReserva()`, `calcRestaReserva()`,
`guardarReserva()` → `_guardarReservaImpl()`, `filterReservas()`, `renderReservas()`,
`updateReservasBadge()`, `_avisarEncargosPendientes()`, `entregarReserva()`,
`cancelarReserva()`, `eliminarReserva()`.

**Reglas.**
- 🔴 Una reserva **NO descuenta stock** hasta entregarse. Puede existir sin stock (lista de espera).
- 🔴 La seña nunca supera el total (`Math.min` en `DB.addReserva`).
- Entregar convierte la reserva en venta; la seña ya cobrada **no se suma de nuevo**
  (es parte del precio acordado) y queda anotada en la nota.
- Cancelar deja constancia de si la seña se devolvió o se retuvo.

**Estados.** `pendiente` → `entregada` | `cancelada`.

---

## `26-importar-excel.js` — Importador de planillas · 438 líneas

**Por qué existe.** El import de JSON restaura un backup propio: **reemplaza**. El que
viene de Excel quiere **sumar** lo que ya tenía. Son operaciones opuestas.

**Métodos.** `abrirImportarExcel()`, `_leerArchivoExcel()`, `_impCargarHoja()`,
`_impDetectarCabecera()`, `_impDetectarFormatoFecha()`, `_impAutoMapear()`,
`_impNormalizar()`, `_impValor()`, `_impProcesar()`, `_renderImportador()`,
`cambiarHojaImport()`, `cambiarDestinoImport()`, `setMapeoImport()`,
`confirmarImportExcel()` → `_confirmarImportExcelImpl()`, `cerrarImportador()`.

**Lo que resuelve del mundo real.**

| Problema | Solución |
|---|---|
| La fila 1 suele ser el nombre del negocio, no los títulos | `_impDetectarCabecera()` |
| Ambigüedad día/mes vs mes/día | `_impDetectarFormatoFecha()` mira **toda la columna** |
| Columna de cuotas tipo `1/3` | Numerador = cuotas **ya pagadas**, denominador = total |
| Nombres de columna arbitrarios | `_impAutoMapear()` + corrección manual del usuario |

**🔴 Detalle que parece un bug y no lo es.** Las ventas importadas van **sin `perfumeId`**,
a propósito: son históricas y el stock de la planilla ya las tiene descontadas. Ponerles
`perfumeId` haría que descuenten stock dos veces.

**Reimportación.** `_impYaImportados()` detecta las filas que ya están cargadas y ofrece
agregar solo las nuevas. Dos ventas son la misma si coinciden cliente, perfume, monto y
**día** — no timestamp, porque las planillas traen fechas sin hora.

**Riesgo.** 🟡 La lógica está bien cubierta por tests; los **clicks de la UI** del
importador no. Ver [TESTING.md](TESTING.md).

---

## `src/db.js` — Capa de datos · 703 líneas · ⚠️ no está en `src/app/`

**Objetivo.** Único punto de acceso a IndexedDB. Ningún módulo de UI toca la base directo.

| Grupo | Métodos |
|---|---|
| Infra | `init()`, `_shouldEncrypt()`, `_encryptBeforeStore()`, `_decryptAfterRetrieve()`, `dedupEncryptedRecords()`, `_conLockStock()` |
| CRUD | `getAll`, `get`, `add`, `put`, `delete`, `clear` |
| Perfumes | `getPerfumes`, `addPerfume`, `updatePerfume`, `deletePerfume` |
| Ventas | `getVentas`, `addVenta` ⭐, `updateVenta` ⭐, `deleteVenta` |
| Devoluciones | `devolverVenta`, `revertirDevolucion` |
| Compras | `registrarCompra`, `eliminarCompra`, `getCompras` |
| Reservas | `getReservas`, `addReserva`, `updateReserva`, `entregarReserva`, `cancelarReserva`, `eliminarReserva` |
| Cuotas | `getCuotas`, `pagarCuota`, `getCuotasSinPagar`, `getCuotasPorVencer` |
| Otros | pedidos, caja, gastos, config, `getVentasByPerfume`, `getVentasByCliente`, `getCajaByTipo` |
| Demo | `seedDemo()` |

**Reglas críticas.**
- 🔴 El stock **nunca** queda negativo: `Math.min(cantidad, p.stock)`.
- 🔴 Cada venta guarda `unidadesDescontadas` — sin eso, borrar una venta hecha con stock 0
  devolvía al inventario una unidad que nunca existió.
- 🔴 `updateVenta` reconcilia stock **solo** si cambió perfume o cantidad.
- 🔴 Máximo 12 cuotas (lanza error).
- 🔴 `pagarCuota` lanza `Sobrepago` si el total supera el monto.
- 🔴 El `id` va **fuera** del payload cifrado, si no `put()` duplica registros.
- 🟠 `seedDemo()` siembra **una sola vez en la vida** de la instalación (`pt_demo_seeded`).

**🔴 Las operaciones que tocan stock están serializadas.** `addVenta`, `updateVenta`,
`deleteVenta`, `devolverVenta`, `revertirDevolucion`, `registrarCompra` y `eliminarCompra`
son wrappers finos sobre un `_xImpl` y pasan por `_conLockStock()` (**Web Locks**, que
cruza pestañas).

Sin eso, dos pestañas leían el mismo stock y escribían el mismo valor: 20 ventas
descontaban 13 unidades. Ver [BUG_HISTORY.md](BUG_HISTORY.md) §BUG-21.

**⚠️ `entregarReserva` NO toma el lock**: llama a `addVenta`, que ya lo toma, y Web Locks
no es reentrante — se trabaría para siempre.

**⚠️ Al buscar código en `db.js`, apuntá al `_xImpl`**, no al wrapper. Varias regresiones
estáticas se rompieron por eso.
