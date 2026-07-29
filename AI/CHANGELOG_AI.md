# CHANGELOG_AI — Registro de cambios

Registro orientado a IAs: cada entrada dice **qué cambió, por qué, qué archivos y qué
riesgo introduce**. No es un changelog de usuario final.

**Formato:** fecha · versión · motivo · archivos · impacto · riesgo.

**Regla:** se actualiza **en el mismo commit** que el cambio. Ver [AI_RULES.md](AI_RULES.md).

---

## 2026-07-29 — Base de conocimiento `/AI`

**Motivo.** Cada sesión nueva de IA tenía que releer ~11.000 líneas de código para
entender el proyecto. Costoso en tokens y propenso a conclusiones equivocadas.

**Archivos.** `AI/` (20 archivos nuevos). **No se tocó código de la app.**

**Impacto.** El flujo de arranque de cualquier IA pasa a ser:
`AI_CONTEXT.md` → `PROJECT_MAP.md` → `MODULES.md` (solo el módulo afectado) → código.

**Hallazgos documentados durante la escritura** (encontrados leyendo el código, no
introducidos por este cambio):
- 🔴 `/version` no está ruteado en `worker.js` → la actualización automática nunca dispara.
  *No confirmado contra producción — el entorno no tenía red saliente.*
- 🟠 Comentario obsoleto en `db.js:331` que contradice al código.
- 🟠 Los rate limits del router hacen fail-open; los de `_shared.js` sí son fail-closed.
- 🟠 CSRF implementado pero no obligatorio.

**Riesgo.** Ninguno funcional. El riesgo real es que la documentación **envejezca**: una
base de conocimiento desactualizada es peor que no tenerla, porque la IA trabaja con
confianza sobre datos falsos. Por eso [AI_RULES.md](AI_RULES.md) exige actualizarla en el
mismo commit.

---

## 2026-07-29 — v1.8.0 — Paginado de cuotas y prueba de volumen

**Motivo.** Nadie había medido cómo se comporta la app con el historial de alguien que la
usó dos o tres años. Es el escenario que le llega a **todos** los usuarios, solo que más
adelante.

**Qué se hizo.** `tests/volumen.spec.js` siembra 2000 ventas, 1500 cuotas y 120 perfumes
repartidos en tres años y mide arranque y cada pantalla, con y sin cifrado.

**Lo que encontró.** De todas las pantallas, **cuotas** era la única fuera de rango
(297 ms), por dos motivos que se sumaban:
1. `renderCuotas()` recalculaba el vencimiento más próximo **dentro del comparador del
   `sort`** — miles de `filter` + `sort` repetidos.
2. Volcaba las cientos de tarjetas de una sola vez (22.040 nodos en el DOM).

**Solución.** Precálculo de la próxima cuota por grupo + paginado de a 30
(`_CUOTAS_PAGINA`, `verMasCuotas()`, reset al reentrar).

**Archivos.** `src/app/02-render.js`, `tests/volumen.spec.js`, `tests/features.test.js`,
`tests/hardening.test.js`, `index.html` (generado), `CLAUDE.md`

**Impacto.** cuotas 297 ms → **16 ms** · DOM 22.040 → **6.532 nodos** · arranque cifrado
970 ms con datos íntegros.

**Riesgo.** 🟠 El paginado es fácil de romper de una forma peligrosa: calcular el total
sobre lo visible en vez de sobre todas las cuotas. Protegido por tests.
Se agregaron **7 regresiones**. Suites: 560 Vitest + 72 E2E, todo en verde.

---

## 2026-07 — Sondas de riesgo de datos

**Motivo.** Había zonas que ningún test tocaba y donde un fallo es silencioso.

**Qué cubre.** Backup de ida y vuelta campo por campo · nombres con HTML y emojis ·
montos del borde · la app con cifrado activo (verificando que esté cifrado **en disco**) ·
migración de una base v3 real.

**Archivos.** `tests/riesgos.spec.js`, `tests/features.test.js`

**Riesgo.** Ninguno — solo tests.

---

## 2026-07 — Fuzzer de invariantes 🐛⭐

**Motivo.** Buscar sistemáticamente la clase de bug más cara: un número de plata mal, sin
error visible.

**Qué hace.** Secuencias aleatorias con semilla fija; verifica invariantes de negocio
después de cada operación e imprime la secuencia exacta que llevó a la falla.

**Lo que encontró.** **BUG-17:** deshacer una devolución no recreaba las cuotas canceladas.
La venta volvía a contar para la ganancia pero **la deuda del cliente desaparecía** — una
venta de $3000 en 3 cuotas con una paga quedaba con $0 por cobrar en vez de $2000.

**Archivos.** `tests/fuzz.spec.js`, `src/db.js` (`revertirDevolucion`), `tests/f3.spec.js`

**Riesgo.** 🟢 Suma tiempo a CI. Configurable con `FUZZ_CORRIDAS` / `FUZZ_OPS`.

**Deuda que dejó.** El comentario de `db.js:331` sigue diciendo que las cuotas no se
recrean. Ver [TODO.md](TODO.md) §T-02.

---

## 2026-07 — Alertas de stock colapsables

**Motivo.** Con 14 perfumes agotados la lista tapaba el inventario entero.
**Solución.** Resumen + 3 filas + "Ver todos". Cuenta unidades, no ventas.
**Archivos.** `src/app/02-render.js` · **Riesgo.** 🟢

---

## 2026-07 — Importador de Excel

**Motivo.** Los usuarios vienen de una planilla. El import de JSON **reemplaza**; ellos
necesitan **agregar**.

