# PARFUMTRACK — PROJECT MASTER MEMORY v1.1 (30/06/2026)

## ANTES DE EMPEZAR CUALQUIER TAREA

Leé primero `AI/AI_CONTEXT.md` (resumen ejecutivo) y `AI/AI_RULES.md` (reglas para IAs).
Después `AI/PROJECT_MAP.md` para ubicar el archivo, y solo la sección correspondiente de
`AI/MODULES.md`. **No analices todo el proyecto** — la carpeta `AI/` existe justamente para
evitarlo. Al terminar, actualizá la documentación según `AI/AI_RULES.md` §7.

## REGLAS INQUEBRANTABLES

- Comunicación SIEMPRE en español (voseo argentino)
- Género neutro: "revendedores" NO "revendedoras", "clientes" NO "clientas"
- Email oficial: parfumtrack@gmail.com (NUNCA "hola@parfumtrack.com")
- Hosting: Cloudflare Workers con Assets (NO Pages, NO Netlify)
- URL producción: https://parfumtrack.luccasramireziglesias.workers.dev
- Entidad legal: "Parfum Track" (sin nombres personales en docs legales)
- Paleta dark obligatoria: fondos #0f0f1a/#1a1a2e, gold #c9a84c/#e8c97e. Nunca fondos blancos.
- Fuentes: Cormorant Garamond (títulos), DM Sans (body)
- Rate limiting fail-closed en TODOS los endpoints backend
- List-Unsubscribe obligatorio en TODOS los emails transaccionales
- Usar material real (screenshots) siempre que sea posible, no mockups genéricos
- Priorizar conversión sobre likes en marketing

## QUÉ ES

PWA de gestión de ventas para revendedores de perfumes en LATAM (Argentina, Uruguay, Colombia, México). Registro de ventas en 10 segundos, ganancia real automática, control de stock, cuotas, cobros por WhatsApp, catálogo WA, estadísticas. Funciona offline. Sin descarga.

**Headline:** "Dejá de adivinar cuánto ganás"
**Contacto:** parfumtrack@gmail.com | WhatsApp +598 94 466 577 | Montevideo, Uruguay

## STACK TÉCNICO

- **Frontend:** HTML+CSS+JS vanilla. `index.html` (~6.4K líneas) se genera con `node scripts/build.js` a partir de los módulos fuente en `src/` (sin ES modules — sigue siendo un único `<script>` clásico inline para no romper los `onclick="App.metodo()"`). Editar siempre en `src/`, nunca `index.html` a mano.
- **Backend:** 11 Cloudflare Worker functions (`worker.js` como router). Agregar un endpoint son TRES pasos: importarlo, listarlo en POST/GET_ROUTES y el `if`. Saltear el segundo da 404 aunque el archivo exista (le pasó a `/version` por 3 semanas)
- **Storage:** KV namespace `PT_LICENSES` (trial, rate limit, licencias), R2 bucket `parfumtrack-backups`
- **Datos usuario:** IndexedDB v5 (local, NO en servidores). Las 7 operaciones que tocan stock pasan por `DB._conLockStock()` (Web Locks): sin eso, dos pestañas perdían descuentos. Stores: `perfumes`, `ventas`, `cuotas`, `pedidos`, `caja`, `gastos`, `compras` (v4), `reservas` (v5), `config`. Todos encriptados salvo `config`. Al agregar un store hay que sumarlo a `_encryptedStores`, a `loadData()` y a TODAS las listas `const stores = [...]` de `10-data-management.js` (si no, un restore se come los datos).
- **Versionado:** la versión vive SOLO en `package.json`. `scripts/build.js` la propaga a `index.html` (meta app-version), `sw.js` (`APP_VERSION`) y `functions/version.js`. Nunca editarlas a mano.
- **CDN lazy-load:** Chart.js 4.4.0, jsPDF 2.5.1, XLSX 0.18.5 (SRI sha384 implementado en `_loadScript()` — F-24 resuelto)
- **Service Worker:** v16 (`sw.js`), precachea `STATIC_ASSETS` en `install`; navegación Network-First. El handler de `controllerchange` solo recarga si ya había un controller (si no, recargaba en la primera visita de cada usuario) y nunca encima de un formulario en curso.
- **CI/CD:** GitHub Actions → `npm run build` + `npm test` → auto-deploy on push to main

