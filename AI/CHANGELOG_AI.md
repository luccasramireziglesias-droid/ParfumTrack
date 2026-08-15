# CHANGELOG_AI — Registro de cambios

Registro orientado a IAs: cada entrada dice **qué cambió, por qué, qué archivos y qué
riesgo introduce**. No es un changelog de usuario final.

**Formato:** fecha · versión · motivo · archivos · impacto · riesgo.

**Regla:** se actualiza **en el mismo commit** que el cambio. Ver [AI_RULES.md](AI_RULES.md).

---

## 2026-08-15 — Cuotas: el excedente del pago inicial (BUG-31) + tests que dependían del mes (BUG-32)

**Motivo.** Captura del dueño: una venta de $5.890 en 3 cuotas con $2.000 cobrados al vender
mostraba la cuota 2 como *"Pagó $37 de $1.963"* y el WhatsApp pedía **$1.926**.

**Lo primero que se hizo fue reproducirlo, no arreglarlo.** La aritmética **no estaba rota**:
los montos sumaban $5.890 exacto en las 8 combinaciones probadas. El defecto era **dónde caía
el excedente** — los $37 sobrantes del pago inicial se derramaban sobre la cuota siguiente.

**Decisión del dueño:** repartir lo que resta. El pago inicial **es** la cuota 1 y el saldo se
divide parejo entre las que siguen. El diálogo de cobro no cambia.

```
antes:  $1.963 (pago 1.963) + $1.963 (pago 37 → resta 1.926) + $1.964
ahora:  $2.000 (pagada)     + $1.945                         + $1.945
```

**🔴 Segundo bug encontrado de paso.** El cálculo de la última cuota
(`total − round(total/n) × (n−1)`) daba **negativo** con montos chicos y muchas cuotas:
13 en 8 daba `−1`. El reparto nuevo usa piso y distribuye el sobrante de a 1.

**Y el cálculo estaba copiado en dos lugares** (`_addVentaImpl` y `revertirDevolucion`):
arreglar uno solo habría hecho que deshacer una devolución recreara las cuotas con montos
distintos de los originales. Ahora hay una sola fuente y un test que lo cubre.

**BUG-32, aparte.** Tres tests de `import-dashboard.test.js` empezaron a fallar **solos** al
pasar el calendario de julio a agosto: el fixture tiene ventas de junio 2026 y el test hacía
`changeDashboardMonth(-1)` asumiendo que "hoy" era julio. No era una regresión, pero dejaba
CI en rojo y frenaba el deploy. Ahora calcula el desplazamiento contra `new Date()`.

**Archivos.** `src/db.js`, `src/app/03-nueva-venta.js`, `tests/cuotas-reparto.spec.js`
(nuevo, 6 tests), `tests/import-dashboard.test.js`, `AI/BUG_HISTORY.md`

**Riesgo.** 🟠 Medio — toca cómo se reparte plata. Mitigado: 624 combinaciones verificadas
suman exacto y ninguna da negativa; fuzzer a `FUZZ_CORRIDAS=30 FUZZ_OPS=120`; 721 Vitest +
143 E2E. **Las cuotas ya creadas no se tocan** — el cambio solo afecta a las ventas nuevas.

---

## 2026-07-31 (tarde) — El CTA de cierre se partía en móvil (BUG-30) + T-14 cerrado

**Motivo.** Captura del sitio **en producción** desde un Android: la flecha del botón
"Empezar ahora — es gratis →" caía sola a una segunda línea.

**✅ De paso, esa captura cerró T-14.** El título de la sección se veía en **Cormorant
Garamond**, o sea que los assets **sí se actualizan** en producción. La anomalía de los
tres `No files to upload` seguidos era una falsa alarma: wrangler no reporta el total del
manifiesto, nada más. BUG-27 queda cerrado.

**El bug.** El botón traía `style="font-size:17px;padding:18px 40px"` inline, y **un estilo
inline le gana a cualquier media query**. Ese botón —y solo ese— se saltaba la regla
`.btn-hero { padding:14px 24px; font-size:15px }` de `15-responsive.css`, que funcionaba
bien en todos los demás. A 360px (Android común) no entraba y partía la flecha.

**Fix.** El tamaño pasa a `.btn-cta-final`, y la media query lo lista explícito. Más
`es&nbsp;gratis&nbsp;→` para que la flecha nunca quede huérfana aunque cambie el copy.
Verificado a 320/360/390/412/768/1280: una línea en todos.

