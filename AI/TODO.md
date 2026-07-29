# TODO — Lista viva

Ordenada por **impacto real**, no por facilidad. Cada entrada tiene evidencia: dónde está
el problema y cómo se comprueba.

**Última revisión:** 2026-07-29 (tarde) · App v1.8.0

**Leyenda:** 🔴 crítico · 🟠 alto · 🟡 medio · 🟢 bajo

**Decisiones cerradas** (no volver a proponerlas): el header muestra "Parfum Track" sin
nombre cargado y el PIN se queda en "Más" — ver [DECISIONS.md](DECISIONS.md) §D-26 y §D-27.
Sigue abierto si el documento fiscal debería ir a un store cifrado (§D-24).

---

## BUGS ABIERTOS

### 🟠 T-12 — Auditar los `catch` silenciosos del backend

**Por qué.** El incidente del 29/07 (BUG-24) salió de un `catch` que tapó durante semanas
un `put()` que fallaba en **todas** las requests. Nadie mira los `console.warn` del Worker,
así que un error tragado ahí es invisible hasta que algo lo destapa.

**Qué hacer.** Recorrer los `catch` de `worker.js` y `functions/*.js` y para cada uno
responder: ¿qué error puede estar tapando? ¿cómo nos enteraríamos si empieza a fallar
siempre? Los candidatos obvios son los que envuelven llamadas a KV.

**Extra.** Los `expirationTtl` menores a 60 ya están cubiertos por un test, pero conviene
revisar si hay otros límites de plataforma asumidos sin verificar (tamaño de valor en KV
—25 MB—, largo de clave —512 B—, TTL mínimo).

**Dificultad.** Media. No urgente, pero es la clase de deuda que produce incidentes.

---

### 🟠 T-13 — Tests de contrato cliente ↔ backend

**Por qué.** BUG-25: `trial.test.js` tiene 24 tests del backend, todos mandando el
`challenge` correctamente. El cliente no lo mandaba. Cada lado estaba bien probado; el
contrato entre los dos, no.

**Qué hacer.** Para cada endpoint que la app llama, un test que verifique que el cliente
manda **todos** los campos que el backend exige. Hoy están cubiertos `/trial` (7
regresiones) y CSRF. Faltan `/validate-license`, `/backup`, `/sync` y
`/mp-create-preference`.

**Dificultad.** Baja por endpoint; el patrón ya está escrito en `features.test.js`.

---


### 🟡 T-08 — `/force-update` borra IndexedDB sin advertencia

**Evidencia.** `worker.js` devuelve `Clear-Site-Data: "cache", "storage"`.
**`storage` incluye IndexedDB** — o sea, todo el historial del usuario.

**Impacto.** Es una escotilla de emergencia para cache envenenado, pero **destruye los
datos**. La página que devuelve no lo advierte.

**Solución.** O sacar `"storage"` y dejar solo `"cache"`, o poner una advertencia explícita
con paso de backup previo. Dificultad: baja. **Decisión de producto, no técnica.**

---

### 🟡 T-11 — Reservas y pedidos no avisan de duplicados

Los perfumes (`_mismoNombre`) y el importador de Excel (`_impYaImportados`) ya avisan.
Cargar dos veces la misma reserva o el mismo pedido sigue pasando en silencio.
Dificultad: baja — el helper de normalización ya existe.

---

### 🟡 T-07 — Duplicación en el fullscreen del modal de demo

**Evidencia.** `01-navigation.js`: `expandDemoVideo()` y `closeDemoModal()` manipulan ~15
estilos inline cada una y duplican la lógica de "volver a tamaño normal".

**Solución.** Mover a una clase CSS `.expanded` y dejar solo el toggle en JS.
Dificultad: baja. Cubierto por `tests/fullscreen-headless.test.js`.

---

### 🟢 T-10 — `'unsafe-inline'` en la CSP

Inherente a la arquitectura de un solo archivo (D-01). Mitigado con `esc()` + delegación
de eventos. **No se arregla sin revertir D-01.** Se documenta para que no se reporte como
hallazgo nuevo en cada auditoría.

---

## COBERTURA DE TESTS PENDIENTE

| # | Qué falta | Prioridad |
|---|---|---|
| C-03 | Clicks de la UI del importador de Excel (la lógica sí está cubierta) | 🟡 |
| C-04 | Flujo completo de Mercado Pago punta a punta (los handlers sí, el flujo no) | 🟡 |
| C-05 | Comportamiento con storage lleno (`QuotaExceededError`) | 🟡 |
| C-06 | Fotos muy grandes en el backup JSON | 🟢 |

✅ **C-01 y C-02 cerrados** — `tests/concurrencia.spec.js` (7 tests). Encontraron un bug
real de stock, ver [BUG_HISTORY.md](BUG_HISTORY.md) §BUG-21.

---

## MEJORAS

