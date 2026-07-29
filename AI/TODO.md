# TODO — Lista viva

Ordenada por **impacto real**, no por facilidad. Cada entrada tiene evidencia: dónde está
el problema y cómo se comprueba.

**Última revisión:** 2026-07-29 · App v1.8.0

**Leyenda:** 🔴 crítico · 🟠 alto · 🟡 medio · 🟢 bajo

---

## BUGS ABIERTOS

### 🔴 T-01 — `/version` no está ruteado: la actualización automática nunca dispara

**Evidencia.**
- `functions/version.js` existe y `scripts/build.js:76` le sincroniza la versión.
- `17-auto-update.js:25` hace `fetch('/version')` al arrancar y cada 5 minutos.
- **`worker.js:20-21` no incluye `/version`** en `POST_ROUTES` ni en `GET_ROUTES`, y
  tampoco lo importa.
- La request cae en `env.ASSETS.fetch()` → busca un archivo `version` en la raíz → 404.
- El `catch` de `_checkForUpdates()` se lo come con un `console.warn`.

**Impacto.** Los usuarios se quedan en la versión vieja hasta que el Service Worker
actualice por su cuenta. Todo el mecanismo de auto-update es código muerto.

**Complicación.** `version.js` exporta `export default { fetch }` (formato Worker), mientras
que el resto exporta `onRequestGet`/`onRequestPost`. Hay que adaptar la firma o el import.

**Solución.** Adaptar `version.js` a `onRequestGet`, importarlo en `worker.js`, sumar
`/version` a `GET_ROUTES` y agregar el `if (path === '/version')`. Test en `tests/worker.test.js`.

**Dificultad.** Baja (~30 min).

> ⚠️ **Verificado leyendo el código; NO confirmado contra producción** — el entorno donde
> se escribió esto no tiene red saliente. Antes de arreglarlo, comprobalo con
> `curl -i https://parfumtrack.luccasramireziglesias.workers.dev/version`.

---

### 🟠 T-02 — Comentario obsoleto en `db.js` contradice al código

**Evidencia.** `src/db.js:331-333` dice:
> *"Las cuotas canceladas NO se recrean (el usuario puede volver a editar la venta si las necesita)."*

Pero `db.js:355-378` **sí las recrea**, desde que el fuzzer encontró BUG-17.

**Impacto.** Bajo funcionalmente, alto en confusión: una IA o un dev que lea el comentario
va a razonar sobre un comportamiento que no existe.

**Solución.** Reescribir el comentario explicando por qué se recrean (la deuda del cliente
no puede desaparecer). Dificultad: trivial.

---

### 🟠 T-03 — Rate limits del router fail-open

**Evidencia.** `worker.js:85-88` y `123-125`: si KV falla, el `catch` loguea un warning y
**deja pasar la request**. Los de `_shared.js` sí son fail-closed.

**Impacto.** La regla del proyecto dice *"rate limiting fail-closed en TODOS los endpoints"*.
Con KV caído, el límite global de 1000/min y el de concurrencia desaparecen.

**Contraargumento válido.** Fail-closed en el rate limit **global** significa que si KV se
cae, la app entera deja de funcionar. Es una decisión de disponibilidad vs. seguridad que
conviene tomar explícitamente, no por descuido.

**Solución propuesta.** Fail-closed en `CRITICAL_ROUTES`, fail-open con alerta en el resto.
Dificultad: baja.

---

### 🟠 T-04 — CSRF implementado pero no obligatorio

**Evidencia.** `worker.js:146-148` dice literalmente:
> *"Token validation enforced at application level, not blocking requests yet"*

`validateDoubleSubmitCSRF()` y `validateCsrfToken()` existen en `_shared.js` pero ningún
handler las llama de forma bloqueante.

**Impacto.** Defensa en profundidad incompleta. El riesgo real está acotado por la
whitelist de CORS y `SameSite=Strict`.