### Servicios externos

| Servicio | Uso |
|----------|-----|
| Mercado Pago | Suscripciones + webhooks de pago |
| Brevo (Sendinblue) | Email transaccional (OTP, notificaciones) |
| OneSignal | Push notifications |
| Plausible | Analytics sin cookies, GDPR compliant |

### Secrets (Cloudflare Dashboard)

`BREVO_API_KEY`, `LICENSE_SERVER_SECRET`, `LICENSE_PRIVATE_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`

### Config (wrangler.jsonc)

`FROM_EMAIL=parfumtrack@gmail.com`, `FROM_NAME="Parfum Track"`, `APP_URL=https://parfumtrack.luccasramireziglesias.workers.dev`, `MP_CURRENCY_ID=USD`, `MP_AMOUNT_MONTHLY=9.99`, `MP_AMOUNT_ANNUAL=95.88`, `OWNER_EMAIL=parfumtrack@gmail.com`

## MAPA DE ARCHIVOS

```
ParfumTrack/
├── index.html              ← Generado por scripts/build.js (NO editar a mano, ~6.400 líneas)
├── src/                    ← Fuente modular de index.html (styles/, screens/, app/, db.js)
├── scripts/build.js        ← Reconstruye index.html desde src/
├── landing.html            ← Landing page de marketing (2,218 líneas)
├── worker.js               ← Router entry point Workers (142 líneas)
├── sw.js                   ← Service Worker v14 (133 líneas)
├── manifest.json           ← PWA manifest con shortcuts + screenshots
├── wrangler.jsonc          ← Config Cloudflare Workers
├── _headers                ← Security headers (CSP, HSTS, etc.)
├── terminos.html           ← Términos y condiciones v2.0
├── privacidad.html         ← Política de privacidad v2.0
├── checkout-success.html   ← Post-pago exitoso
├── checkout-pending.html   ← Post-pago pendiente
├── fonts/fonts.css         ← Fuentes locales
├── img/whatsapp-cobro.jpg  ← Screenshot cobro WA
├── screenshot-*.jpg        ← Screenshots reales de la app
├── AI/                     ← Base de conocimiento para IAs (20 archivos, excluida del deploy)
│   ├── AI_CONTEXT.md       ← LEER PRIMERO — resumen ejecutivo
│   ├── AI_RULES.md         ← Reglas obligatorias + mantenimiento de la doc
│   ├── PROJECT_MAP.md      ← Índice: dónde tocar según la tarea
│   ├── MODULES.md          ← Un módulo por sección (leer solo el afectado)
│   ├── ARCHITECTURE.md · DATABASE.md · SERVICES.md · ROUTES.md · COMPONENTS.md
│   ├── SECURITY.md · PERFORMANCE.md · TESTING.md · CODE_STANDARDS.md
│   ├── DECISIONS.md        ← Por qué se decidió cada cosa (no re-debatir)
│   ├── BUG_HISTORY.md      ← Nunca se borra
│   └── TODO.md · CHANGELOG_AI.md · KNOWLEDGE_GRAPH.md · ROADMAP.md · README_AI.md
├── functions/              ← 10 Worker functions
│   ├── trial.js            ← OTP email + trial anchor
│   ├── validate-license.js ← ECDSA license validation
│   ├── backup.js           ← R2 backup GET/POST con HMAC
│   ├── sync.js             ← Cloud sync GET/POST con HMAC
│   ├── send-email.js       ← Email via Brevo con templates
│   ├── send-notification.js← Push via OneSignal
│   ├── mp-create-preference.js ← Crear preferencia MP
│   ├── mp-webhook.js       ← Webhook pagos MP
│   ├── mp-subscription-status.js ← Status suscripción
│   └── mp-payment-status.js← Status pago
└── standalone/             ← Reportes y assets (excluidos del deploy)
```

