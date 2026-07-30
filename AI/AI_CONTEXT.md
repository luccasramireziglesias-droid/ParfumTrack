# AI_CONTEXT — ParfumTrack

> **Este es el PRIMER archivo que tenés que leer.** Si solo vas a leer uno, leé este.
> Última actualización: 2026-07-29 · App v1.8.0 · IndexedDB v5 · Service Worker v16

---

## 1. Qué es

PWA de gestión de ventas para **revendedores de perfumes en LATAM** (Argentina, Uruguay,
Colombia, México). El usuario típico vende perfumes por WhatsApp/Instagram y hoy anota
todo en una planilla de Excel o en un cuaderno.

**Promesa central:** *"Dejá de adivinar cuánto ganás"*. Registrar una venta en 10 segundos
y ver la ganancia real (venta − costo), sin hacer cuentas.

- **Producción:** https://parfumtrack.luccasramireziglesias.workers.dev
- **Contacto:** parfumtrack@gmail.com · WhatsApp +598 94 466 577 · Montevideo, Uruguay
- **Entidad legal:** "Parfum Track" (nunca nombres personales en documentos legales)

---

## 2. Las 8 cosas que más se malinterpretan

Si te salteás esta sección vas a romper algo. En orden de gravedad:

1. **`index.html` es GENERADO. Nunca lo edites a mano.**
   Se construye con `node scripts/build.js` desde `src/`. Editarlo directo se pierde en
   el próximo build. Fuente real: `src/app/*.js`, `src/screens/*.html`, `src/styles/*.css`,
   `src/db.js`, `src/index.template.html`.

2. **No hay ES modules ni framework.** Todo termina en UN `<script>` clásico inline.
   `App` es un único objeto global; cada archivo de `src/app/` aporta métodos a ese objeto
   por concatenación de texto. Por eso todos los `onclick="App.metodo()"` del HTML funcionan.
   **No agregues `import`/`export` en `src/app/` ni en `src/db.js`** — rompe el build.

3. **La versión vive SOLO en `package.json`.**
   `scripts/build.js` la propaga a `index.html` (meta `app-version`), `sw.js` (`APP_VERSION`)
   y `functions/version.js`. Editar cualquiera de esas tres a mano crea desincronización.

4. **Los datos del usuario viven SOLO en su dispositivo** (IndexedDB). No hay base de datos
   de usuarios en el servidor. Perder IndexedDB = perder todo. Por eso hay
   `navigator.storage.persist()`, backup a R2 y export JSON.

5. **Al agregar un object store hay que tocar 4 lugares.** Si te olvidás de uno, un restore
   borra datos del usuario. Ver [DATABASE.md](DATABASE.md) §"Agregar un store".

6. **Toda agregación sobre ventas usa `App._ventasActivas()`**, nunca `this.ventas.filter(`.
   Las ventas devueltas (F3) siguen en el historial pero no cuentan para la ganancia.
   Hay un test que falla si aparece un `this.ventas.filter(` en `02-render.js`.

7. **La venta guarda TOTALES en `precioVenta`/`precioCompra`; el formulario trabaja por unidad.**
   Una venta de 2 unidades a $1000 guarda `precioVenta: 2000`. Las ventas viejas sin
   `cantidad` valen 1.

8. **Las migraciones de IndexedDB son aditivas.** Nunca `deleteObjectStore`, nunca cambiar
   un `keyPath`. Hay usuarios reales con bases v3 en la calle.

---

## 3. Stack en una pantalla

| Capa | Qué es |
|---|---|
| **Frontend** | HTML + CSS + JS vanilla. Sin build tool más que concatenación de texto. |
| **Backend** | Cloudflare Workers. `worker.js` es el router; `functions/*.js` los handlers. |
| **Datos del usuario** | IndexedDB v5, local, cifrado con AES-GCM cuando hay licencia. |
| **Datos del servidor** | KV `PT_LICENSES` (licencias, trial, rate limit) + R2 `parfumtrack-backups`. |
| **Offline** | Service Worker v16. Precache de estáticos, navegación Network-First. |
| **Tests** | 637 Vitest (unit/estáticos) + 137 Playwright (E2E). Los dos corren en CI. |
| **CI/CD** | GitHub Actions: `npm run build` + `npm test` + E2E → deploy automático en push a `main`. |
| **Android** | Capacitor con `server.url` — la app nativa carga la web remota, no la empaqueta. |

**Servicios externos:** Mercado Pago (suscripciones + webhooks), Brevo (email transaccional),
OneSignal (push), Plausible (analytics sin cookies).

---

## 4. Modelo de datos en 30 segundos

9 object stores en IndexedDB (`ParfumTrackDB`, versión 5):

```
perfumes   → catálogo + stock + precios de referencia
ventas     → el hecho central del negocio (puede estar `devuelta`)
cuotas     → deuda del cliente; N filas por venta en cuotas
pedidos    → pedidos al proveedor (pendiente/enviado)
caja       → movimientos de efectivo (entrada/salida)
gastos     → gastos del negocio por categoría
compras    → reposición de stock con su costo real (v4)
reservas   → señas y encargos, incluso sin stock (v5)
config     → preferencias. ÚNICO store NO cifrado.
```

**Clientes NO tienen store propio** — se derivan al vuelo de ventas + cuotas, así nunca
quedan desincronizados.

Detalle completo de campos, índices y relaciones: [DATABASE.md](DATABASE.md).