**Solución.** Activar la validación endpoint por endpoint, empezando por los que mutan
estado (`/backup` POST, `/sync` POST, `/validate-license`). Dificultad: media — hay que
verificar que el cliente mande el header en todos los casos.

---

### 🟡 T-05 — `fmt()` puede mostrar hasta 3 decimales

**Evidencia.** `11-utils.js:23`. En una app de plata, `$1.234,567` se ve como un error.
**Solución.** Fijar 2 decimales o 0 según la moneda. Dificultad: trivial, pero hay que
revisar que no rompa tests que comparan strings de montos.

---

### 🟡 T-06 — Perfumes duplicados por nombre

**Evidencia.** `04-stock.js` no deduplica al crear. Se pueden tener dos "Yara Rosa" con
stock partido — le pasó al usuario con su catálogo real.

**Impacto.** El stock queda partido, los rankings cuentan dos entradas distintas.

**Solución.** Avisar (no bloquear) al crear un perfume con nombre igual a uno existente,
con opción de fusionar. Dificultad: media — fusionar implica reasignar `perfumeId` en
ventas, compras y reservas.

---

### 🟡 T-07 — Duplicación en el fullscreen del modal de demo

**Evidencia.** `01-navigation.js`: `expandDemoVideo()` y `closeDemoModal()` manipulan ~15
estilos inline cada una y duplican la lógica de "volver a tamaño normal".

**Solución.** Mover a una clase CSS `.expanded` y dejar solo el toggle en JS.
Dificultad: baja. Cubierto por `tests/fullscreen-headless.test.js`.

---

### 🟡 T-08 — `/force-update` borra IndexedDB sin advertencia

**Evidencia.** `worker.js:200` devuelve `Clear-Site-Data: "cache", "storage"`.
**`storage` incluye IndexedDB** — o sea, todo el historial del usuario.

**Impacto.** Es una escotilla de emergencia para cache envenenado, pero **destruye los
datos**. La página que devuelve no lo advierte.

**Solución.** O sacar `"storage"` y dejar solo `"cache"`, o poner una advertencia explícita
con paso de backup previo. Dificultad: baja. **Decisión de producto, no técnica.**

---

### 🟡 T-09 — Sin locking entre pestañas

**Evidencia.** `_initTabSync()` sincroniza **después** de escribir, vía `BroadcastChannel`.
No hay locking: dos pestañas editando el mismo registro se pisan (gana la última).

**Impacto.** Poco frecuente en móvil (el caso de uso real), más probable en escritorio.
**No cubierto por tests.**

**Solución.** Web Locks API donde esté disponible, o versionado optimista con detección de
conflicto. Dificultad: media-alta.

---

### 🟢 T-10 — `'unsafe-inline'` en la CSP

Inherente a la arquitectura de un solo archivo (D-01). Mitigado con `esc()` + delegación
de eventos. **No se arregla sin revertir D-01.** Se documenta para que no se reporte como
hallazgo nuevo en cada auditoría.

---

## COBERTURA DE TESTS PENDIENTE

| # | Qué falta | Prioridad |
|---|---|---|
| C-01 | Concurrencia multi-pestaña real (dos contextos escribiendo a la vez) | 🟠 |
| C-02 | Interrupción a mitad de una operación (cerrar la app durante un guardado) | 🟠 |
| C-03 | Clicks de la UI del importador de Excel (la lógica sí está cubierta) | 🟡 |
| C-04 | Flujo completo de Mercado Pago punta a punta (los handlers sí, el flujo no) | 🟡 |
| C-05 | Comportamiento con storage lleno (`QuotaExceededError`) | 🟡 |
| C-06 | Fotos muy grandes en el backup JSON | 🟢 |

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

### 🟡 M-03 — Deduplicar al importar Excel
Importar la misma planilla dos veces duplica todo (D-13). Detectar ventas idénticas
(mismo cliente + perfume + fecha + monto) y avisar.

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
