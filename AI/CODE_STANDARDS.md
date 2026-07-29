# CODE_STANDARDS — Estándares de código

**Regla que gobierna a todas las demás:** escribí código que se lea como el que ya está.
Misma densidad de comentarios, mismos nombres, mismos modismos.

---

## 1. Idioma

- **Nombres de funciones y variables: español**, con las excepciones ya establecidas
  (`render*`, `fmt`, `esc`, `init`, `debounce`).
- **Comentarios: español rioplatense.**
- **Textos de la UI: español rioplatense (voseo).** "Cargá", "Guardá", "Vos".
- **Género neutro:** "revendedores", "clientes". Nunca "revendedoras"/"clientas".

**Los comentarios explican el POR QUÉ, no el QUÉ.**

```js
// ✅ bien: explica una decisión que no se deduce del código
// Nunca dejar el stock en negativo: se descuenta lo que realmente hay
unidadesDescontadas = Math.min(cantidad, p.stock);

// ❌ mal: repite lo que ya dice el código
// Asigna el mínimo entre cantidad y stock
unidadesDescontadas = Math.min(cantidad, p.stock);
```

Los comentarios más valiosos del proyecto describen el bug que la línea previene:

```js
// CRÍTICO: conservar la clave (id) fuera del payload — sin esto, put()
// no encuentra el registro existente y lo INSERTA duplicado
```

---

## 2. Restricciones de la arquitectura (no negociables)

Vienen de D-01 y D-02. Romperlas rompe el build o la app.

1. 🔴 **Nunca `import` / `export`** en `src/app/` ni `src/db.js`. Todo se concatena en un
   `<script>` clásico.
2. 🔴 **Nunca edites `index.html` a mano.** Editá `src/` y corré `node scripts/build.js`.
3. 🔴 **Nunca dupliques un nombre de método** entre archivos de `src/app/`. El último gana,
   en silencio.
4. 🔴 **Nunca renombres un método público** sin buscar el string en `src/screens/` y
   `src/index.template.html`. El HTML es texto: no hay error de compilación.
5. 🔴 **La versión solo se toca en `package.json`.**

---

## 3. Convenciones de nombres

| Convención | Significado | Ejemplo |
|---|---|---|
| `metodo()` | Público — puede llamarse desde HTML | `guardarVenta()` |
| `_metodo()` | Interno | `_guardarVentaImpl()` |
| `_CONSTANTE` | Constante de configuración | `_CUOTAS_PAGINA` |
| `_estado` | Estado interno de un módulo | `_editingVentaId` |
| `render*()` | Genera y pinta HTML | `renderDashboard()` |
| `_render*()` | Genera HTML y lo devuelve | `_renderVentaCard()` |
| `abrir*()` / `cerrar*()` | Modales | `abrirDevolucion()` |
| `guardar*()` / `_guardar*Impl()` | Par público/implementación | `guardarGasto()` |

**Archivos.** `NN-nombre-en-kebab.js`. El número **define el orden de concatenación**.
Dejá huecos entre números para poder insertar sin renumerar (ya hay huecos en 21 y 25).

---

## 4. Patrones obligatorios

### a) Guarda anti doble-tap

🔴 **Todo guardado async se envuelve en `_once()`.**

```js
guardarVenta() {
  return this._once('venta', () => this._guardarVentaImpl(), event?.target);
},
async _guardarVentaImpl() { /* lógica real */ },
```

Sin esto, un doble toque registra la venta dos veces.

### b) Escapado de HTML

🔴 **Todo dato del usuario pasa por `esc()`.**

```js
// ✅
container.innerHTML = ventas.map(v => `<div>${this.esc(v.cliente)}</div>`).join('');
// ❌ XSS
container.innerHTML = ventas.map(v => `<div>${v.cliente}</div>`).join('');
```

### c) Nunca datos de usuario en `onclick`

🔴 Usá `data-*` + delegación en `_initEventDelegation()`.

```js
// ✅
`<button class="btn-pay" data-cuota-id="${encodeURIComponent(JSON.stringify(c.id))}">`
// ❌ un nombre con comillas rompe el HTML y puede ejecutar JS
`<button onclick="App.pagar('${c.cliente}')">`
```

### d) Ciclo de mutación

🔴 Siempre en este orden:

```js
await DB.operacion(...);   // 1. persistir
await App.loadData();      // 2. recargar el estado
this.renderAlgo();         // 3. renderizar
this._notifyTabs();        // 4. avisar a las otras pestañas
```

Nunca mutes `App.ventas` a mano y renderices: el estado y la base quedan desalineados.

### e) Agregaciones de plata

🔴 **Siempre `_ventasActivas()`**, nunca `this.ventas`.

```js
// ✅
const total = this._ventasActivas().reduce((s, v) => s + v.precioVenta, 0);
// ❌ cuenta ventas devueltas — hay un test que falla si esto aparece
const total = this.ventas.filter(v => …)
```

### f) Listas grandes

🔴 Paginá. 🔴 Los totales se calculan sobre el conjunto completo, no sobre lo visible.

### g) Tolerancia a datos viejos

🔴 IndexedDB no impone esquema. **Asumí siempre que un campo puede faltar.**

```js
const cantidad = Math.max(1, parseInt(v.cantidad, 10) || 1);   // ventas viejas valen 1
const pagado   = c.montoPagado || 0;
const stock    = p.stock || 0;
```

