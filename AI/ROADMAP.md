# ROADMAP — Plan de producto

**Contexto de negocio para que una IA entienda las prioridades.** Lo técnico está en
[TODO.md](TODO.md); acá va el porqué del producto.

**Estado:** v1.8.0 en producción · Free y Básico Pro activos · Plan Pro pendiente

---

## 1. Dónde está el producto hoy

| Plan | Precio | Incluye | Estado |
|---|---|---|---|
| **Free** | $0 siempre | Ventas ilimitadas, stock, ganancia real, cuotas, cobros por WhatsApp, offline | 🟢 Activo |
| **Básico Pro** | $9.99/mes · $7.99/mes anual | Todo Free + estadísticas, catálogo WA, ranking, PDF/Excel, push | 🟢 Activo |
| **Pro** | $19.99/mes | Multi-perfil, backup automático, sync multi-dispositivo | 🔴 **Sin una línea de código** |

**Mercado:** revendedores de perfumes en LATAM — Argentina, Uruguay, Colombia, México.
**Headline:** *"Dejá de adivinar cuánto ganás"*

**La apuesta del producto:** el plan Free es genuinamente útil (ventas ilimitadas, ganancia
real, cuotas). Lo que se cobra es lo que necesita quien **ya creció**: estadísticas,
catálogo, exportaciones. Así el producto se gana la confianza antes de pedir plata.

---

## 2. Corto plazo — 7 días

| Ítem | Por qué |
|---|---|
| **Captación manual (semana 1)** | 🔴 **Va ANTES de los ads.** Ver `MARKETING-SEMANA-1.md`: sin testimonios, 2 de los 12 ads no se pueden correr |
| **12 ads Meta/IG** | Material listo en `ADS-META-IG-BRIEF.md` (12 ads), `ADS-META-IG.json` (para importar), `DESIGN-BRIEF-12-ADS.md`, `_p_tiktok_ads.html` (guiones TikTok) y `plan-lanzamiento-30dias.html` — todos en la RAÍZ, no en `plans/`. Es el canal de adquisición principal |
| **Testimonios reales con foto y nombre** | La objeción #1 de una app que maneja tu plata es la confianza |

**Técnico en paralelo** (de [TODO.md](TODO.md)): nada bloqueante. La deuda técnica que
condicionaba el roadmap se cerró el 29/07 — `/version`, CSRF, fail-closed y el race de
stock entre pestañas.

---

## 3. Mediano plazo — 30 días

| Ítem | Por qué |
|---|---|
| **Regrabar el video demo** | El actual (`demo.mp4`, 18,6 MB, del 07/07) es anterior a F1-F5 y pesa demasiado para datos móviles. 🔴 **Hacerlo recién cuando la app esté pulida**: grabarlo antes obliga a rehacerlo. Ver [TODO.md](TODO.md) §P-01 |
| **Schema de reviews** | SEO: que los testimonios salgan como rich snippets |
| **A/B test de headlines** | Validar "Dejá de adivinar cuánto ganás" contra alternativas |

**Técnico en paralelo:**
- 🟠 M-01 — diferir los stores que no se usan en el arranque (medir primero)
- 🟡 M-02 — partir `02-render.js`, que es donde está casi todo el riesgo de regresión
- 🟡 T-07 / T-08 / T-11 — fullscreen del demo, `/force-update`, duplicados en reservas

---

## 4. Largo plazo — 90 días

### Producto
| Ítem | Por qué |
|---|---|
| **Landing localizada por país** (AR/UY/CO/MX) | Moneda, modismos y precios locales convierten mucho mejor |
| **Blog SEO long-tail** | "cómo calcular ganancia perfumes", "planilla ventas perfumes" — intención de compra alta |

### Plan Pro — la feature de ingresos

**Estado real: no existe.** Buscar `19.99` en `src/`, `functions/` y la landing da cero
resultados. Mercado Pago solo acepta `monthly` y `annual` (los dos precios de Básico Pro),
la UI tiene dos tarjetas y `isPro()` es `!!this._account?.license` — un booleano, no un
nivel. Hay un test que lo verifica para que nadie lo asuma a medio hacer.

| Ítem | Complejidad |
|---|---|
| **Multi-perfil** | Media — varios negocios en el mismo dispositivo |
| **Backup automático** | Baja — la infra de R2 ya existe |
| **Sync multi-dispositivo** | 🔴 **Alta** |

