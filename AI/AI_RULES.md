# AI_RULES — Reglas obligatorias para cualquier IA

**Este archivo y [AI_CONTEXT.md](AI_CONTEXT.md) se leen SIEMPRE, en toda sesión.**

Las reglas están ordenadas por consecuencia: las primeras, si se rompen, destruyen trabajo
o datos de usuarios reales.

---

## PARTE 1 — Flujo de trabajo obligatorio

### 1.1 Orden de lectura

```
1. AI_CONTEXT.md      ← resumen ejecutivo. SIEMPRE primero
2. AI_RULES.md        ← este archivo
3. PROJECT_MAP.md     ← ubicar el archivo a tocar
4. MODULES.md         ← SOLO la sección del módulo afectado
5. El código estrictamente necesario
```

### 1.2 🔴 NO analices todo el proyecto

Esta base de conocimiento existe **precisamente** para que no tengas que hacerlo.

**Prohibido:**
- Leer todos los archivos de `src/app/` "para entender el contexto"
- Leer `index.html` (son 6.400 líneas **generadas**)
- Releer módulos que ya están documentados en `MODULES.md`
- Buscar a ciegas cuando `PROJECT_MAP.md` §9 te dice dónde tocar

**Permitido y esperado:**
- Abrir el módulo que vas a modificar
- Abrir `db.js` si tocás datos
- Abrir un test para entender un contrato
- Buscar un símbolo puntual con grep

### 1.3 Antes de tocar código

| Preguntá | Respuesta en |
|---|---|
| ¿Ya pasó este bug? | [BUG_HISTORY.md](BUG_HISTORY.md) |
| ¿Esta decisión ya se debatió? | [DECISIONS.md](DECISIONS.md) |
| ¿Qué más depende de esto? | [KNOWLEDGE_GRAPH.md](KNOWLEDGE_GRAPH.md) §8 |
| ¿Ya está en la lista? | [TODO.md](TODO.md) |

---

## PARTE 2 — Reglas que destruyen trabajo si se rompen

### 2.1 🔴 NUNCA edites `index.html`

Es **generado** por `node scripts/build.js` desde `src/`. Editarlo a mano:
- se pierde en el próximo build,
- hace fallar CI por drift.

**Editá `src/`. Después corré `node scripts/build.js`. Siempre.**

### 2.2 🔴 NUNCA uses `import` / `export` en `src/app/` ni `src/db.js`

Todo se concatena en un `<script>` clásico. Un `import` rompe la app entera.

### 2.3 🔴 NUNCA dupliques un nombre de método

Todos los archivos de `src/app/` aportan al mismo objeto `App`. Un nombre repetido: el
último gana, **sin ningún error**.

### 2.4 🔴 NUNCA renombres un método público sin buscar el string

El HTML llama `onclick="App.metodo()"`. Es texto: no hay error de compilación, la UI
simplemente deja de responder.

```bash
grep -rn "App.miMetodo" src/screens/ src/index.template.html
```

### 2.5 🔴 NUNCA cambies la versión fuera de `package.json`

`build.js` la propaga a `index.html`, `sw.js` y `functions/version.js`.

### 2.6 🔴 NUNCA hagas una migración destructiva de IndexedDB

Nada de `deleteObjectStore`, nada de cambiar un `keyPath`. Hay usuarios reales con bases v3.

### 2.7 🔴 NUNCA agregues un store sin tocar los 4 lugares

`openDB()` + `_encryptedStores` + `loadData()` + **las 5 listas** de
`10-data-management.js`. Si falta uno, **un restore borra los datos de ese store**.
Checklist en [DATABASE.md](DATABASE.md) §8.

---

## PARTE 3 — Reglas de corrección

### 3.1 🔴 Toda agregación de plata usa `_ventasActivas()`

Nunca `this.ventas.filter(`. Hay un test que falla si esa cadena aparece en `02-render.js`.

### 3.2 🔴 Los totales se calculan sobre el conjunto completo

