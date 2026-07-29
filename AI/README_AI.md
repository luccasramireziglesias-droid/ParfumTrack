# README_AI — Base de conocimiento de ParfumTrack

Esta carpeta es la **fuente de contexto del proyecto**. Existe para que cualquier IA
(Claude Code, ChatGPT, Gemini, Cursor…) entienda ParfumTrack sin tener que releer las
~11.000 líneas de código fuente cada vez.

**Objetivo concreto:** que una sesión nueva llegue a "sé dónde tocar" leyendo ~600 líneas
de documentación en vez de escanear el repositorio entero.

---

## Qué es ParfumTrack

PWA de gestión de ventas para revendedores de perfumes en LATAM. Registro de ventas en
10 segundos, ganancia real automática, control de stock, cuotas, cobros por WhatsApp,
catálogo, estadísticas. Funciona offline. No se descarga de ninguna tienda.

**Headline:** *"Dejá de adivinar cuánto ganás"*

El resumen ejecutivo completo está en [AI_CONTEXT.md](AI_CONTEXT.md).

---

## Tecnologías

| Área | Tecnología |
|---|---|
| Frontend | HTML + CSS + JavaScript vanilla (sin framework, sin bundler) |
| Build | `scripts/build.js` — concatenación de texto de `src/` → `index.html` |
| Backend | Cloudflare Workers (`worker.js` + `functions/*.js`) |
| Datos locales | IndexedDB v5, cifrado AES-GCM cuando hay licencia |
| Datos servidor | Cloudflare KV (`PT_LICENSES`) + R2 (`parfumtrack-backups`) |
| Offline | Service Worker v16 |
| Pagos | Mercado Pago |
| Email | Brevo (Sendinblue) |
| Push | OneSignal |
| Analytics | Plausible (sin cookies, GDPR) |
| Tests | Vitest (unit) + Playwright (E2E) |
| CI/CD | GitHub Actions → deploy automático a Cloudflare en push a `main` |
| Android | Capacitor (`server.url` apuntando a la web) |

---

## Cómo usar esta documentación

### Flujo obligatorio al empezar cualquier tarea

```
1. AI_CONTEXT.md      — resumen ejecutivo (SIEMPRE primero)
2. PROJECT_MAP.md     — ubicar el archivo a tocar
3. MODULES.md         — SOLO la sección del módulo afectado
4. El código estrictamente necesario
```

No abras archivos "por las dudas". La documentación existe para evitarlo.

### Índice de archivos

| Archivo | Cuándo leerlo |
|---|---|
| [AI_CONTEXT.md](AI_CONTEXT.md) | **Siempre, primero.** Resumen ejecutivo. |
| [AI_RULES.md](AI_RULES.md) | **Siempre.** Reglas no negociables para IAs. |
| [PROJECT_MAP.md](PROJECT_MAP.md) | Para ubicar cualquier archivo o flujo. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Antes de un cambio estructural o de estado. |
| [MODULES.md](MODULES.md) | Antes de tocar un módulo de `src/app/`. |
| [COMPONENTS.md](COMPONENTS.md) | Al tocar pantallas, modales o UI. |
| [DATABASE.md](DATABASE.md) | Al tocar datos, stores o migraciones. |
| [SERVICES.md](SERVICES.md) | Al tocar backend o integraciones externas. |
| [ROUTES.md](ROUTES.md) | Al tocar navegación o endpoints. |
| [SECURITY.md](SECURITY.md) | Antes de tocar auth, cifrado, CORS o rate limiting. |
| [PERFORMANCE.md](PERFORMANCE.md) | Ante lentitud o listas grandes. |
| [BUG_HISTORY.md](BUG_HISTORY.md) | Ante un bug — puede que ya haya pasado. |
| [DECISIONS.md](DECISIONS.md) | Antes de proponer cambiar una decisión técnica. |
| [CHANGELOG_AI.md](CHANGELOG_AI.md) | Para saber qué cambió y por qué. |
| [TODO.md](TODO.md) | Para elegir en qué trabajar. |
| [KNOWLEDGE_GRAPH.md](KNOWLEDGE_GRAPH.md) | Para entender qué afecta a qué. |
| [CODE_STANDARDS.md](CODE_STANDARDS.md) | Antes de escribir código. |
| [TESTING.md](TESTING.md) | Antes de agregar o correr tests. |
| [ROADMAP.md](ROADMAP.md) | Para contexto de producto. |

---

## Convenciones de esta documentación

**Idioma.** Todo en español rioplatense, igual que el código y la comunicación con el
usuario. Los identificadores de código se citan textuales.

**Estado de la información.** Cada afirmación es una de tres cosas:
- **Verificada** — leída directamente del código. Es el default.
- **Marcada como no verificada** — se dice explícitamente. Ej.: los hallazgos que no se
  pudieron confirmar contra producción.
- **Nunca inventada.** Si un dato falta, esta documentación dice "no documentado" en vez
  de completarlo con una suposición.

**Código.** Se cita lo mínimo indispensable. Si necesitás el cuerpo de una función,
abrí el archivo — acá va la referencia `archivo:línea`, no el copy-paste.

**Números de línea.** Son orientativos y envejecen. El nombre de la función es la
referencia estable; la línea es una ayuda.

**Iconos de prioridad:** 🔴 crítico · 🟠 alto · 🟡 medio · 🟢 bajo

---

## Mantenimiento

Esta carpeta **se actualiza en el mismo commit que el cambio de código**, no después.
Una base de conocimiento desactualizada es peor que no tenerla: hace que la IA trabaje
con confianza sobre datos falsos.

Qué actualizar según el tipo de cambio: [AI_RULES.md](AI_RULES.md) §Mantenimiento
automático.

---

## Qué NO es esta carpeta

- **No es documentación de usuario final.** Es contexto técnico para IAs y desarrolladores.
- **No reemplaza a `CLAUDE.md`.** `CLAUDE.md` en la raíz tiene las reglas operativas del
  proyecto y se carga automáticamente en cada sesión de Claude Code. Esta carpeta es la
  referencia profunda que `CLAUDE.md` no puede contener sin volverse gigante.
- **No es un espejo del código.** Si algo se puede saber leyendo 5 líneas del fuente, acá
  va la referencia, no la copia.
