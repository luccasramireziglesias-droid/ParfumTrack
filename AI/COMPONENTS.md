# COMPONENTS — Piezas de UI de ParfumTrack

> **Antes de leer:** ParfumTrack **no tiene componentes** en el sentido de React/Vue.
> No hay props, ni estado local, ni ciclo de vida, ni árbol de componentes. Es HTML
> estático en `src/screens/` + funciones que generan strings de HTML en `02-render.js`.
>
> Este archivo documenta lo que **sí** existe y cumple el mismo rol: pantallas, modales,
> funciones generadoras de HTML y bloques reutilizables. Donde un framework diría "props",
> acá se dice "parámetros de la función que genera el HTML".

---

## 1. Los tres tipos de pieza

| Tipo | Dónde vive | Cómo se actualiza |
|---|---|---|
| **Pantalla** | `src/screens/*.html` | Estructura fija. Su contenido dinámico se inyecta por `innerHTML` |
| **Modal** | `src/index.template.html` | Se muestra/oculta con clases; el contenido se rellena al abrir |
| **Bloque generado** | función en `02-render.js` u otro módulo | Se regenera entero en cada render |

---

## 2. Pantallas

Cada archivo de `src/screens/` es un `<div id="screen-{nombre}" class="screen">`.
`build.js` lo inyecta en el marcador `<!--PT:SCREEN:{nombre}-->` del template.

**Contrato de una pantalla:**
1. `id="screen-{nombre}"` — tiene que coincidir con el argumento de `showScreen()`.
2. `class="screen"` (más `active` si es la inicial).
3. Un `<div class="screen-scroll">` adentro para el scroll.
4. Contenedores vacíos con `id` estable para que el render los rellene.

| Pantalla | Contenedores que rellena el render | Render |
|---|---|---|
| `inicio` | `#hero-ganancia`, `#recordatorios`, `#ventas-recientes`, `#dashboard-deudores` | `renderDashboard()` |
| `nueva-venta` | `#venta-cliente`, `#venta-cantidad`, `#live-profit`, autocompletado | `resetVentaForm()` |
| `stock` | `#stock-list`, `#stock-alerts` | `renderStock()` |
| `cuotas` | `#cuotas-list`, `#cuotas-total` | `renderCuotas()` |
| `ventas-all` | `#ventas-all-list`, `#ventas-search` | `renderAllVentas()` |
| `stats` | canvas de Chart.js, `#rankings` | `renderStats()` |
| `clientes` | `#clientes-list` | `renderClientes()` |
| `cliente-detalle` | ficha + historial | `renderClienteDetalle()` |
| `pedidos` · `nuevo-pedido` · `pedido-detalle` | listas de pedidos | `renderPedidos()`, … |
| `caja` | `#caja-list` | `renderCaja()` |
| `gastos` | `#gastos-list`, chips de montos | `renderGastos()` |
| `reservas` | `#reservas-list` | `renderReservas()` |
| `catalogo` | lista seleccionable | `_renderCatalogoList()` |
| `cuenta` | perfil del negocio + estado de licencia y plan | `updateCuentaScreen()` → `renderNegocio()` |
| `mas` | estático (menú) | — |

**🔴 Al agregar una pantalla hay que tocar 3 lugares:**
1. `src/screens/nueva.html`
2. El marcador `<!--PT:SCREEN:nueva-->` en `src/index.template.html`
   *(si falta, `build.js` **falla** — es intencional)*
3. El `if` correspondiente en `showScreen()` de `01-navigation.js`

---

## 3. Modales

Todos viven en `src/index.template.html` y se muestran/ocultan con clases
(`.hidden`, `display:flex`). No se crean dinámicamente.

