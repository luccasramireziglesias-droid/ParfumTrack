# PARFUMTRACK — PROJECT MASTER MEMORY v1.1 (30/06/2026)

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
- **Backend:** 10 Cloudflare Worker functions (`worker.js` como router)
- **Storage:** KV namespace `PT_LICENSES` (trial, rate limit, licencias), R2 bucket `parfumtrack-backups`
- **Datos usuario:** IndexedDB/localStorage (local, NO en servidores)
- **CDN lazy-load:** Chart.js 4.4.0, jsPDF 2.5.1, XLSX 0.18.5 (SRI sha384 implementado en `_loadScript()` — F-24 resuelto)
- **Service Worker:** v14 (`sw.js`), precachea `STATIC_ASSETS` en `install`
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

## PENDIENTES / ROADMAP

### 7 días
- Imagen OG profesional 1200x630 para sharing en redes (LP-M02)
- 12 ads Meta/IG (plan detallado existe en plans/)
- Testimonios reales con foto/nombre

### 30 días
- Video demo 15-30 segundos
- Review schema para testimonios
- A/B test headlines

### 90 días
- Landing localizada por país (AR/UY/CO/MX)
- Blog SEO long-tail
- Plan Pro (multi-perfil, backup auto, sync)

## HECHO RECIENTEMENTE (no en roadmap original)

- Refactor monolito `index.html` → módulos en `src/` con build script (`scripts/build.js`) — COMPLETADO
- Tests automatizados: 223 tests Vitest (antes 218), corren en CI antes del deploy
- DRY: `_renderVentaCard()` (dashboard + lista de ventas) y `_processPhoto()` (foto de stock + alta de perfume) compartidos
- Fullscreen demo modal: expandir video a 100vh/100vw, ocultar controles, mantener evento stopPropagation
- Auditoría 360° completa: 81/100 score, 30 findings analizados, remediation roadmap incluido
- Script automatizado para generar licencias propietarias en KV (owner license: PT-YINYD4-2ML61A7T)
- SRI verification: SHA-384 hashes en jsPDF 2.5.1 y XLSX 0.18.5 implementados y testeados