### Rutas API

| Método | Ruta | Función |
|--------|------|---------|
| POST | /trial | OTP register + verify |
| POST | /validate-license | ECDSA license check |
| POST | /send-email | Email via Brevo |
| POST | /send-notification | Push via OneSignal |
| GET\|POST | /backup | R2 backup con HMAC |
| GET\|POST | /sync | Cloud sync con HMAC |
| POST | /mp-create-preference | Crear preferencia MP |
| GET\|POST | /mp-webhook | Webhook pagos MP |
| GET | /mp-subscription-status | Status suscripción |
| GET | /mp-payment-status | Status pago |
| GET | /version | Versión del app para el auto-update |

## MONETIZACIÓN

| Plan | Precio | Features clave | Estado |
|------|--------|----------------|--------|
| Free | $0 siempre | Ventas ilimitadas, stock, ganancia, cuotas, cobros WA, offline | ACTIVO |
| Básico Pro | $9.99/mes o $7.99/mes anual | Todo Free + estadísticas, catálogo WA, ranking, PDF/Excel, push | ACTIVO |
| Pro | $19.99/mes | Multi-perfil, backup auto, sync multi-dispositivo | PRÓXIMAMENTE |

## SEGURIDAD IMPLEMENTADA

- CSP restrictivo con whitelist de scripts
- HSTS con preload (2 años)
- X-Frame-Options DENY
- Rate limiting KV-based fail-closed en 10 endpoints
- CORS whitelist (localhost, 127.0.0.1, parfumtrack.pages.dev, parfumtrack.luccasramireziglesias.workers.dev)
- CSRF obligatorio (403 sin header) en /trial, /validate-license, /backup y /sync. `/mp-create-preference` queda afuera: lo llama la landing, que no tiene token
- HMAC auth para backup/sync
- ECDSA para validación de licencias
- List-Unsubscribe en todos los emails
- SRI sha384 en jsPDF 2.5.1 y XLSX 0.18.5 (cargados con `integrity` + `crossOrigin` en `_loadScript()`)

## BRANDING

- **Paleta:** bg=#0f0f1a, bg2=#1a1a2e, card=#1e1e35, gold=#c9a84c, gold2=#e8c97e, gold3=#f5dfa0, text=#f0ece4, green=#70c9a0, red=#e07070
- **Gradiente gold:** #c9a84c → #e8c97e (135deg)
- **Fuentes:** Cormorant Garamond (títulos bold), DM Sans (body regular/500/600/700)
- **Emoji de marca:** 🍶

## AUDITORÍAS (score progression)

| Versión | Score | Estado |
|---------|-------|--------|
| App v1 | 53/100 | Resuelto |
| App v2 | 81/100 | Resuelto |
| App v3 | 87/100 | Resuelto |
| App v4 | 92/100 | Resuelto |
| App v5 | 92/100 | Resuelto |
| App v6 | 95/100 | Objetivo alcanzado |
| App v7 | 95/100 | 0 hallazgos abiertos |
| Landing v1 | 91+/100 | Plan 24h completado |
| App v9 (completa) | 77/100 | Re-auditoría post-refactor, hallazgos abiertos |
| App 360 v3 | 81/100 | F-02 (falso positivo)/F-23/F-26/F-27/F-28 resueltos en esta sesión, F-24 (SRI jsPDF/XLSX) pendiente por bloqueo de red |
| App 360 v4 | 81/100 | Todos los fixes aplicados: F-24 SRI verificado+funcional, fullscreen modal 100vh/100vw, licencia owner generada, modularización estable (223 tests pass) |

