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
| **Pro** | $19.99/mes | Multi-perfil, backup automático, sync multi-dispositivo | 🔵 Próximamente |

**Mercado:** revendedores de perfumes en LATAM — Argentina, Uruguay, Colombia, México.
**Headline:** *"Dejá de adivinar cuánto ganás"*

**La apuesta del producto:** el plan Free es genuinamente útil (ventas ilimitadas, ganancia
real, cuotas). Lo que se cobra es lo que necesita quien **ya creció**: estadísticas,
catálogo, exportaciones. Así el producto se gana la confianza antes de pedir plata.

---

## 2. Corto plazo — 7 días

| Ítem | Por qué |
|---|---|
| **12 ads Meta/IG** | Plan detallado en `plans/`. Es el canal de adquisición principal |
| **Testimonios reales con foto y nombre** | La objeción #1 de una app que maneja tu plata es la confianza |

**Técnico en paralelo** (de [TODO.md](TODO.md)):
- 🔴 T-01 — rutear `/version` (la actualización automática no funciona)
- 🟠 T-02 — arreglar el comentario obsoleto de `db.js`

---

## 3. Mediano plazo — 30 días

| Ítem | Por qué |
|---|---|
| **Video demo de 15-30 segundos** | "Registro en 10 segundos" se demuestra, no se afirma |
| **Schema de reviews** | SEO: que los testimonios salgan como rich snippets |
| **A/B test de headlines** | Validar "Dejá de adivinar cuánto ganás" contra alternativas |

**Técnico en paralelo:**
- 🟠 T-03 — política de fail-open/fail-closed en el router
- 🟠 T-04 — activar la validación de CSRF
- 🟠 C-01/C-02 — tests de concurrencia e interrupción
- 🟡 T-05/T-06 — decimales de `fmt()` y perfumes duplicados

---

## 4. Largo plazo — 90 días

### Producto
| Ítem | Por qué |
|---|---|
| **Landing localizada por país** (AR/UY/CO/MX) | Moneda, modismos y precios locales convierten mucho mejor |
| **Blog SEO long-tail** | "cómo calcular ganancia perfumes", "planilla ventas perfumes" — intención de compra alta |

### Plan Pro — la feature de ingresos
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

Además hay que resolver conflictos: dos dispositivos editando la misma venta offline. La
app hoy **ni siquiera tiene locking entre pestañas** (T-09), así que ese problema hay que
resolverlo antes o junto con el sync.

**Recomendación:** no empezar el sync hasta cerrar T-09.

---

## 5. Deuda técnica que condiciona el roadmap

| Deuda | Qué bloquea |
|---|---|
| 🔴 T-01 `/version` sin rutear | Que los usuarios reciban actualizaciones. **Bloquea cualquier fix urgente en campo** |
| 🟠 T-09 sin locking entre pestañas | El sync multi-dispositivo del plan Pro |
| 🟠 M-01 `loadData()` carga todo | Usuarios con historial muy grande (>5000 ventas) |
| 🟡 M-02 `02-render.js` de 831 líneas | Velocidad de desarrollo de features de UI |
| 🟡 T-06 perfumes duplicados | Calidad de las estadísticas y rankings |

**T-01 es el más urgente del proyecto.** No es solo una feature rota: significa que **no
hay forma de hacer llegar un fix urgente** a los usuarios que ya tienen la app instalada,
más allá de esperar a que el Service Worker actualice por su cuenta.

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