**El test no prohíbe estilos inline** — el toggle de precios los usa a propósito, los pisa
desde JS. Comprueba el invariante real: *lo que una media query redimensiona no puede tener
el tamaño puesto inline*. Lee las clases del bloque `@media` y verifica solo esas.

**Archivos.** `src/landing/sections/11-cta.html`, `src/landing/styles/13-cta-footer.css`,
`src/landing/styles/15-responsive.css`, `tests/landing-contenido.test.js` (+5),
`AI/{TODO,SECURITY,BUG_HISTORY}.md`

**Riesgo.** 🟢 Bajo. 721 Vitest pasan. **Verificado al revés:** devolviendo el inline y el
espacio normal, fallan 3 tests.

---

## 2026-07-31 — `/force-update` borraba datos (BUG-29) + limpieza de la landing

**Motivo.** Pedido: "qué más se puede mejorar" → "y la 7 cuál sería mejor".

**1. 🔴 `/force-update` (T-08, cerrado).** Devolvía `Clear-Site-Data: "cache", "storage"`.
`"storage"` no borra solo IndexedDB: **también localStorage**, o sea el historial completo
de ventas *más* el código de licencia, la sal del cifrado, el perfil y el PIN. Y la página
decía "Los caches fueron limpiados" y nada más. Como nada en la app enlaza a esa URL —se le
pasa a mano a quien escribe porque "no le carga"—, el borrado le caía a un usuario que ya
estaba con un problema, mientras lo ayudabas.

**La opción de "avisar antes" no existe:** `Clear-Site-Data` es una cabecera de respuesta,
el navegador la ejecuta al recibir la página. Cualquier aviso ahí es una autopsia. Por eso
se eligió sacar `"storage"` en vez de advertir. Lo único que ese valor aportaba
—desregistrar un SW envenenado— ahora se hace desde el cliente, sin tocar datos.
Ver [BUG_HISTORY.md](BUG_HISTORY.md) §BUG-29.

**2. Accesibilidad del checkout.** El `<label>` "Tu email" no tenía `for`, así que no
quedaba asociado al input: un lector de pantalla anunciaba sin nombre el único formulario
de la landing, el que cobra. Sumado `aria-describedby`, `role="alert"` en el error e
`inputmode="email"`.

**3. CSS muerto.** 20 reglas borradas de 219 (quedan 199). Casi todas eran mockups
(`.cat-grid`, `.wa-bubble`, `.stat-row-mock`, `.feature-mockup-header`) que se reemplazaron
por capturas reales: se fue el HTML y quedó el CSS. Se verificó clase por clase antes de
borrar — `.feature-mockup` y `.hero-screenshot-wrap` sí se usan y quedaron.
`10-testimonials.css` **no se borró** aunque no se usa: el hueco está diseñado esperando
testimonios reales, y ahora tiene un comentario que lo explica.

**4. `sw.js` ya no cachea Google Fonts.** Código muerto desde que las fuentes son locales, y
la CSP (`font-src 'self'`) lo bloquearía igual.

**5. Doc.** El bloque de CSP de SECURITY.md estaba desactualizado (decía `img-src ... https:`
y Google Fonts en `style-src`). Sincronizado con `_headers`.

**Archivos.** `worker.js`, `sw.js`, `src/landing/sections/13-modals.html`,
`src/landing/styles/{03-hero,07-feature-catalog,09-comparison,10-testimonials}.css`,
`tests/worker.test.js` (+5), `tests/landing-contenido.test.js` (+7), `AI/{TODO,SECURITY,BUG_HISTORY}.md`

**Riesgo.** 🟢 Bajo. 703 Vitest + 137 E2E pasan. **Verificado al revés:** devolviendo
`"storage"` y la rama de Google Fonts fallan 2 tests.

---

## 2026-07-30 — Landing: prueba social inventada, 18 MB de video y tipografía fuera de marca

**Motivo.** Pedido: "podés chequear la landing" → "mejorala a lo mejor que veas teniendo en
cuenta todo".

**1. 🔴 Prueba social inventada.** El hero decía *"+340 revendedores en LATAM ya organizan su
negocio con Parfum Track"* y la barra de stats repetía *"+340"*, con el producto en **0
usuarios**. Publicidad engañosa (regulada en los cuatro mercados objetivo) y además pelea
con la propia estrategia, que es conseguir a los primeros y pedirles testimonios reales.
Reemplazado por *"Nuevo lanzamiento · Sé de los primeros"* y por
*"Tus datos · Solo en tu celular"*. Ver [DECISIONS.md](DECISIONS.md) §D-28.