Reportes en `standalone/auditoria-*.html` (actualizado: `auditoria-360-v4.html`)

## FEATURES F1-F5 (v1.8.0)

| # | Feature | Dónde |
|---|---------|-------|
| F1 | Cantidad en la venta (N unidades) | `03-nueva-venta.js`, `db.js` |
| F2 | Recordatorios de cobro en el dashboard | `20-recordatorios.js` |
| F3 | Devoluciones y cambios | `22-devoluciones.js` |
| F4 | Compras al proveedor (reposición con costo) | `23-compras.js` |
| F5 | Señas y encargos (con lista de espera) | `24-reservas.js` |

**Invariantes que protegen los tests** (`tests/features.test.js`):
- La venta guarda TOTALES en `precioVenta`/`precioCompra`; el form trabaja por unidad. Las ventas viejas sin `cantidad` valen 1.
- Toda agregación sobre ventas usa `_ventasActivas()` (excluye devueltas). Un test falla si aparece un `this.ventas.filter(` en `02-render.js`.
- Toda lista `const stores = [...]` de `10-data-management.js` debe incluir los stores nuevos.
- Las migraciones de IndexedDB son aditivas: nunca `deleteObjectStore`.

## PENDIENTES / ROADMAP

### 7 días
- 12 ads Meta/IG (plan detallado existe en plans/)
- Testimonios reales con foto/nombre

### 30 días
- Regrabar el video demo (`demo.mp4`, 18,6 MB, del 07/07 — anterior a F1-F5). Se usa en la app y en la landing, las dos apuntan a `/demo.mp4`. HACERLO CUANDO LA APP ESTÉ PULIDA: grabarlo antes obliga a rehacerlo
- Review schema para testimonios
- A/B test headlines

### 90 días
- Landing localizada por país (AR/UY/CO/MX)
- Blog SEO long-tail
- Plan Pro (multi-perfil, backup auto, sync)

## HECHO RECIENTEMENTE (no en roadmap original)

