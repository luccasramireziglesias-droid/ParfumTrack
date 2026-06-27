# PARFUMTRACK — PROJECT MASTER MEMORY v1.0 (22/06/2026)

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

- **Frontend:** HTML+CSS+JS vanilla (monolito `index.html` ~19.5K líneas). Sin framework, sin build step.
- **Backend:** 10 Cloudflare Worker functions (`worker.js` como router)
- **Storage:** KV namespace `PT_LICENSES` (trial, rate limit, licencias), R2 bucket `parfumtrack-backups`
- **Datos usuario:** IndexedDB/localStorage (local, NO en servidores)
- **CDN lazy-load:** Chart.js 4.4.0, jsPDF 2.5.1, XLSX 0.18.5 (con SRI hashes)
- **Service Worker:** v8 (`sw.js`)
- **CI/CD:** GitHub Actions → auto-deploy on push to main

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
├── index.html              ← App principal monolítica (19,479 líneas)
├── landing.html            ← Landing page de marketing (2,218 líneas)
├── worker.js               ← Router entry point Workers (66 líneas)
├── sw.js                   ← Service Worker v7 (110 líneas)
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
- SRI hashes para CDN resources

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

Reportes en `standalone/auditoria-*.html`

## PENDIENTES / ROADMAP

### 7 días
- Imagen OG profesional 1200x630 para sharing en redes (LP-M02)
- 12 ads Meta/IG (plan detallado existe en plans/)
- Verificar SRI hashes en producción
- Testimonios reales con foto/nombre

### 30 días
- Video demo 15-30 segundos
- Tests automatizados (Vitest + Miniflare)
- Review schema para testimonios
- A/B test headlines

### 90 días
- Refactor monolito index.html → módulos
- Landing localizada por país (AR/UY/CO/MX)
- Blog SEO long-tail
- Plan Pro (multi-perfil, backup auto, sync)