---

## 5. Flujo mental de una venta

```
Usuario carga una venta
  → DB.addVenta()
     ├─ descuenta stock (nunca a negativo) y guarda cuánto descontó
     ├─ si es en cuotas: crea N filas en `cuotas`, la 1ª cobrada por defecto
     └─ inserta en `ventas`
  → App.loadData()  (recarga los 8 arrays en memoria)
  → App.renderAll() (rinde SOLO la pantalla visible, debounce 100ms)
```

Todo lo demás (ganancia, ranking, deudores, alertas de stock, recordatorios) es **derivado**:
se recalcula desde `App.ventas` / `App.cuotasData`, no se persiste.

Ver el grafo completo en [KNOWLEDGE_GRAPH.md](KNOWLEDGE_GRAPH.md).

---

## 6. Reglas de negocio que NO se pueden romper

Están protegidas por tests. Si tu cambio las viola, CI te frena.

| Regla | Dónde vive |
|---|---|
| El stock nunca queda negativo | `db.js` — `Math.min(cantidad, p.stock)` |
| Una venta devuelta no cuenta para la ganancia | `_ventasActivas()` |
| Al devolver, se cancelan las cuotas impagas y se conservan las cobradas | `db.js devolverVenta` |
| Al deshacer una devolución, la deuda vuelve | `db.js revertirDevolucion` |
| Las cuotas de una venta suman exactamente su `precioVenta` | invariante del fuzzer |
| Nunca se puede pagar una cuota de más | `db.js pagarCuota` lanza `Sobrepago` |
| La seña nunca supera el total de la reserva | `db.js addReserva` |
| El total adeudado suma TODAS las cuotas, no solo las visibles | `02-render.js renderCuotas` |
| Las operaciones que tocan stock están serializadas (Web Locks) | `db.js _conLockStock` |
| Una reserva no descuenta stock hasta entregarse | `db.js entregarReserva` |

---

## 7. Convenciones obligatorias del proyecto

- **Comunicación con el usuario: SIEMPRE español rioplatense (voseo argentino).**
- **Género neutro:** "revendedores", "clientes" — nunca "revendedoras"/"clientas".
- **Email oficial:** `parfumtrack@gmail.com`. Nunca inventes `hola@parfumtrack.com`.
- **Hosting: Cloudflare Workers con Assets.** No Pages, no Netlify, no Vercel.
- **Paleta dark obligatoria.** Nunca fondos blancos.
  `bg #0f0f1a` · `bg2 #1a1a2e` · `card #1e1e35` · `gold #c9a84c` · `gold2 #e8c97e`
  · `text #f0ece4` · `green #70c9a0` · `red #e07070`
- **Fuentes:** Cormorant Garamond (títulos) · DM Sans (body). Servidas localmente.
- **Emoji de marca:** 🍶
- **Rate limiting fail-closed** en todos los endpoints del backend.
- **`List-Unsubscribe` obligatorio** en todos los emails transaccionales.
- **Comentarios de código en español**, explicando *por qué*, no *qué*.

---

## 8. Comandos

```bash
node scripts/build.js      # regenera index.html desde src/  ← SIEMPRE tras tocar src/
npm run build              # build.js + build-landing.js
npm test                   # 637 tests Vitest
npx playwright test        # 137 tests E2E (necesita la app servida en :8787)
npm run build:og           # regenera la imagen Open Graph con Chromium
```

Volumen y fuzzing configurables por variable de entorno:
```bash
FUZZ_CORRIDAS=30 FUZZ_OPS=120 npx playwright test tests/fuzz.spec.js
VOL_VENTAS=5000 npx playwright test tests/volumen.spec.js
```

---

## 9. Estado actual y lo que está roto

**Score de la última auditoría 360°: 81/100.**

Hallazgos abiertos que importan (detalle y prioridad en [TODO.md](TODO.md)):

1. 🟡 `/force-update` borra IndexedDB (`Clear-Site-Data: "cache", "storage"`) sin advertirle
   al usuario. Es una escotilla de emergencia que destruye datos.
2. 🟡 Las reservas y los pedidos no tienen aviso de duplicado (los perfumes y el importador
   de Excel sí).
3. 🟢 `'unsafe-inline'` en la CSP — inherente a la arquitectura de un solo archivo (D-01).

**Cerrados recientemente:** `/version` ruteado (la actualización automática ya dispara),
CSRF bloqueando de verdad, rate limits fail-closed en rutas críticas, y el race de stock
entre pestañas que inventaba inventario.

**Sin cubrir por tests:** los clicks de la UI del importador de Excel (la lógica sí está
cubierta) y el flujo completo de Mercado Pago punta a punta.

---

## 10. Cómo trabajar en este proyecto (flujo obligatorio)

```
1. AI_CONTEXT.md          ← estás acá
2. PROJECT_MAP.md         ← ubicá el archivo que tenés que tocar
3. MODULES.md             ← SOLO la sección del módulo afectado
4. El código estrictamente necesario
5. Hacé el cambio en src/, NUNCA en index.html
6. node scripts/build.js
7. npm test  (+ playwright si tocaste comportamiento)
8. Actualizá la documentación (ver AI_RULES.md §Mantenimiento)
```

**No leas el proyecto entero.** Está documentado justamente para que no tengas que hacerlo.

Reglas completas y no negociables: [AI_RULES.md](AI_RULES.md).