### 🟠 M-01 — Diferir stores no usados en el arranque
`loadData()` carga los 8 stores siempre. `caja`, `gastos`, `compras` y `pedidos` no se usan
en el dashboard. Diferirlos bajaría el arranque.
**Medir primero** con `tests/volumen.spec.js`. Ver [PERFORMANCE.md](PERFORMANCE.md) §3.

### 🟡 M-02 — Partir `02-render.js`
831 líneas y es el archivo que más se toca — casi todo el riesgo de regresión está ahí.
Partirlo en `02a-dashboard` / `02b-listas` / `02c-stats`. El build no cambia: solo hay que
respetar el orden alfabético.

### 🟡 M-04 — Cifrado también en el plan Free
Hoy el cifrado depende de tener licencia (D-04). Los usuarios Free tienen los datos en
claro en IndexedDB. **Decisión de producto**, no técnica.

### 🟢 M-05 — Índices utilizables con cifrado
Con datos cifrados los índices sobre campos cifrados no sirven. Se podría guardar un
campo hash sin cifrar para los índices más usados (`fecha`, `cliente`).
Complejidad alta, beneficio incierto a los volúmenes actuales.

---

### 🟡 P-01 — Regrabar el video demo

**Estado.** `demo.mp4` (18,6 MB, del 07/07) se usa en **dos lugares**:
`src/index.template.html:524` (modal de demo dentro de la app) y
`src/landing/sections/03-demo.html:12` (landing). Los dos apuntan a `/demo.mp4`, así que
reemplazar el archivo actualiza ambos de una.

**🔴 Hacerlo DESPUÉS de terminar de pulir la app, no antes.** Un video grabado hoy queda
viejo con el próximo cambio de UI y hay que rehacerlo. Es de los pocos ítems donde
adelantarse cuesta trabajo doble.

**Qué revisar cuando se haga:**
- El video actual pesa **18,6 MB** — en un celular con datos móviles caros en LATAM eso es
  mucho. Apuntar a menos de 5 MB, o poner `preload="none"` con un póster.
- Que muestre el flujo que promete el headline: cargar una venta **en 10 segundos** y ver
  la ganancia real. Es lo que vende el producto.
- Que se vean las features nuevas (cantidad por venta, devoluciones, reservas,
  recordatorios de cobro) — el video actual es anterior a F1-F5.
- Material real, nunca mockups (regla del proyecto).

**Depende de:** que la app esté en su forma final. Ver la lista de mejoras de arriba.

---

## PRODUCTO (ver [ROADMAP.md](ROADMAP.md))

| Plazo | Ítem |
|---|---|
| 7 días | 12 ads Meta/IG (plan detallado en `plans/`) |
| 7 días | Testimonios reales con foto y nombre |
| 30 días | Video demo de 15-30 segundos |
| 30 días | Schema de reviews para los testimonios |
| 30 días | A/B test de headlines |
| 90 días | Landing localizada por país (AR/UY/CO/MX) |
| 90 días | Blog SEO long-tail |
| 90 días | Plan Pro: multi-perfil, backup automático, sync |

---

## RESUELTO RECIENTEMENTE

| Ítem | Cuándo |
|---|---|
| ✅ T-01 `/version` ruteado — la actualización automática ya dispara | 07/2026 |
| ✅ T-02 comentario obsoleto de `db.js` | 07/2026 |
| ✅ T-03 fail-closed en rutas críticas | 07/2026 |
| ✅ T-04 CSRF bloqueando de verdad | 07/2026 |
| ✅ T-05 `fmt()` acotado a 2 decimales | 07/2026 |
| ✅ T-06 aviso de perfume duplicado | 07/2026 |
| ✅ T-09 race de stock entre pestañas (Web Locks) | 07/2026 |
| ✅ M-03 aviso de planilla reimportada | 07/2026 |
| ✅ C-01 y C-02 tests de concurrencia e interrupción | 07/2026 |
| ✅ Paginado de la pantalla de cuotas (297 ms → 16 ms) | 07/2026 |
| ✅ Prueba de volumen con 2000 ventas, con y sin cifrado | 07/2026 |
| ✅ Fuzzer de invariantes en CI | 07/2026 |
| ✅ Sondas de riesgo de datos | 07/2026 |
| ✅ Deshacer una devolución recupera la deuda (BUG-17) | 07/2026 |
| ✅ Alertas de stock colapsables | 07/2026 |
| ✅ Importador de Excel | 07/2026 |
| ✅ Pantalla de carga (splash) | 07/2026 |
| ✅ Recarga espuria del SW en la primera visita | 07/2026 |
| ✅ Versión sincronizada desde `package.json` | 07/2026 |
| ✅ E2E frenando el deploy en CI | 07/2026 |
| ✅ Imagen Open Graph regenerada | 07/2026 |
| ✅ SRI sha384 en jsPDF y XLSX | 07/2026 |
| ✅ F1-F5 completas | 07/2026 |
