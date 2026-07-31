# TODO — Lista viva

Ordenada por **impacto real**, no por facilidad. Cada entrada tiene evidencia: dónde está
el problema y cómo se comprueba.

**Última revisión:** 2026-07-29 (tarde) · App v1.8.0

**Leyenda:** 🔴 crítico · 🟠 alto · 🟡 medio · 🟢 bajo

**Decisiones cerradas** (no volver a proponerlas): el header muestra "Parfum Track" sin
nombre cargado (§D-26), el PIN se queda en "Más" (§D-27, provisional) y el documento fiscal
se queda en el store `config` sin cifrar (§D-24, con el disparador para reabrirlo escrito).
Ver [DECISIONS.md](DECISIONS.md). **No quedan decisiones de producto abiertas.**

---

## BUGS ABIERTOS

### 🟠 T-14 — Verificar en el próximo deploy que el fix de assets tomó efecto

**Por qué.** BUG-27: el repo entero se servía público porque `assets.exclude` no es un campo
válido de wrangler. El fix pasó todo a `.assetsignore`, pero **la verificación real es el
log del deploy**, y desde el sandbox no se puede alcanzar el dominio de producción.

**Estado tras el deploy del 30/07 (run 30553468515, commit `53df85a`):**

✅ **El WARNING de `exclude` desapareció.** Era el único aviso de config y ya no está: la
config se procesa limpia y `.assetsignore` es lo único que decide qué se sube.

⚠️ **Falta confirmar que lo viejo dejó de servirse.** El log dice `No files to upload` —
correcto, porque los blobs ya estaban en el storage de Cloudflare — pero **no imprime el
total del manifiesto**, así que del log solo no se puede saber si bajó de ~340 a ~40.
**La verificación que falta es pedir las URLs a mano** (puntos 3 y 4). Desde el sandbox no
se alcanza el dominio: la política de red del entorno lo bloquea.

**Qué mirar:**

1. ✅ Que **ya no aparezca** `Unexpected fields found in assets field: "exclude"` — hecho.
2. Que la cantidad de assets baje de **~340 a ~40**. Ojo: wrangler dice "X new or modified"
   y "N already uploaded" — el número que importa es el total, y solo lo imprime cuando
   hay algo que subir.
3. Probar a mano un par de URLs que **tienen** que dar 404:
   `/AI/SECURITY.md`, `/CLAUDE.md`, `/MARKETING-PLAN.md`, `/tests/xss.spec.js`,
   `/wrangler.jsonc`.
4. Y un par que **tienen** que seguir dando 200: `/`, `/landing.html`, `/terminos.html`,
   `/manifest.json`, `/fonts/dm-sans-latin.woff2`, `/.well-known/assetlinks.json`.

**⚠️ Los assets ya subidos no se borran solos.** Si tras el deploy alguna de las URLs del
punto 3 sigue respondiendo 200, hay que forzar la limpieza desde el Dashboard de Cloudflare
(Workers → parfumtrack → Settings → Assets) o hacer un deploy desde un directorio limpio.
**Esto es lo que decide si el hallazgo está realmente cerrado.**

**⚠️ Anomalía sin resolver (31/07).** Los tres deploys posteriores al fix (#103, #105, #106)
dijeron los tres `No files to upload`, **incluidos los que cambiaron `landing.html`,
`index.html`, `sw.js` y las cuatro capturas**. El manifiesto local es correcto —simulando la
lógica de wrangler da 37 archivos y están todos los que hacen falta—, así que `.assetsignore`
funciona. Lo que no se puede saber desde acá es si Cloudflare está sirviendo la versión nueva
de esos assets o quedó con la vieja.

**Cómo se resuelve en 5 segundos:** abrir `/landing.html` en producción y mirar el hero.
- Si dice **"Recién lanzada · Probala gratis"** y el título está en serif → los assets están al día.
- Si todavía dice **"+340 revendedores en LATAM"** → el deploy no actualizó los assets, y hay
  que forzarlo (Dashboard → Workers → parfumtrack → Settings → Assets, o un deploy limpio).

Ojo: los cambios de `worker.js` (entre ellos el fix de `/force-update`) **sí están en
producción** —el script del Worker se sube siempre, y el log lo confirma—. La duda es solo
sobre los assets estáticos.

**Dificultad.** Baja, pero es el paso que falta para dar BUG-27 por cerrado de verdad.

---

### 🟠 T-15 — Hay un sitio de Netlify conectado al repo

**Evidencia.** El PR #103 trajo un check `netlify/parfumtrackapp/deploy-preview` apuntando a
`app.netlify.com/projects/parfumtrackapp`. O sea: **hay una app de Netlify enganchada a este
repositorio** que buildea en cada PR.

**Por qué importa.** `.assetsignore` y `wrangler.jsonc` son de Cloudflare — **a Netlify no
lo tocan**. Si Netlify publica la raíz del repo (que es lo que hace por defecto, y acá no
hay `netlify.toml` que diga otra cosa), los mismos archivos que se acaban de cerrar en el
dominio de Cloudflare **siguen públicos en el dominio de Netlify** y en cada URL de deploy
preview. BUG-27 no está cerrado del todo hasta resolver esto.

**Además contradice la arquitectura declarada:** `CLAUDE.md` dice "Hosting: Cloudflare
Workers con Assets (NO Pages, NO Netlify)". Parece un resto de una migración vieja —
`.assetsignore` todavía nombra `netlify/` y `netlify.toml`, que ya no existen en el repo.

**Qué hacer.** Entrar a `app.netlify.com/projects/parfumtrackapp` y ver si el sitio está
publicado. Si no se usa —que es lo más probable—, **desconectarlo del repo y borrarlo**: es
superficie de ataque y una copia desactualizada de la app dando vueltas. Si se usa para
algo, hay que replicar las exclusiones ahí.

**Dificultad.** Baja. **No verificado desde acá**: la política de red del entorno no deja
alcanzar dominios externos.

---

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
| — | **Plan de marketing completo: `MARKETING-PLAN.md`** (4 fases con compuertas) |
| 7 días | Fase 0: captación manual — `MARKETING-SEMANA-1.md`. Va **antes** de los ads |
| 7 días | 12 ads Meta/IG. Material en la raíz: `ADS-META-IG-BRIEF.md`, `ADS-META-IG.json`, `_p_tiktok_ads.html` |
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
| ✅ T-08 `/force-update` ya no borra datos del usuario (BUG-29) | 07/2026 |
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