**2. 🟠 18 MB de video en cada visita.** La primera carga móvil pesaba **18,07 MB**, de los
cuales **17,79 MB era `demo.mp4`** — el 98% — bajado aunque el video viva en un modal que
nadie abrió. Con `preload="none"` + arrancar la reproducción en el click de "Ver demo":
**18,07 MB → 0,28 MB**. En el mismo lugar apareció que cerrar el modal **no pausaba el
video**: el audio seguía sonando. Ver [BUG_HISTORY.md](BUG_HISTORY.md) §BUG-28.

**3. 🟡 Tipografía fuera de marca.** La landing usaba Cormorant Garamond en **un** elemento
contra 18 en la app: el h1 y todos los títulos iban en DM Sans. Ahora los cinco selectores
de título usan la serif, con peso ≤700, tamaño ~15% mayor y sin tracking negativo (las tres
trampas de cambiar de palo seco a serif). Ver §D-29.

**Lo que estaba bien y no se tocó.** Precios correctos ($9.99/$7.99/$95.88, sin rastro del
Pro de $19.99), el plan Pro solo mencionado como "(próximamente)", 8 CTAs consistentes a
`/index.html`, las 7 imágenes con `alt`, sin scroll horizontal a 1280 ni a 390, cero errores
de consola. **Y ninguna referencia de la landing quedó excluida por el fix de assets de
BUG-27** — se verificó archivo por archivo.

**Archivos.** `src/landing/sections/02-hero.html`, `03-demo.html`, `14-scripts.html`,
`src/landing/styles/03-hero.css`, `04-demo.css`, `05-sections-common.css`,
`07-feature-catalog.css`, `13-cta-footer.css`, `landing.html` (generado),
`tests/landing-contenido.test.js` (nuevo, 18 tests), `AI/DECISIONS.md`, `AI/BUG_HISTORY.md`

**Riesgo.** 🟢 Bajo. No toca la app ni el backend. 686 Vitest + 137 E2E pasan.
**Verificado al revés:** revirtiendo los tres cambios fallan 5 tests.

---

## 2026-07-30 — 🔴 Todo el repo estaba público en el dominio (BUG-27)

**Motivo.** Pedido: "haceme un html con el plan". Al buscar dónde ponerlo para que **no**
quedara público apareció el hallazgo.

**Lo que estaba pasando.** `assets.directory` es `.` (la raíz del repo), así que wrangler
sube todo lo que no esté excluido. Y **`assets.exclude` no es un campo válido de
wrangler.** Nunca excluyó nada. Wrangler lo venía avisando en cada deploy:

```
▲ [WARNING] Processing wrangler.jsonc configuration:
    - Unexpected fields found in assets field: "exclude"
```

Confirmado en el log del deploy de producción del 30/07 (run 30536826819) y contra
`node_modules/wrangler/config-schema.json`, donde `assets` solo acepta `binding`,
`directory`, `html_handling` y `not_found_handling`. El único mecanismo real es
`.assetsignore`, que existía pero solo cubría `node_modules/`, `functions/`, `scripts/`,
`standalone/`, `inservible/`, `worker.js` y `wrangler.jsonc`.

**Qué quedaba accesible sin autenticación** (340 archivos, simulando la lógica de wrangler):

| Qué | Por qué importa |
|---|---|
| `AI/` (20 archivos) | 🔴 **Documenta hallazgos de seguridad ABIERTOS.** `TODO.md`, `SECURITY.md` y `BUG_HISTORY.md` son un mapa para un atacante |
| 14 `auditoria-*.html`, `AUDIT_LEGAL.html`, `COBERTURA_LEGAL.html` | Hallazgos abiertos con severidad y scores |
| `tests/` (52) | Describen los vectores de ataque y los invariantes que protegen |
| `CLAUDE.md` | Arquitectura, nombres de los secrets, detalles de KV |
| `MARKETING-*`, `ADS-*`, `PLANES_*`, `MASTER_CREATIVE_BRIEF*` | Estrategia, presupuesto y ángulos de campaña completos |
| `wrangler.staging.jsonc`, `test-payment-flow.mjs` | Config de staging y lógica de pagos |
| `src/` (103), `android/` (52), `PLAYSTORE/` (20) | Menos grave: `index.html` ya es público y es el mismo código |

**No hay forma de saber si alguien lo leyó**: los assets no dejan logs de acceso.

