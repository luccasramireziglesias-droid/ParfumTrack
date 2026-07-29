# SECURITY — Seguridad de ParfumTrack

**Última auditoría 360°:** score 81/100 · 30 hallazgos analizados.
Reportes en `standalone/auditoria-*.html`.

---

## 1. Modelo de amenaza

| Activo | Dónde | Riesgo real |
|---|---|---|
| Historial de ventas del usuario | Su dispositivo (IndexedDB) | Pérdida total si el navegador desaloja el storage |
| Códigos de licencia | KV + localStorage del usuario | Piratería, licencias compartidas |
| Backups | R2 | Fuga si se filtra el HMAC secret |
| Credenciales de pago | Nunca tocan la app — viven en Mercado Pago | — |
| Secrets del backend | Cloudflare Dashboard | Compromiso total del backend |

**Lo que hace ParfumTrack estructuralmente más seguro que su competencia:** los datos del
negocio del usuario **nunca llegan al servidor en texto plano**. No hay una base de datos
central que filtrar. El backup a R2 va cifrado del lado del cliente.

**Lo que lo hace más frágil:** si el usuario pierde el dispositivo sin backup, no hay
recuperación posible. No es un bug — es la contracara de la decisión de privacidad.

---

## 2. Validaciones — cliente

### XSS
| Defensa | Dónde |
|---|---|
| `esc()` obligatorio para datos del usuario en `innerHTML` | `11-utils.js:80` |
| **Ningún dato de usuario dentro de un `onclick=""`** | Delegación en `_initEventDelegation()` |
| Mensajes de WhatsApp en base64 UTF-8-safe | `b64Encode`/`b64Decode` |
| Ids de cuota como JSON percent-encoded | `data-cuota-id` |

Hay una sonda de riesgo (`tests/riesgos.spec.js`) que carga nombres con
`<script>window.__hackeado`, `onerror=` y emojis, y verifica que no se ejecute nada.

### Validación de entrada
| Regla | Dónde |
|---|---|
| `precioVenta > 0` | `06-ventas-edit-delete.js` |
| `0 ≤ descuento ≤ 100` | `06-ventas-edit-delete.js` |
| `1 ≤ numCuotas ≤ 12` | `06-ventas-edit-delete.js` + `db.js` |
| Stock nunca negativo | `db.js` (`Math.min` / `Math.max(0, …)`) |
| Sobrepago de cuota rechazado | `db.js pagarCuota` lanza error |
| Seña ≤ total de la reserva | `db.js addReserva` |
| Formato de licencia `PT-[A-Z0-9-]{6,}` | `00-core.js:_checkPendingLicense` |
| Backups normalizados y validados | `_normalizeBackupData()` + `_assertRestorable()` |

### Doble-tap
`App._once(key, fn, btnEl)` envuelve todo guardado async. Sin eso, un doble toque en
"Guardar" registraba la venta dos veces. Hay tests que verifican la guarda en el pago de
cuotas.

---

## 3. Cifrado en reposo

- **Algoritmo:** AES-GCM 256 bits · **Derivación:** PBKDF2 · **Versionado:** campo `_v`
- **Alcance:** los 8 stores de negocio. `config` queda en claro (preferencias).
- **Activación:** solo si existe `localStorage.pt_license_code`.
- **Master key:** protegida por el PIN del usuario (`16-key-management.js`).
- **PIN:** guardado como hash SHA-256, nunca en claro.

**🔴 Regla estructural:** el `id` del registro va **fuera** del payload cifrado. Sin eso
`put()` duplicaba registros. `dedupEncryptedRecords()` sana las bases afectadas.

**Verificación real, no asumida:** la sonda de riesgo abre IndexedDB en crudo y comprueba
que `crudo[0]._encrypted` exista y que **el nombre del cliente no esté legible en disco**.

---

## 4. Seguridad del backend