---

## 5. Manejo de errores

**Errores de negocio: lanzá con un código en MAYÚSCULAS.** El fuzzer los reconoce como
rechazos legítimos y no los reporta como fallas.

```js
if (!p) throw new Error('PERFUME_NO_ENCONTRADO');
if (v.devuelta) throw new Error('YA_DEVUELTA');
if (r.estado !== 'pendiente') throw new Error('RESERVA_NO_PENDIENTE');
```

Códigos ya en uso: `VENTA_NO_ENCONTRADA`, `YA_DEVUELTA`, `PERFUME_NO_ENCONTRADO`,
`CANTIDAD_INVALIDA`, `PRECIO_INVALIDO`, `RESERVA_NO_ENCONTRADA`, `RESERVA_NO_PENDIENTE`,
`RESERVA_YA_ENTREGADA`, `Sobrepago`.

**Nunca te tragues un error en silencio.** Si tiene que ser opcional, logueá:

```js
try { ... } catch (_) { /* no soportado: seguimos igual */ }
```

**En el arranque, un fallo tiene que ser visible.** `init()` muestra
`_mostrarErrorArranque()`, no una pantalla en blanco.

---

## 6. DRY — con criterio

**Extraé cuando la lógica es la misma y tiene que seguir siéndolo:**
- `_renderVentaCard()` — dashboard y lista de ventas
- `_processPhoto()` — foto de stock y alta de perfume
- `_ventasActivas()` — todas las agregaciones

**No extraigas cuando la similitud es casual.** Dos funciones que hoy se parecen pero
responden a reglas de negocio distintas se van a separar mañana, y el helper compartido
se vuelve un `if` gigante.

---

## 7. KISS — lo que este proyecto eligió NO hacer

| Se evitó | Por qué |
|---|---|
| Actualización incremental del estado | `loadData()` completo es más lento pero **auditable**. Un estado parcial muestra números de plata mal |
| Gestión de estado reactiva | 8 arrays + render explícito alcanza |
| Sistema de migraciones versionado | Migraciones idempotentes en cada init |
| Abstracción sobre IndexedDB | `db.js` es directo y se lee entero en 20 minutos |
| Router de URL | No hay caso de uso (D-06) |

**El sesgo del proyecto es hacia lo obvio.** Cuando dudes entre "elegante" y "evidente",
elegí evidente: el próximo que lea el código puede ser una IA sin contexto.

---

## 8. SOLID — cómo aplica acá

No hay clases, así que SOLID aplica parcialmente:

- **Responsabilidad única:** ✅ un módulo por área. `02-render.js` es la excepción que
  incomoda (831 líneas) y está en [TODO.md](TODO.md) §M-02.
- **Abierto/cerrado:** ✅ agregar un módulo no requiere tocar los existentes.
- **Sustitución de Liskov:** n/a.
- **Segregación de interfaces:** ⚠️ `App` es un objeto gigante — es el costo consciente de D-01.
- **Inversión de dependencias:** ✅ los módulos de UI dependen de `DB.*` como contrato,
  no de IndexedDB.

---

## 9. Estilo

- **Indentación:** 2 espacios.
- **Punto y coma:** sí.
- **Comillas:** simples en JS, template literals para HTML.
- **`const` por defecto**, `let` solo si se reasigna, **nunca `var`**.
- **`async/await`**, no cadenas de `.then()`.
- **Optional chaining** (`?.`) donde ayude a la legibilidad.
- **Líneas:** ~100 caracteres como referencia, sin obsesión.
- **Sin linter configurado** — la consistencia es por convención y por revisión.

---

## 10. CSS

- Un archivo por área, numerado. **El número es el orden de cascada.**
- Usá las variables de `00-base.css`, nunca colores literales.
- 🔴 **Paleta dark obligatoria. Nunca fondos blancos.**
- Fuentes: Cormorant Garamond (títulos) · DM Sans (body).
- Mobile-first: el viewport de referencia es 390×844.
- Evitá estilos inline desde JS; preferí toggles de clase.
  *(El modal de demo es la deuda conocida — ver [TODO.md](TODO.md) §T-07.)*

---

## 11. Checklist antes de commitear

```
[ ] Edité en src/, NO en index.html
[ ] Corrí node scripts/build.js
[ ] npm test pasa (560)
[ ] npx playwright test pasa (72), si toqué comportamiento
[ ] Los datos del usuario pasan por esc()
[ ] Los guardados async están envueltos en _once()
[ ] Las agregaciones usan _ventasActivas()
[ ] Si agregué un store: las 5 listas + _encryptedStores + loadData()
[ ] Si agregué una pantalla: screens/ + marcador + if en showScreen()
[ ] Si agregué un endpoint: import + POST/GET_ROUTES + if + rate limit
[ ] Actualicé la documentación de AI/ (ver AI_RULES.md)
[ ] El mensaje de commit explica el POR QUÉ
```

---

## 12. Mensajes de commit

En español, imperativo, explicando el problema que resuelven:

```
Paginar la pantalla de cuotas y medir la app con historial de 3 años

De todas las pantallas, cuotas era la única fuera de rango (297 ms):
renderCuotas() recalculaba el vencimiento más próximo dentro del
comparador del sort y volcaba las cientos de tarjetas de una sola vez.
```

**Un buen mensaje explica qué estaba mal, no qué líneas cambiaron** — el diff ya dice eso.