| Modal | Abre | Cierra | Módulo |
|---|---|---|---|
| `#modal-overlay` | — | — | Fondo compartido |
| `#modal-confirm` | `appConfirm()` | — | `11-utils.js` |
| `#modal-prompt` | `appPrompt()` | — | `11-utils.js` |
| `#modal-perfume-list` + `#modal-perfume-search` | `openPerfumeSelector()` | `closeModal()` | `03-nueva-venta.js` |
| `#modal-add-perfume` | `openAddPerfume()` / `openEditPerfume()` | `closeAddPerfume()` | `04-stock.js` |
| `#modal-pago-cuota` | `abrirPagoCuota(id)` | `cerrarPagoCuota()` | `05-cuotas.js` |
| `#modal-pedido-perfume` | `openPedidoPerfumeSelector()` | `closePedidoPerfumeSelector()` | `07-pedidos.js` |
| `#modal-devolucion` | `abrirDevolucion(id)` | `cerrarDevolucion()` | `22-devoluciones.js` |
| `#modal-compra` | `abrirCompra()` | `cerrarCompra()` | `23-compras.js` |
| `#modal-reserva` | `abrirReserva()` | `cerrarReserva()` | `24-reservas.js` |
| `#modal-importar` | `abrirImportarExcel()` | `cerrarImportador()` | `26-importar-excel.js` |
| `#modal-demo` + `#modal-demo-content` | `showDemoModal()` | `closeDemoModal()` | `01-navigation.js` |

**Patrón de un modal:**
```
abrirX(id)  → guarda el id en un campo `_xId` del App
            → rellena los campos del modal
            → saca `.hidden`
confirmarX()→ _once('clave', …) → _confirmarXImpl()
            → DB.*  → App.loadData()  → render  → cerrarX()
```

**🟠 Caso especial: `#modal-demo`.** `expandDemoVideo()` alterna fullscreen manipulando
~15 estilos inline y `closeDemoModal()` duplica la lógica de restaurarlos. Es la pieza
de UI más frágil del proyecto. Cubierto por `tests/fullscreen-headless.test.js`.

---

## 4. Bloques generados — el "component API" real

### `_renderVentaCard(v, opts)` — `02-render.js:203` ⭐

La pieza más reutilizada. **Compartida** entre el dashboard y la lista de ventas (DRY).

**Parámetros** (el equivalente a props):

| Parámetro | Tipo | Default | Qué hace |
|---|---|---|---|
| `v` | objeto venta | — | El dato |
| `opts.compact` | boolean | `false` | Versión reducida para el dashboard |
| `opts.className` | string | `''` | Clases extra |
| `opts.style` | string | `''` | Estilo inline extra |
| `opts.index` | number | `undefined` | 🔴 Número de venta. **Obligatorio para evitar `indexOf` O(n²)** |

**Qué renderiza:** perfume, cliente, fecha, monto, ganancia, badge `×N` si `cantidad > 1`,
clase `.devuelta` + tag `Devuelta · {motivo}` si corresponde, y los botones de acción
(vender de nuevo, editar, devolver / deshacer devolución).

**Dependencias:** `esc()`, `fmt()`, `fmtDate()`.

### `_renderStockAlerts()` — `02-render.js:439`

Resumen colapsable de perfumes agotados: 3 visibles + "Ver todos" (`toggleAlertasStock()`).
Antes listaba todo y con 14 agotados tapaba el inventario entero.
**Cuenta unidades, no ventas.**

### `renderCuotas(reset = true)` — `02-render.js:527`

Tarjetas `.cuota-card` agrupadas por venta, ordenadas por vencimiento más próximo.

- **Pagina de a 30** (`_CUOTAS_PAGINA`), botón `.btn-ver-mas` con el resto.
- `reset = true` (default) reinicia el paginado; `verMasCuotas()` llama con `false`.
- 🔴 `#cuotas-total` suma **todas** las cuotas, no solo las visibles.
- 🔴 El vencimiento más próximo se **precalcula**; el comparador del `sort` no puede
  hacer trabajo adentro.

### `renderAllVentas(reset = true)` — `02-render.js:320`

Mismo patrón, pagina de a 50 (`_VENTAS_PAGINA` / `verMasVentas()`), con búsqueda por
`#ventas-search`.