**Fix.** Las exclusiones pasaron a `.assetsignore` (el mecanismo que sí funciona) y se
**borró** `assets.exclude` de los dos wrangler configs: dejarlo ahí es peor que no tenerlo,
porque parece protección. Se eligió lista negra y no `*` + negaciones porque la lista negra
ya está probada funcionando en este archivo, y un default-deny mal interpretado por el
walker de wrangler tumba el sitio entero.

**Lo que evita que vuelva a pasar.** `tests/assets-publicos.test.js` (31 tests):
reimplementa la lógica exacta de wrangler (`createAssetIgnoreFunction` → paquete `ignore`,
fijado en `7.0.6`) y exige que **todo** archivo que se subiría esté en una lista blanca
derivada de las referencias reales de `index.html`, `landing.html`, `manifest.json` y
`STATIC_ASSETS` de `sw.js`. Con el `.assetsignore` viejo **fallan 20 de los 31** — se
verificó revirtiéndolo. Un documento interno nuevo en la raíz ahora frena el deploy en vez
de quedar público.

**Qué más se agregó.** `standalone/marketing-plan.html` — el plan renderizado con la paleta
dark/gold, imprimible. Las fuentes de marca van **embebidas en base64** (subset latin de
`cormorant-garamond-latin.woff2` y `dm-sans-latin.woff2`): la primera versión pedía Google
Fonts, que contradice la regla de fuentes locales, no anda sin internet y filtra la IP de
quien lo abre. El archivo no tiene **ninguna** referencia externa (verificado renderizándolo:
consola limpia, sin scroll horizontal a 900px ni a 390px).

**Archivos.** `.assetsignore`, `wrangler.jsonc`, `wrangler.staging.jsonc`,
`tests/assets-publicos.test.js` (nuevo), `package.json` (dep `ignore`),
`standalone/marketing-plan.html` (nuevo), `AI/BUG_HISTORY.md`, `AI/SECURITY.md`

**Riesgo.** 🟢 Bajo en el código: no toca rutas de la app ni del Worker, 668 tests pasan y
el build no cambia `index.html`. ⚠️ **Verificar en el próximo deploy** que el log ya no
avisa de `exclude` y que la cantidad de assets baja de ~340 a ~40.

---

## 2026-07-29 — Plan de marketing con compuertas

**Motivo.** Pedido: "hay que hacer un plan de marketing". Se indicó tomar como base solo
`MARKETING-SEMANA-1.md` (el material más reciente), dejando de lado
`plan-lanzamiento-30dias.html`.

**Qué se agregó.** `MARKETING-PLAN.md`: cuatro fases, cada una con una **compuerta** que hay
que cumplir para avanzar. La idea central es que no es un calendario de tácticas sino una
secuencia de decisiones.

**Las dos definiciones que ordenan el plan:**

1. **`sale_created` es la única métrica que decide.** No registros, no visitas, no
   seguidores: un registro que nunca cargó una venta no es un usuario, es un número que hace
   tomar decisiones equivocadas.
2. **El cuello de botella hoy no es alcance, es confianza y activación.** Comprar alcance
   antes de resolver eso es pagar por descubrir que el balde tiene agujeros.

**La compuerta más importante:** si en la Fase 0 la activación es < 40%, **no se pasa a los
ads**. Esa señal llega gratis en una semana y ningún presupuesto la arregla.

**Plata.** ~$300 hasta tener señal real, contra los ~$3.000 que propone
`ADS-META-IG-BRIEF.md` para testear las 12 variantes de una. Ese presupuesto tiene sentido
**después** de saber el mensaje.

**Archivos.** `MARKETING-PLAN.md` (nuevo), `AI/ROADMAP.md`, `AI/TODO.md`

**Riesgo.** Ninguno — no toca código.

---

## 2026-07-29 — 🔴 XSS por inyección en atributos: tres vías, una raíz

**Motivo.** Pedido explícito de revisar seguridad.

**Lo que se encontró.** Tres vectores que permitían **ejecutar JavaScript** en el origen de
la app, con acceso a ventas, clientes, código de licencia y token CSRF:

| Vector | Cómo llega |
|---|---|
| Nombre de perfume | Tipeado **o importado de un Excel** que te manden |
| Foto de perfume | Backup JSON restaurado |
| Logo del negocio | Backup JSON restaurado |

**Se verificaron explotables antes del fix**, ejecutando `window.__XSS = true` por los tres
caminos. No eran hallazgos teóricos.