**Qué resuelve del mundo real.** Detecta la fila de títulos (la primera suele ser el nombre
del negocio) · deduce día/mes vs mes/día mirando **toda la columna** · entiende la columna
de cuotas `1/3` (3 cuotas, 1 paga) · permite corregir el mapeo.

**Decisión clave.** Las ventas importadas van **sin `perfumeId`** a propósito: son
históricas y el stock de la planilla ya las tiene descontadas.

**Archivos.** `src/app/26-importar-excel.js`, `src/styles/26-importar.css`

**Riesgo.** 🟠 Importar dos veces la misma planilla duplica todo. Sin deduplicación
(ver [TODO.md](TODO.md) §M-03).

---

## 2026-07 — Pantalla de carga (splash)

**Motivo.** El arranque dejaba la pantalla en blanco.
**Decisión.** `#splash` va en el HTML **estático** (se pinta antes que el JS) y se oculta
en el **`finally`** de `init()`, para no tapar la pantalla de error ni el lock de PIN.
Mínimo 420 ms visible; se saca del DOM al terminar el fundido.
**Archivos.** `src/index.template.html`, `src/app/00-core.js`, `src/styles/25-splash.css`

---

## 2026-07 — E2E en CI + suite reparada

**Motivo.** 41 tests E2E existían pero **no corrían en ningún lado** y estaban rotos sin
que nadie se enterara (4/8 pasando).

**Causas de la rotura.** Modal de consentimiento bloqueante · una espera de arranque que se
cumplía siempre (`App.ventas !== undefined` sobre un `[]`) · la recarga del Service Worker.

**Solución.** Preámbulo con las banderas de consentimiento · esperar `pt_demo_seeded` ·
guard de `controllerchange`. El job `deploy` ahora depende de `[test, e2e]`.

**Archivos.** `.github/workflows/deploy.yml`, `playwright.config.js`, todos los `*.spec.js`

**Riesgo.** 🟢 Suma ~3 min por deploy. Vale.

---

## 2026-07 — Versión centralizada en `package.json`

**Motivo.** Tres copias manuales desincronizadas. `functions/version.js` decía `1.1.0`,
**más viejo que la app**, así que el chequeo de actualizaciones nunca disparaba.

**Solución.** `build.js` propaga desde `package.json` a `index.html`, `sw.js` y
`functions/version.js`, y **falla** si no encuentra dónde escribir.

**Archivos.** `scripts/build.js`, `sw.js`, `functions/version.js`

**⚠️ Quedó pendiente.** La versión ya se sincroniza, pero `/version` **no está ruteado**
en `worker.js`: sigue devolviendo 404. Ver [TODO.md](TODO.md) §T-01.

---

## 2026-07 — Recarga espuria del Service Worker

**Motivo.** Cada usuario nuevo entraba y la app se recargaba sola.
**Causa.** `controllerchange` se dispara en la primera visita por `clients.claim()`.
**Solución.** Guard `ptTeniaController` + `_hayTrabajoEnCurso()` para no pisar formularios.
**Archivos.** `sw.js`, `src/app/17-auto-update.js` · **Riesgo.** 🟢

---

## 2026-07 — Imagen Open Graph

El PNG tenía el titular superpuesto, sin fuentes, y la landing **ni lo usaba**.
Ahora se regenera con `npm run build:og` (Chromium rasteriza `scripts/og-image.html`).

---

## 2026-07 — v1.8.0 — Features F1 a F5

| # | Feature | Módulo | Store nuevo |
|---|---|---|---|
| F1 | Cantidad en la venta | `03-nueva-venta.js`, `db.js` | — |
| F2 | Recordatorios de cobro | `20-recordatorios.js` | — |
| F3 | Devoluciones y cambios | `22-devoluciones.js` | — |
| F4 | Compras al proveedor | `23-compras.js` | `compras` (v4) |
| F5 | Señas y encargos | `24-reservas.js` | `reservas` (v5) |

**Impacto estructural de F3.** 🔴 Introdujo `_ventasActivas()`. **Toda agregación de plata
tiene que usarla**; hay un test que falla si aparece `this.ventas.filter(` en `02-render.js`.

**Impacto estructural de F1.** 🔴 La venta guarda **totales**, el formulario trabaja **por
unidad**. Las ventas viejas sin `cantidad` valen 1.

**Impacto estructural de F4 y F5.** Dos stores nuevos ⇒ hubo que tocar `_encryptedStores`,
`loadData()` y **las 5 listas** de `10-data-management.js`.

**Riesgo.** 🟠 Alto en su momento. Mitigado con tests dedicados (`f1`-`f5.spec.js`).

---

## Antes de 2026-07 — Refactor del monolito

**Motivo.** `index.html` era un monolito de 6.400 líneas imposible de mantener.

**Solución.** Modularización en `src/` + `scripts/build.js` que reconstruye por
concatenación de texto. **Sin ES modules**: siguen siendo un único `<script>` clásico para
no romper los ~200 `onclick="App.metodo()"`.

**Riesgo residual.** 🟠 Alto y permanente: si alguien edita `index.html` a mano, el cambio
se pierde en el próximo build. Mitigado con el paso "no drift" de CI.

---

## Auditorías

| Versión | Score | Estado |
|---|---|---|
| App v1 | 53/100 | Resuelto |
| App v6 | 95/100 | Objetivo alcanzado |
| App v9 (completa) | 77/100 | Re-auditoría post-refactor |
| App 360 v3 | 81/100 | F-02 (falso positivo), F-23, F-26, F-27, F-28 resueltos |
| **App 360 v4** | **81/100** | F-24 (SRI) verificado, fullscreen 100vh/100vw, licencia owner, 223 tests |

Reportes en `standalone/auditoria-*.html`.