### Headers (`_headers`)

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=(), fullscreen=(self)
Cross-Origin-Opener-Policy: same-origin-allow-popups
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload   ← 2 años + preload
X-Permitted-Cross-Domain-Policies: none
```

**CSP:**
```
default-src 'self'
script-src  'self' 'unsafe-inline' cdn.onesignal.com cdnjs.cloudflare.com plausible.io
style-src   'self' 'unsafe-inline' fonts.googleapis.com
connect-src 'self' + onesignal + plausible + el worker propio
img-src     'self' data: blob: https:
frame-ancestors 'none'   ·   object-src 'none'   ·   base-uri 'self'   ·   form-action 'self'
```

**🟠 `'unsafe-inline'` en `script-src` es inevitable con esta arquitectura** — toda la app
es un `<script>` inline. Es el costo consciente de la decisión de un solo archivo.
La mitigación real es `esc()` + delegación de eventos.

### Rate limiting

| Capa | Dónde | Límite | Comportamiento si KV falla |
|---|---|---|---|
| Tamaño de request | `worker.js` | 5 MB → 413 | — |
| Global por IP | `worker.js` | 1000/min → 429 | ✅ **fail-CLOSED en rutas críticas** (503), fail-open en el resto |
| Concurrencia en rutas críticas | `worker.js` | 10 simultáneas → 429 | ✅ **fail-CLOSED** (503) |
| Por endpoint | `_shared.js` | Configurable | ✅ **fail-CLOSED** |
| Burst | `_shared.js` | 5 en 5 s | ✅ fail-closed |
| Adaptativo | `_shared.js` | Según historial | ✅ fail-closed |
| Cuerpo JSON | `_shared.js` | 1 MB | ✅ |

**Asimetría deliberada.** Las rutas de `CRITICAL_ROUTES` cortan con 503 si KV falla. El
límite global sobre el resto sigue fail-open **a propósito**: hacerlo fail-closed
convertiría cualquier caída de KV en una caída total de la app. Está comentado en el código
para que no se lea como un descuido.

### CORS
Whitelist única `ORIGIN_RE` en `_shared.js:3`. Origen no permitido → `null`.
Nunca se usa `*`.

### Autenticación
| Mecanismo | Dónde |
|---|---|
| **ECDSA** — validación de licencias | `validate-license.js` |
| **HMAC-SHA256** — backup y sync | `backup.js`, `sync.js` |
| **OTP 6 dígitos** (TTL 10 min) — registro | `trial.js` |
| **Firma X-Signature de MP** — webhook | `mp-webhook.js` |
| `timingSafeEqual()` — comparación de tokens | `_shared.js:230` |
| `verifyTokenWithExpiry()` — TTL 900 s | `_shared.js:258` |

### CSRF — activo

**Lo que existe:**
- Token generado en el cliente (`crypto.getRandomValues`, 32 bytes en hex) y guardado en
  `pt_csrf_token`, con rotación disponible.
- Header `X-CSRF-Token` aceptado en CORS.
- Cookies `SameSite=Strict; Secure; HttpOnly`.
- `validateDoubleSubmitCSRF()` y `validateCsrfToken()` implementadas en `_shared.js`.

**Qué bloquea.** `worker.js` define `CSRF_ROUTES` y devuelve **403** sin un
`X-CSRF-Token` bien formado en: `/trial`, `/validate-license`, `/backup` POST y `/sync` POST.

**Por qué el header alcanza.** Solo lo puede mandar un contexto que pasó el preflight de
CORS y que pudo leer el token de `localStorage`. Un form cross-origin no llega.

**🔴 `/mp-create-preference` queda AFUERA a propósito.** Lo llama la **landing**, que es una
página estática sin token. Exigirlo ahí rompe el checkout, que es el camino de conversión
principal. Está comentado en `worker.js` para que nadie lo "complete" sin darse cuenta.
La protección perdida es acotada: lo peor que puede lograr un atacante es que alguien
genere una preferencia de pago a su propio nombre.

**El token se genera de forma síncrona.** Antes se derivaba con `crypto.subtle.digest`
(async) y `_initCsrfToken()` no se esperaba: si el usuario tocaba "activar licencia" apenas
abría la app, el header salía vacío. Con el backend rechazando, esa carrera era un 403 en
la cara del usuario. Ahora son 32 bytes al azar en hex — los mismos 64 chars que valida el
server — y `_getCsrfToken()` se cura solo si falta o quedó mal formado.

### Logging
`log()` pasa por `sanitizeData()` antes de escribir. Las IPs se hashean con `hashIp()`.
**Nunca loguear secrets, tokens ni PII en claro.**

---

## 5. SRI

Las dos librerías cargadas desde CDN llevan `integrity` sha384 + `crossOrigin`
(`_loadScript()` en `10-data-management.js:268`):

| Librería | Hash |
|---|---|
| jsPDF 2.5.1 | `sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk` |
| XLSX 0.18.5 | `sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw` |

Verificado y funcional (hallazgo F-24 cerrado). `tests/f24-sri-verification.test.js` lo protege.

**🔴 Si actualizás una de estas versiones, tenés que recalcular el hash.** Con el hash
viejo el script no carga y las exportaciones dejan de funcionar en silencio.

---

## 6. Privacidad y cumplimiento

| Aspecto | Estado |
|---|---|
| Datos del usuario | 🟢 Solo en su dispositivo. No hay base central |
| Analytics | 🟢 Plausible, sin cookies, GDPR compliant |
| Consentimiento | 🟢 Modal bloqueante antes de usar la app |
| `List-Unsubscribe` | 🟢 Obligatorio en todos los emails transaccionales |
| Términos y privacidad | 🟢 `terminos.html`, `privacidad.html` v2.0 |
| Entidad legal | 🟢 "Parfum Track" — sin nombres personales en documentos legales |
| Derecho al olvido | 🟢 `clearData()` borra todo localmente |
| Portabilidad | 🟢 Export JSON completo |

---

## 7. Hallazgos abiertos

| # | Severidad | Hallazgo |
|---|---|---|
| T-08 | 🟡 Baja | `/force-update` borra IndexedDB (`Clear-Site-Data: storage`) sin advertencia |
| T-10 | 🟡 Baja | `'unsafe-inline'` en CSP (inherente a la arquitectura) |

**Cerrados en 07/2026:** T-01 (`/version` ruteado), T-03 (fail-closed en rutas críticas),
T-04 (CSRF bloqueando), T-09 (race de stock entre pestañas → Web Locks).

Detalle y prioridad en [TODO.md](TODO.md).

---

## 8. Reglas al tocar seguridad

1. 🔴 **Rate limiting fail-closed** en todo endpoint nuevo. Usá `checkRateLimit()`.
2. 🔴 **`corsHeaders()` siempre.** Nunca `Access-Control-Allow-Origin: *`.
3. 🔴 **`esc()` en todo dato de usuario** que entre a `innerHTML`.
4. 🔴 **Nunca datos de usuario en `onclick=""`.** Usá `data-*` + delegación.
5. 🔴 **Nunca loguear secrets ni PII.** Usá `log()`, que sanitiza.
6. 🔴 **Los secrets viven en el Dashboard de Cloudflare**, jamás en el repo.
7. 🔴 **`List-Unsubscribe` en todos los emails.**
8. 🟠 Al cambiar una librería de CDN, recalculá el SRI.
9. 🟠 Al tocar `15-encryption.js`, escribí primero el test de ida y vuelta: podés volver
   ilegibles los datos de usuarios reales.
10. 🟠 Usá `timingSafeEqual()` para comparar cualquier token o secreto.