**Causa raíz única.** `esc()` usa `textContent` → `innerHTML`: escapa `& < >` pero **no las
comillas**. Estaba usado dentro de atributos, donde una comilla cierra el atributo e inyecta
uno nuevo. Y las imágenes se validaban **solo por prefijo** (`^data:image/`), así que
`data:image/png,x" onerror="…` pasaba entero.

**Cuatro capas de fix.** `escAttr()` para atributos · `esImagenSegura()`/`imgSrc()` que
valida la cadena completa y excluye SVG · `_sanearImportado()` que limpia el backup **al
entrar a la base** · CSP sin `https:` en `img-src`, que era el canal de exfiltración.

**Bug encontrado dentro del propio fix.** El primer intento usaba `encodeURIComponent` para
el `onclick` del cliente — **no escapa el apóstrofo**, así que "O'Brien" seguía rompiendo el
string. Lo detectó el test porque estaba escrito con el nombre real.

**Verificado al revés:** volviendo la validación a solo-prefijo, **7 tests fallan**.

**Archivos.** `11-utils.js`, `02-render.js`, `04-stock.js`, `10-data-management.js`,
`18-clientes.js`, `20-recordatorios.js`, `03-nueva-venta.js`, `26-importar-excel.js`,
`27-negocio.js`, `_headers`, `tests/xss.spec.js` (12 tests) + 8 regresiones estáticas

**Riesgo.** 🟠 La CSP se acotó: si alguien suma OneSignal o Google Fonts más adelante, va a
chocar contra la CSP. Es el modo de falla correcto — explícito, no silencioso.

**Total.** 629 → **637 Vitest**, 125 → **137 E2E**.

---

## 2026-07-29 — El catálogo mandaba solo texto sin que se notara

**Motivo.** El usuario reportó con captura que "envía un msj pero no la imagen".

**No era un bug: eran dos botones y el obvio era el equivocado.** El de abajo, con el verde
de WhatsApp y a todo el ancho, mandaba **solo texto**. Las imágenes estaban detrás de otro
botón que **solo aparecía después** de apretar "Vista previa" (`display:none` hasta
entonces). El camino que manda imágenes era invisible.

**Restricción de fondo.** Un link `wa.me` **no puede llevar archivos** — WhatsApp solo
acepta texto por URL. Las imágenes exigen `navigator.share({ files })`, que abre el menú
del sistema. Los dos caminos no se pueden unir, así que hay que explicarlo en la UI.

**Qué cambió.**
- Los dos botones **siempre visibles**, y cada uno dice qué hace: "Enviar con imágenes (N)"
  y "Enviar solo el listado en texto".
- Nota abajo explicando por qué son dos: *"WhatsApp no deja mandar imágenes desde un link"*.
- `_catalogoMensaje()` extraído: el texto se arma **una vez** y ahora viaja como
  **epígrafe de la imagen**. Antes la imagen iba sin precios ni contacto.
- Si el navegador acepta archivos pero rechaza la combinación con texto, manda la imagen
  igual en vez de fallar.
- `enviarCatalogo()` genera las imágenes si hacen falta. Antes `if (length === 0) return`
  salía en silencio.

**Archivos.** `src/app/10-data-management.js`, `src/screens/catalogo.html`,
`tests/negocio.spec.js` (6 tests), `tests/features.test.js` (5 regresiones)

**Riesgo.** 🟢 El comportamiento de texto no cambia; el de imágenes suma el epígrafe.

**Total.** 624 → **629 Vitest**, 119 → **125 E2E**.

---

## 2026-07-29 — Plan de captación manual + corrección de una ruta que se repitió toda la sesión

**Motivo.** Pregunta del dueño: dónde correr los ads y qué recomiendo.

**Lo que se encontró.** El material de ads ya estaba escrito y completo:
`ADS-META-IG-BRIEF.md` (12 ads), `ADS-META-IG.json`, `DESIGN-BRIEF-12-ADS.md`,
`_p_tiktok_ads.html` (~20 guiones) y `plan-lanzamiento-30dias.html`.

**🔴 Corrección de documentación.** `CLAUDE.md`, `AI/ROADMAP.md` y `AI/TODO.md` decían que
el plan estaba en `plans/`, **una carpeta que no existe** — los archivos están en la raíz.
Se repitió esa ruta varias veces en la sesión antes de verificarla.

**Lo que se agregó.** `MARKETING-SEMANA-1.md`: captación manual a $0 antes de gastar en
ads. El razonamiento:

- Dos de los 12 ads (`AD 5` social proof, `AD 12` objection handler) **necesitan
  testimonios** que hoy no existen: correrlos sería mentir.
- El brief propone $100-150/día × 21 días (~$3.000) para testear 12 variantes. Distinguir
  12 variantes necesita ~100 conversiones cada una: se gastaría el presupuesto aprendiendo
  qué creatividad gana **antes** de saber si el embudo convierte.
- No hay tasa de activación medida. Si de 10 registros solo 1 carga una venta, el problema
  no es el ad.

**Recomendación registrada.** Semana 1 gratis (grupos de Facebook + DMs de Instagram) para
conseguir testimonios, objeciones reales y la tasa de activación. Después **3 ads a
$10-20/día**, no 12 a $100-150: AD 1 (dolor), AD 4 (velocidad), AD 8 (vs. Excel) — los tres
que no necesitan testimonios y que testean **posicionamiento** en vez de creatividad.

**Nota de honestidad.** El documento **no lista grupos concretos de Facebook**: no se puede
verificar desde el entorno de desarrollo. Da términos de búsqueda y criterios de selección,
y lo dice explícitamente en el propio archivo.

**Dato bueno que salió del chequeo.** El embudo ya está instrumentado en Plausible:
`cta_*` → `sale_created` (con `duracion`) → `click_subscribe` → `mp_checkout_redirect`.
Se puede medir activación real desde el día uno.

**Archivos.** `MARKETING-SEMANA-1.md` (nuevo), `CLAUDE.md`, `AI/ROADMAP.md`, `AI/TODO.md`

**Riesgo.** Ninguno — no toca código.

---

## 2026-07-29 — El plan pago se llama igual en todos lados

**Motivo.** Con la licencia activa, la pantalla decía **"Plan Pro"** arriba y el badge
"Plan actual" estaba sobre **"Básico Pro"** abajo. Los dos salen del mismo `isPro()`, pero
para alguien que está por pagar parece que ya tiene un plan llamado "Pro" y que
"Básico Pro" es otra cosa.

**Qué cambió.** El título ahora dice "Básico Pro", igual que la tarjeta. El estado en
"Más" pasa de "Pro activo" a "Básico Pro activo".

**Lo que se aclaró de paso.** El plan **Pro de $19.99 no existe en el código**: cero
resultados buscando `19.99`, Mercado Pago solo acepta los dos precios de Básico Pro, y
`isPro()` es un booleano. Estaba en la documentación como "PRÓXIMAMENTE", que se leía como
"a medio hacer". Ahora dice **SIN CÓDIGO** y hay un test que falla si alguien lo agrega a
medias.

**Archivos.** `src/app/12-cuenta-licencia.js`, `CLAUDE.md`, `AI/ROADMAP.md`,
`tests/negocio.spec.js` (3 tests), `tests/features.test.js` (3 regresiones)

**Riesgo.** 🟢 Solo texto de UI.

**Total.** 621 → **624 Vitest**, 116 → **119 E2E**.

---

## 2026-07-29 — El perfil del negocio deja de asumir Uruguay

**Motivo.** El usuario señaló tres cosas de la primera versión: el nombre caía en
"Parfum Track" por defecto, el placeholder del teléfono era un número uruguayo y el de
ciudad decía "Montevideo". La app se usa en AR/UY/CO/MX.

**Qué cambió.**
- El teléfono ahora tiene **selector de código de país** (18 países) y no se puede guardar
  un número sin él: en el catálogo lo lee gente de otro país.
- Placeholders genéricos en todos los campos.
- "DOCUMENTO (RUT / CUIT)" → **"DOCUMENTO FISCAL"** con RFC y NIT en el ejemplo: el mismo
  problema que los otros dos, en un campo que el usuario no mencionó.
- El catálogo y el PDF sin nombre cargado ya no salen con **"Parfum Track"** sino
  "Mi negocio": encabezar el catálogo del usuario con la marca de la app le dice a su
  cliente que el negocio se llama así.

**Además, quitar duplicados.** El input suelto de "Mi negocio" en la pantalla `mas` pasó a
ser una fila que navega al perfil — dos inputs escribiendo `pt_negocio` se desincronizan.
La **moneda** se movió al perfil por la misma razón: es una decisión del negocio.

**Archivos.** `src/app/27-negocio.js`, `src/screens/cuenta.html`, `src/screens/mas.html`,
`src/styles/27-negocio.css`, `src/styles/15-mas.css`, `src/app/11-utils.js`,
`src/app/10-data-management.js`, `tests/negocio.spec.js`, `tests/header.spec.js`