Nunca sobre lo visible en una lista paginada. Sería el peor bug posible en la pantalla de
cobros.

### 3.3 🔴 Todo dato del usuario pasa por `esc()`

Todo el render va por `innerHTML`. Sin `esc()` hay XSS.

### 3.4 🔴 Nunca datos del usuario dentro de un `onclick=""`

`data-*` + delegación de eventos. Ver [BUG_HISTORY.md](BUG_HISTORY.md) §BUG-02.

### 3.5 🔴 Todo guardado async se envuelve en `_once()`

Sin eso, un doble toque registra la operación dos veces.

### 3.6 🔴 Respetá el ciclo de mutación

```js
await DB.operacion(...);   // persistir
await App.loadData();      // recargar estado
this.renderAlgo();         // renderizar
this._notifyTabs();        // avisar a otras pestañas
```

Nunca mutes `App.ventas` a mano y renderices.

### 3.7 🔴 Asumí que cualquier campo puede faltar

IndexedDB no impone esquema. `parseInt(v.cantidad, 10) || 1`, `c.montoPagado || 0`.

### 3.8 🟠 Toda lista que puede crecer sin techo tiene que paginar

---

## PARTE 4 — Alcance

### 4.1 🔴 No modifiques código fuera del alcance de la tarea

Si te piden arreglar el paginado de cuotas, **no** aproveches para refactorizar
`02-render.js`. Si ves algo que está mal, **anotalo en [TODO.md](TODO.md)** y seguí.

### 4.2 🔴 No revivas decisiones cerradas

Antes de proponer "¿y si usamos React?" o "¿y si guardamos los datos en el servidor?",
leé [DECISIONS.md](DECISIONS.md). Cada decisión tiene contexto, alternativas evaluadas y el
costo aceptado.

**Reabrila solo si cambió el contexto que la justificaba** — ese contexto está escrito
justamente para poder verificarlo.

### 4.3 🟠 No dupliques lógica

Ver si ya existe: `_renderVentaCard()`, `_processPhoto()`, `_ventasActivas()`,
`parseMonto()`, `esc()`, `fmt()`, `_once()`.

### 4.4 🟠 Mantené la consistencia arquitectónica

Un módulo nuevo se ve como los existentes: mismo encabezado con el **porqué**, mismos
patrones de nombres, mismo par `guardarX()` / `_guardarXImpl()`.

---

## PARTE 5 — Honestidad

### 5.1 🔴 No inventes información

Si un dato falta, decí "no documentado". **Nunca lo completes con una suposición
presentada como hecho.**

### 5.2 🔴 Distinguí verificado de deducido

- **Verificado:** lo leíste en el código o lo corriste.
- **Deducido:** lo inferiste. **Decilo explícitamente.**

Ejemplo real de esta base: *"`/version` no está ruteado — verificado leyendo `worker.js`;
**no confirmado contra producción**, el entorno no tenía red saliente."*

### 5.3 🔴 Reportá los resultados como son

Si los tests fallan, decilo con la salida. Si salteaste un paso, decilo. Si algo quedó a
medias, decí qué y por qué. **Nunca reportes "listo" sobre algo que no verificaste.**

### 5.4 🟠 Si no podés verificar algo, decilo y seguí

Hacé todo lo que **no** depende de esa verificación, y dejá anotado qué quedó sin confirmar.

---

## PARTE 6 — Comunicación

### 6.1 🔴 SIEMPRE en español rioplatense (voseo argentino)

"Cargá", "Guardá", "Fijate", "Tenés". Aplica a la conversación, al código, a los comentarios
y a la UI.

### 6.2 🔴 Género neutro

"revendedores", "clientes". **Nunca** "revendedoras"/"clientas".

### 6.3 🔴 Email oficial: `parfumtrack@gmail.com`

Nunca inventes `hola@parfumtrack.com` — aparece como ejemplo en un comentario viejo de
`send-email.js` y **no es el valor real**.

### 6.4 🟠 Explicá el porqué, no el qué