- F1-F5 completas (ver tabla arriba) — v1.8.0
- Fix: recarga espuria del Service Worker en la primera visita de cada usuario
- Fix: `/version` devolvía 1.1.0 fijo, más viejo que la app — el chequeo de actualizaciones nunca disparaba
- Sondas de riesgo (`tests/riesgos.spec.js`): backup ida y vuelta campo por campo, nombres con HTML/emojis, montos del borde, la app con encriptación activa y la migración de una base v3. Las cinco pasan
- Fuzzer de invariantes: encontró que deshacer una devolución no recreaba las cuotas canceladas (la venta volvía a contar pero la deuda del cliente desaparecía)
- Alertas de stock: resumen colapsable (3 visibles + "Ver todos"). Con 14 perfumes agotados la lista tapaba el inventario entero
- Importador de Excel (`26-importar-excel.js`): lee .xlsx/.csv/.ods con SheetJS, detecta la fila de títulos (la primera suele ser el nombre del negocio), auto-detecta las columnas, deduce si la planilla usa día/mes o mes/día, entiende la columna de cuotas "1/3" (tres cuotas, una paga), deja corregir el mapeo y AGREGA (no reemplaza, a diferencia del restore de JSON). Las ventas importadas van sin `perfumeId` a propósito: son históricas y el stock de la planilla ya las tiene descontadas
- Pantalla de carga al arrancar (`#splash`): está en el HTML para pintarse antes que el JS, y se oculta en el `finally` de `init()` para no tapar la pantalla de error ni el lock de PIN
- Imagen OG 1200x630: se regenera con `npm run build:og` (Chromium rasteriza `scripts/og-image.html`). El PNG anterior tenía el titular superpuesto y la landing ni siquiera lo usaba
- E2E incorporados a CI: el deploy ahora espera `[test, e2e]`
- Suite E2E reparada (estaba rota por el modal de consentimiento, una espera de arranque que se cumplía siempre y la recarga del SW): 41/41 en 45s
- Refactor monolito `index.html` → módulos en `src/` con build script (`scripts/build.js`) — COMPLETADO
- `/version` estaba implementado y `build.js` le sincronizaba la versión, pero **nunca se ruteó en `worker.js`**: caía en `ASSETS.fetch()` y devolvía 404. Durante ~3 semanas la app no tuvo canal de actualización — ningún fix urgente podía llegar a quien ya la tenía instalada
- CSRF pasó a bloquear de verdad (`CSRF_ROUTES` en `worker.js` → 403 sin header). `/mp-create-preference` queda AFUERA a propósito: lo llama la landing, que no tiene token, y exigirlo ahí rompe el checkout. Al activarlo apareció una carrera: el token se derivaba con `crypto.subtle.digest` (async) y `_initCsrfToken` no se esperaba, así que tocar "activar licencia" al abrir la app mandaba el header vacío. Ahora es síncrono y `_getCsrfToken()` se cura solo
- Rate limits del router: fail-closed (503) en `CRITICAL_ROUTES`; el límite global sobre el resto sigue fail-open a propósito, para que una caída de KV no se lleve puesta la app entera
- **Dos pestañas inventaban inventario** (`tests/concurrencia.spec.js`): 20 ventas que decían haber descontado 20 unidades y el stock bajaba 13. Leer-modificar-escribir en dos transacciones distintas — `get()` y `put()` son transacciones separadas y no se pueden unir, porque con cifrado descifrar es async y eso cierra la transacción. Se serializó con **Web Locks** (`DB._conLockStock`), que cruza pestañas. ⚠️ `entregarReserva` NO toma el lock: llama a `addVenta`, que ya lo tiene, y Web Locks no es reentrante
- `fmt()` acotado a 2 decimales; aviso al crear un perfume que ya existe; aviso al reimportar una planilla ya cargada
- **Bug de z-index preexistente**: `.modal-overlay` tenía 200 para todos, así que un `appConfirm` disparado desde adentro de otro modal quedaba detrás y no se podía tocar. Borrar un perfume desde el modal de edición ya estaba roto en producción. `#modal-confirm` y `#modal-prompt` pasan a 300
- Prueba de volumen (`tests/volumen.spec.js`): siembra 2000 ventas / 1500 cuotas / 120 perfumes repartidas en 3 años y mide arranque en frío y cada pantalla, con y sin encriptación. La única pantalla fuera de rango era **cuotas (297 ms)**: `renderCuotas()` recalculaba el vencimiento más próximo dentro del comparador del `sort` y volcaba las cientos de tarjetas de una. Ahora precalcula y pagina de a 30 (`_CUOTAS_PAGINA`, `verMasCuotas()`, reset al reentrar) → **16 ms** y el DOM bajó de 22.040 a 6.532 nodos. El total adeudado sigue saliendo de TODAS las cuotas, no de las visibles. Subir el volumen con `VOL_VENTAS=5000`
- Tests automatizados: 621 Vitest + 106 E2E Playwright (incluye `tests/fuzz.spec.js`: secuencias aleatorias con semilla fija que verifican invariantes de stock, cuotas, devoluciones, compras y reservas — subir volumen con `FUZZ_CORRIDAS=30 FUZZ_OPS=120`) — **los dos corren en CI** y frenan el deploy
- DRY: `_renderVentaCard()` (dashboard + lista de ventas) y `_processPhoto()` (foto de stock + alta de perfume) compartidos
- Fullscreen demo modal: expandir video a 100vh/100vw, ocultar controles, mantener evento stopPropagation
- Auditoría 360° completa: 81/100 score, 30 findings analizados, remediation roadmap incluido
- Script automatizado para generar licencias propietarias en KV (owner license: PT-YINYD4-2ML61A7T)
- SRI verification: SHA-384 hashes en jsPDF 2.5.1 y XLSX 0.18.5 implementados y testeados