**Riesgo.** 🟢 `_telefonoCompleto()` respeta los perfiles viejos que guardaban todo junto.

**Total.** 621 Vitest, 106 → **116 E2E**.

---

## 2026-07-29 — Perfil del negocio con logo

**Motivo.** El usuario mandó como referencia la pantalla "Editar negocio" de otra app y
pidió poder cargar ese tipo de datos más una foto de perfil con el logo.

**Qué se hizo.** Módulo nuevo `27-negocio.js` + card en la pantalla de cuenta: nombre, tipo,
teléfono, email, dirección, ciudad, documento y logo.

**La decisión que define la feature:** cada campo tiene un lugar donde **sale**. El nombre y
el logo van al header; el contacto al pie del catálogo de WhatsApp y al encabezado del PDF.
Un formulario que junta datos que nadie lee es ruido (ver [DECISIONS.md](DECISIONS.md) §D-25).

**Almacenamiento.** Store `config` (entra en el backup) + `pt_negocio` en localStorage
porque el header lo lee antes de que abra IndexedDB (§D-24).

**Nota de diseño.** La captura de referencia era de una app con tema claro y header
amarillo. Se tomaron los **campos**, no el diseño: la card sigue la paleta dark del proyecto.

**Archivos.** `src/app/27-negocio.js`, `src/screens/cuenta.html`, `src/styles/27-negocio.css`,
`src/app/00-core.js`, `src/app/10-data-management.js`, `src/app/12-cuenta-licencia.js`,
`tests/negocio.spec.js` (12 tests) + 11 regresiones estáticas

**Riesgo.** 🟡 `config` no está cifrado; el perfil incluye dirección y documento. Se aceptó
porque son datos que el usuario **elige publicar** en el catálogo y los PDF. Documentado.

**Total.** 610 → **621 Vitest**, 94 → **106 E2E**.

---

## 2026-07-29 — Dos incidentes de producción, misma raíz

**Contexto.** El usuario reportó con capturas dos fallas seguidas al activar su licencia.

### BUG-24 — 503 en las 5 rutas críticas 🔥

Introducido ese mismo día al volver fail-closed el limitador de concurrencia. La causa de
fondo era vieja: KV rechaza `expirationTtl < 60` y el limitador usaba 5, así que el `put()`
fallaba en **todas** las requests desde siempre — tapado por un `catch`.

Registro, activación de licencia y pagos caídos hasta el hotfix.

### BUG-25 — El OTP nunca se pudo verificar

El cliente descartaba el `challenge` que devuelve `/trial` y no lo mandaba al verificar. El
registro por email nunca funcionó desde que se agregó el nonce.

### La raíz común

**Los dos pasaron los tests porque los tests no reproducían la realidad:** un mock de KV que
aceptaba cualquier TTL, y 24 tests de backend contra un cliente ideal que no existía.

Las 597 pruebas en verde daban una confianza que no correspondía.

**Qué se agregó.** Un mock de KV que valida como el real, un test que recorre todos los
`put()` del router, y 7 regresiones que verifican el **contrato** cliente/servidor del OTP.
Los dos se verificaron al revés: revirtiendo el fix, el test falla.

**Deuda que dejaron.** T-12 (auditar los `catch` silenciosos) y T-13 (tests de contrato
para el resto de los endpoints).

**Archivos.** `worker.js`, `functions/_shared.js`, `src/app/12-cuenta-licencia.js`,
`tests/worker.test.js`, `tests/features.test.js`

**Total.** 597 → **610 Vitest**, 94 E2E.

---

## 2026-07-29 — Header: el nombre del negocio ya no tapa el chip de cuenta

**Motivo.** El usuario mandó capturas: con el nombre "VIPPARFUMSmgdsssdjhffghhhff…" el chip
de "Free" quedaba fuera del viewport. Ese chip es la única puerta a la licencia y a los
backups desde el dashboard.

**Causa.** `.logo-group` sin `min-width: 0`: un item de flex no se encoge por debajo del
ancho de su contenido, así que empujaba al hermano en vez de truncarse.

**Solución.** `flex: 1; min-width: 0` en el grupo, ellipsis en el texto, `flex-shrink: 0`
en las acciones. Más `_NOMBRE_NEGOCIO_MAX = 30` aplicado al escribir **y al cargar**
(`maxlength` no cubre lo que setea el código), y el nombre completo en el `title`.