El usuario es el dueño del producto y entiende el negocio. Explicale **qué se rompía y por
qué**, no qué líneas cambiaste.

---

## PARTE 7 — Mantenimiento de esta base de conocimiento

### 7.1 🔴 Actualizá la documentación EN EL MISMO COMMIT

No "después". Una base desactualizada es **peor que no tenerla**: la IA trabaja con
confianza sobre datos falsos.

### 7.2 Qué actualizar según el cambio

| Hiciste… | Actualizá |
|---|---|
| **Cualquier cambio relevante** | `CHANGELOG_AI.md` |
| Arreglaste un bug | `BUG_HISTORY.md` + `TODO.md` (marcalo resuelto) |
| Tomaste una decisión técnica | `DECISIONS.md` |
| Agregaste o cambiaste un módulo | `MODULES.md` + `PROJECT_MAP.md` |
| Cambiaste la estructura de carpetas | `PROJECT_MAP.md` |
| Cambiaste arquitectura, estado o flujo | `ARCHITECTURE.md` + `KNOWLEDGE_GRAPH.md` |
| Tocaste stores, campos o migraciones | `DATABASE.md` |
| Agregaste o cambiaste un endpoint | `SERVICES.md` + `ROUTES.md` |
| Agregaste o cambiaste una pantalla | `ROUTES.md` + `COMPONENTS.md` |
| Tocaste seguridad | `SECURITY.md` |
| Optimizaste o mediste algo | `PERFORMANCE.md` |
| Agregaste tests o cambiaste los conteos | `TESTING.md` |
| Encontraste algo mal que no vas a arreglar ahora | `TODO.md` |
| **Cualquier cambio que altere el resumen ejecutivo** | `AI_CONTEXT.md` |

### 7.3 🔴 `AI_CONTEXT.md` no puede pasar de 500 líneas

Es lo primero que lee toda IA. Si crece, **movés detalle a los archivos específicos**; no
lo dejás crecer.

### 7.4 🔴 `BUG_HISTORY.md` no se borra nunca

Un bug arreglado sigue siendo información: explica por qué el código tiene la forma que
tiene, y evita que alguien "simplifique" una defensa que existe por una razón.

### 7.5 🟠 `CLAUDE.md` sigue siendo la fuente de las reglas operativas

Se carga automáticamente en cada sesión. Si cambia una regla del proyecto (paleta, hosting,
email, convenciones), va **ahí primero**; `AI/` es la referencia profunda.

---

## PARTE 8 — Checklist antes de decir "listo"

```
[ ] Edité en src/, NO en index.html
[ ] Corrí node scripts/build.js
[ ] npm test pasa (560)
[ ] npx playwright test pasa (72), si toqué comportamiento
[ ] Los datos del usuario pasan por esc()
[ ] Los guardados async están en _once()
[ ] Las agregaciones usan _ventasActivas()
[ ] No dupliqué nombres de método
[ ] No renombré un método público sin buscar el string en el HTML
[ ] Store nuevo → los 4 lugares
[ ] Pantalla nueva → screens/ + marcador + if en showScreen()
[ ] Endpoint nuevo → import + ROUTES + if + rate limit fail-closed
[ ] Actualicé la documentación de AI/ (§7.2)
[ ] Reporté los resultados como son, sin adornar
```

---

## PARTE 9 — Resumen en 10 líneas

```
1. Leé AI_CONTEXT.md primero. No analices todo el proyecto.
2. Editá src/, nunca index.html. Corré build.js.
3. Sin import/export. Sin nombres de método duplicados.
4. La versión solo en package.json.
5. Store nuevo = 4 lugares, o un restore borra datos.
6. Toda agregación de plata usa _ventasActivas().
7. Todo dato del usuario pasa por esc(). Nada en onclick.
8. No revivas decisiones cerradas: leé DECISIONS.md.
9. No inventes. Distinguí verificado de deducido.
10. Actualizá AI/ en el mismo commit. Español rioplatense siempre.
```
