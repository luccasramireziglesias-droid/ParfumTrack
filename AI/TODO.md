# TODO — Lista viva

Ordenada por **impacto real**, no por facilidad. Cada entrada tiene evidencia: dónde está
el problema y cómo se comprueba.

**Última revisión:** 2026-07-29 (tarde) · App v1.8.0

**Leyenda:** 🔴 crítico · 🟠 alto · 🟡 medio · 🟢 bajo

---

## BUGS ABIERTOS

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