**Archivos.** `src/styles/02-header.css`, `src/app/11-utils.js`, `src/screens/mas.html`,
`tests/header.spec.js` (7 tests)

**Riesgo.** 🟢 Solo layout del header, que usa una sola pantalla (`inicio`).
Verificado con captura: el nombre se corta con "…" y el chip entra entero.

**Total.** 592 → **597 Vitest**, 87 → **94 E2E**.

---

## 2026-07-29 (tarde) — Cerrar los 4 bloques de deuda de TODO.md

Cuatro tandas seguidas, cada una con su commit.

### 1. `/version` ruteado

**Motivo.** El endpoint existía y `build.js` le sincronizaba la versión, pero `worker.js`
no lo importaba ni lo listaba en `GET_ROUTES`: caía en `ASSETS.fetch()` y devolvía 404.
El efecto real no era perder una feature — era **no tener canal para hacer llegar un fix
urgente** a quien ya tiene la app instalada.

**Archivos.** `functions/version.js` (pasó de `export default { fetch }` a `onRequestGet`),
`worker.js`, `tests/worker.test.js`, `tests/features.test.js`

**Riesgo.** 🟢 Queda sin rate limit propio a propósito y comentado: lo pollea cada cliente
cada 5 min, un contador en KV costaría más que la respuesta.

### 2. CSRF bloqueando + fail-closed

**Motivo.** La infraestructura estaba desde julio pero el router no frenaba nada
(*"not blocking requests yet"*). Y los rate limits del router hacían fail-open.

**Qué cambió.** `CSRF_ROUTES` = `/trial`, `/validate-license`, `/backup`, `/sync` → 403 sin
header. Rutas críticas → 503 si KV falla.

**🔴 Lo que casi rompe.** `/mp-create-preference` lo llama la **landing**, que no tiene
token. Exigirlo ahí rompía el checkout. Quedó afuera y comentado.

**Carrera que apareció al activarlo.** `_generateCsrfToken` usaba `crypto.subtle.digest`
(async) y `_initCsrfToken` no se esperaba: tocar "activar licencia" apenas abría la app
mandaba el header vacío. Con el backend rechazando, eso era un 403 en la cara del usuario.
Ahora es síncrono y `_getCsrfToken()` se cura solo.

**Archivos.** `worker.js`, `src/app/00-core.js`, `src/db.js` (comentario obsoleto)

### 3. Tests de concurrencia → encontraron un bug real 🐛⭐

**Motivo.** C-01 y C-02 eran los dos huecos de cobertura que quedaban.

**Lo que encontró.** Con dos pestañas vendiendo en paralelo: 20 ventas que decían haber
descontado 20 unidades y el stock bajando **13**. Siete unidades de inventario inventadas.
Leer-modificar-escribir en dos transacciones distintas.

**Solución.** `DB._conLockStock()` con **Web Locks**, que cruza pestañas. Envuelve las 7
operaciones que tocan stock. `entregarReserva` queda afuera: llama a `addVenta` y Web Locks
no es reentrante.

**Archivos.** `src/db.js`, `tests/concurrencia.spec.js` (7 tests)

**Riesgo.** 🟠 Los 7 métodos pasaron a ser wrappers sobre un `_xImpl`. Las regresiones
estáticas que indexaban por `'async addVenta'` hubo que apuntarlas al `Impl`.

### 4. Montos, duplicados y reimportación

- `fmt()` acotado a 2 decimales (`toLocaleString` sin opciones llegaba a 3).
- Aviso al crear un perfume que ya existe, ignorando mayúsculas, tildes y espacios.
- Aviso al reimportar una planilla ya cargada, comparando por día y no por timestamp.

**🐛 Bug que apareció haciéndolo.** `.modal-overlay` tenía `z-index: 200` para todos, así
que un `appConfirm` disparado desde adentro de otro modal quedaba **detrás** y no se podía
tocar. **Borrar un perfume desde el modal de edición ya estaba roto en producción** por
eso. `#modal-confirm` y `#modal-prompt` pasan a 300.

**Archivos.** `src/app/11-utils.js`, `src/app/04-stock.js`, `src/app/26-importar-excel.js`,
`src/styles/17-modal.css`, `tests/pulido.spec.js` (8 tests)

**Total de la sesión.** 560 → **592 Vitest**, 72 → **87 E2E**. Todo en verde.

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

**Deuda que dejó** (cerrada el 29/07): el comentario de `db.js:331` siguió diciendo que
las cuotas no se recrean hasta que se corrigió.

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