### `_renderDashboardDeudores()` · `renderDeudores()` · `renderRankings(ventas)`

Agregaciones por cliente y por perfume. **Todas parten de `_ventasActivas()`.**

### `_renderMotivosDevolucion()` · `_renderSugerenciasReserva()` · `_renderGastoChips()`

Chips seleccionables. Los de gastos salen del **historial del propio usuario**, no de una
lista fija.

### `_renderCatalogoList()` · `_renderCatalogoPage()` — `10-data-management.js`

Catálogo para compartir por WhatsApp, con selección múltiple y paginado.

### `_renderImportador()` — `26-importar-excel.js`

La UI más compleja: preview de la planilla, selector de hoja, mapeo de columnas editable
y detección de formato de fecha.

---

## 5. Bloques estáticos compartidos

| Pieza | Clase / id | Notas |
|---|---|---|
| Bottom nav | `.bottom-nav` / `.nav-item[data-tab]` | 5 tabs. `showScreen()` actualiza `.active` y el `FILL` del icono |
| Header | `.header-bar`, `.logo-group` | Por pantalla |
| Toast | `toast()` en `11-utils.js` | Efímero, pasa por `t()` |
| Splash | `#splash` | 🔴 Está en el HTML **estático** para pintarse antes que el JS. Se saca del DOM en el `finally` de `init()` |
| Stepper de cantidad | `.cantidad-stepper`, `.cant-btn`, `.cant-input` | F1 |
| Botón "Ver más" | `.btn-ver-mas` | Paginado de ventas y cuotas |
| Botón WhatsApp | `.btn-whatsapp[data-msg]` | 🔴 Handler **delegado**, no `onclick` |
| Botón de pago | `.btn-pay[data-cuota-id]` | 🔴 Handler **delegado** |
| Empty states | `19-empty-state.css` | Por lista |

---

## 6. Estilos

26 hojas en `src/styles/`, numeradas por área y concatenadas en orden alfabético.
El número **es** el orden de cascada: `26-importar.css` puede pisar a `00-base.css`.

```
00-base · 01-app-layout · 02-header · 03-hero-card · 04-stat-cards · 05-today-strip
06-section · 07-venta-card · 08-sub-header · 09-live-profit · 10-form · 11-buttons
12-stock · 13-cuotas · 14-stats · 15-mas · 16-bottom-nav · 17-modal · 18-toast
19-empty-state · 20-pedidos · 21-recordatorios · 22-devoluciones · 23-compras
24-reservas · 25-splash · 26-importar · 27-negocio
```

**Paleta (variables CSS en `00-base.css`) — obligatoria:**
```
--bg #0f0f1a   --bg2 #1a1a2e   --card #1e1e35
--gold #c9a84c --gold2 #e8c97e --gold3 #f5dfa0
--text #f0ece4 --text2 #b8b4a8 --text3 #7a7870
--green #70c9a0 --red #e07070
```
Gradiente gold: `linear-gradient(135deg, #c9a84c, #e8c97e)`.
**Nunca fondos blancos.**

---

## 7. Reglas al crear o tocar UI

1. 🔴 **Todo dato del usuario pasa por `this.esc()`** antes de entrar a un template string.
2. 🔴 **Nunca metas datos del usuario en un `onclick=""`.** Usá `data-*` + delegación.
3. 🔴 **Los métodos llamados desde HTML no se renombran** sin buscar el string en
   `src/screens/` y `src/index.template.html`. El HTML es texto: no hay error de compilación.
4. 🟠 **Toda lista que puede crecer sin techo tiene que paginar.**
5. 🟠 **Los totales se calculan sobre el conjunto completo**, nunca sobre lo visible.
6. 🟠 **Todo guardado async se envuelve en `_once()`** (anti doble-tap).
7. 🟡 Usá las variables CSS, no colores literales.
8. 🟡 Los textos de usuario pasan por `t()` cuando el helper ya lo hace (`toast`, `appConfirm`).