**🔴 El sync es la decisión más grande que le queda al proyecto.** Tensiona directamente
con [DECISIONS.md](DECISIONS.md) §D-03 ("los datos viven solo en el dispositivo").

Hacerlo bien implica **sync cifrado extremo a extremo**: el servidor guarda blobs que no
puede leer. Hacerlo mal —una base legible en el servidor— destruye la ventaja competitiva y
el argumento de privacidad que hoy diferencia al producto.

Además hay que resolver conflictos: dos dispositivos editando la misma venta offline.
El locking **entre pestañas** ya está resuelto (`DB._conLockStock` con Web Locks, 29/07),
pero eso no cubre dos dispositivos distintos: ahí hace falta versionado optimista o CRDTs.

**Recomendación:** diseñar la estrategia de conflictos ANTES de escribir el sync. Es la
parte difícil, no el transporte.

**Y antes que eso: no armar el plan Pro todavía.** Vender un tercer plan cuando el segundo
no tiene clientes es resolver un problema que no existe. Si hace falta más ingreso antes,
**backup automático** es lo barato: la infra de R2 ya está y se puede sumar a Básico Pro
sin resolver conflictos.

---

## 5. Deuda técnica que condiciona el roadmap

| Deuda | Qué bloquea |
|---|---|
| 🟠 Resolución de conflictos multi-dispositivo | El sync del plan Pro. **Es lo difícil, no el transporte** |
| 🟠 M-01 `loadData()` carga todo | Usuarios con historial muy grande (>5000 ventas) |
| 🟡 M-02 `02-render.js` de 831 líneas | Velocidad de desarrollo de features de UI |
| 🟡 P-01 video demo viejo | La conversión de la landing |

**Ya no hay deuda técnica que bloquee el crecimiento.** Lo que frena hoy es de producto:
nadie conoce la app. Ver §2.

---

## 6. Métricas que importan

| Métrica | Por qué |
|---|---|
| **Ventas registradas en la primera sesión** | Si no registra ninguna, no volvió |
| **Tiempo de la primera venta** | La promesa es 10 segundos. Ya hay instrumentación (UX-9) |
| **Retención a 7 días** | Un revendedor que vuelve a la semana adoptó la herramienta |
| **Conversión Free → Básico Pro** | El negocio |
| **Usuarios que importan desde Excel** | Señal de que traen historial real, no de que están probando |

**La métrica que destruiría el negocio:** pérdida de datos. Un solo usuario contando que la
app le borró el historial de ventas cuesta más que cualquier campaña. Por eso la inversión
desproporcionada en fuzzer, sondas de riesgo y tests de volumen no es sobre-ingeniería:
es defensa del activo principal.

---

## 7. Riesgos del producto

| Riesgo | Mitigación actual |
|---|---|
| 🔴 Pérdida de datos del usuario | `storage.persist()`, export JSON, backup R2, fuzzer, sondas |
| 🟠 Brevo caído ⇒ nadie se puede registrar | Ninguna. Sin proveedor de respaldo |
| 🟠 Mercado Pago caído ⇒ nadie puede pagar | Ninguna. Sin proveedor de respaldo |
| 🟠 Un competidor copia la propuesta | La ventaja es el enfoque en el nicho y la ejecución, no la tecnología |
| 🟡 Android sin conexión en el primer arranque | Inherente a Capacitor con `server.url` (D-18) |
| 🟡 Usuarios Free con datos en claro | Decisión consciente (D-04). Revisable |

---

## 8. Qué NO está en el roadmap (y por qué)

| Idea | Por qué no |
|---|---|
| App nativa real (no Capacitor) | Duplica el mantenimiento sin resolver un problema real |
| Backend con base de usuarios | Rompe D-03: la privacidad es ventaja competitiva |
| Marketplace / red social de revendedores | Otro producto. Dispersa el foco |
| Facturación electrónica | Regulación distinta por país. Complejidad enorme, mercado chico |
| Versión de escritorio | El usuario vive en el celular |

---

## 9. Principios de priorización

1. **Lo que evita pérdida de datos gana a todo lo demás.**
2. **Lo que reduce fricción en registrar una venta gana a agregar features** — es la acción
   que el usuario repite todos los días.
3. **Lo que se puede demostrar con material real gana a lo que hay que explicar**
   (screenshots reales, nunca mockups genéricos).
4. **Conversión sobre likes.**
5. **Una feature que no tiene test no está terminada.**
