# Plan de marketing — ParfumTrack

**Base:** continúa `MARKETING-SEMANA-1.md`, que es la Fase 0 de este plan.
**Punto de partida real:** producto terminado, 0 usuarios, 0 testimonios, $0 gastados.

---

## 1. La única métrica que decide todo

```
sale_created
```

Una venta cargada de verdad. **No** registros, **no** visitas, **no** seguidores.

Un registro que nunca cargó una venta no es un usuario: es un número que te hace sentir
bien y te hace tomar decisiones equivocadas. Alguien que cargó una venta ya metió sus datos
reales y va a volver.

Todo lo de abajo se decide mirando ese número y nada más.

### Lo que ya se puede medir (está instrumentado en Plausible)

| Evento | Qué contesta |
|---|---|
| `cta_*` (header, nav, footer, pricing, how) | ¿La landing convence? ¿Qué sección convierte? |
| `scroll_depth` | ¿Dónde abandonan la landing? |
| `sale_created` (trae `duracion`) | 🔴 **Activación.** Y si los 10 segundos son ciertos |
| `click_subscribe` / `pricing_cta` | Intención de pago |
| `mp_checkout_redirect` | Llegaron a pagar |

**Nada que hacer acá antes de arrancar.** Es raro tener el embudo medible desde el día 0;
aprovechalo.

---

## 2. El diagnóstico honesto

**Lo que está a favor:**

| | |
|---|---|
| El producto está terminado y probado | 637 + 137 tests, cero deuda bloqueante |
| No hay que descargar nada | Mata la fricción #1 de una app en LATAM |
| El plan Free es genuinamente útil | No es un trial de 7 días — se puede regalar sin mentir |
| Nicho definido y alcanzable | Los revendedores de perfumes viven en Instagram |
| Costo marginal ≈ 0 | Sin backend de datos: 1.000 usuarios Free no cuestan casi nada |

**Lo que está en contra:**

| | |
|---|---|
| 🔴 Cero prueba social | 2 de los 12 ads la necesitan y no se pueden correr |
| 🔴 Activación desconocida | Si de 10 registros 1 carga una venta, ningún ad lo arregla |
| 🟠 Nadie conoce la marca | Y es una app que maneja la plata de la gente: la confianza es todo |
| 🟠 Un solo fundador | El tiempo es el recurso escaso, no la plata |

**La conclusión que ordena el plan:** el cuello de botella hoy **no es alcance, es
confianza y activación**. Comprar alcance antes de resolver eso es pagar por descubrir que
tenés un balde con agujeros.

---

## 3. Fases con compuertas

**Regla de oro: no se pasa de fase sin cumplir la compuerta.** Si te salteás una, estás
comprando datos que no vas a poder interpretar.

### Fase 0 — Validar (semanas 1-2) · $0

Está detallada en **`MARKETING-SEMANA-1.md`**: grupos de Facebook + DMs de Instagram,
mensajes escritos, ritmo diario.

**Objetivo:** 20-30 usuarios que carguen una venta real.

> **🚪 Compuerta para pasar a Fase 1**
> - ≥ 20 usuarios con `sale_created`
> - ≥ 3 testimonios con nombre (foto si se puede)
> - Activación ≥ 40% de los que contactaste
> - Sabés de memoria las 3 objeciones que más se repitieron
>
> **Si la activación es < 40%: NO pases de fase.** Arreglá el onboarding. Esa es la
> señal más valiosa que vas a recibir en todo el plan y llega gratis.

### Fase 1 — Encontrar el mensaje (semanas 3-5) · $10-20/día

**Meta ads, 3 creatividades, no 12.** Del `ADS-META-IG-BRIEF.md`:

| Ad | Ángulo | Qué testea |
|---|---|---|
| **AD 1** | "Vendés, pero ¿ganás?" | El dolor |
| **AD 4** | "10 segundos" | La velocidad |
| **AD 8** | vs. Excel / cuaderno | El cambio de herramienta |

Ninguno necesita testimonios, y cada uno testea **una hipótesis distinta de
posicionamiento** — no tres versiones del mismo mensaje. Con 12 variantes a la vez testeás
creatividad; con estas 3 testeás **por qué te comprarían**, que es lo que todavía no sabés.

**Segmentación:** empezá por **un solo país**. Argentina o Uruguay (donde tenés red y
entendés los modismos). Un país por vez hace que los números signifiquen algo.

**Presupuesto total de la fase: ~$300.** Si a los $300 no tenés un ángulo claramente
mejor, el problema es el mensaje, no el presupuesto.

> **🚪 Compuerta para pasar a Fase 2**
> - Un ángulo con costo por `sale_created` **al menos 40% mejor** que los otros dos
> - Ese costo es sostenible: menor a lo que un usuario Free te va a valer
> - ≥ 50 usuarios activados en total

### Fase 2 — Escalar lo que funciona (semanas 6-10) · $30-50/día

- El ángulo ganador con **3-4 variantes visuales** (misma idea, distinta ejecución).
- **Sumar TikTok**: los ~20 guiones de `_p_tiktok_ads.html` ya están escritos, y el CPM en
  LATAM es más barato. Empezá con los 3 que coincidan con el ángulo ganador.
- **Recién acá** los ads 5 y 12 (prueba social) — ya tenés testimonios reales.
- Segundo país.

> **🚪 Compuerta para pasar a Fase 3**
> - ≥ 200 usuarios activados
> - Al menos **5 conversiones a Básico Pro** (o sea: alguien pagó de verdad)
> - Retención a 7 días medida

### Fase 3 — Ingresos (semanas 11-13)

Solo cuando hay volumen tiene sentido optimizar la conversión a pago:

- **A/B del headline** (`AD 1` vs. el ganador de Fase 1) en la landing.
- **Schema de reviews** para que los testimonios salgan como rich snippets.
- **Blog SEO long-tail**: "cómo calcular la ganancia de perfumes", "planilla de ventas de
  perfumes". Intención de compra altísima y competencia casi nula en español.
- Landing localizada por país (moneda, modismos).

---

## 4. Los canales, ordenados por lo que rinden acá

| # | Canal | Costo | Por qué en ese orden |
|---|---|---|---|
| 1 | **Grupos de Facebook** | $0 | La intención más alta que existe: gente que **ya se quejó** del problema |
| 2 | **DMs de Instagram** | $0 | Tus usuarios están ahí vendiendo. Directo, personal, y da testimonios |
| 3 | **Meta Ads (IG Reels + Feed)** | $$ | El motor de escala una vez que sabés el mensaje |
| 4 | **TikTok Ads** | $ | CPM barato en LATAM, guiones ya escritos. Después de Meta |
| 5 | **Google Search** | $ | Volumen bajo, intención altísima. Suma, no arranca |
| 6 | **Referidos de usuarios** | $0 | Los revendedores se conocen entre sí. Se activa solo cuando hay usuarios contentos |

**Lo que NO haría:** comprar seguidores, influencers grandes, ni contenido de marca sin
oferta. Nada de eso mueve `sale_created`.

---

## 5. Plata: cuánto y cuándo

| Fase | Diario | Total | Qué compra |
|---|---|---|---|
| 0 | $0 | **$0** | Testimonios, objeciones, tasa de activación |
| 1 | $10-20 | ~$300 | Saber **cuál es el mensaje** |
| 2 | $30-50 | ~$1.500 | Volumen con el mensaje ya validado |
| 3 | según CAC | variable | Optimizar el ingreso |

**Total hasta tener señal real: ~$300.** El brief original proponía $100-150/día por 21
días (~$3.000) para testear las 12 variantes de una. Ese presupuesto tiene sentido **después**
de la Fase 1, no antes: sin saber el mensaje, se gasta en aprender lo que la Fase 0 te dice
gratis.

**Regla de corte:** si en cualquier fase el costo por `sale_created` sube 3 semanas
seguidas, pará y volvé a la fase anterior. No subas el presupuesto para tapar un problema
de mensaje.

---

## 6. Lo que puede salir mal (y qué hacer)

| Riesgo | Señal temprana | Qué hacer |
|---|---|---|
| **Se registran y no cargan ventas** | Activación < 40% en Fase 0 | 🔴 Frená los ads. Arreglá el onboarding. Es el riesgo más grave |
| **Nadie paga** | 200 activados, 0 conversiones | El Free es demasiado bueno o el Pro no resuelve nada. Revisar el corte de features |
| **CAC más alto que el LTV** | Costo por venta > $10 | El ángulo está mal o el país está mal. Cambiá uno, no los dos |
| **Los grupos te banean** | Posteos borrados | Estabas vendiendo en vez de respondiendo. Ver `MARKETING-SEMANA-1.md` §2 |
| **Brevo o MP se caen** | Nadie se registra / nadie paga | Sin proveedor de respaldo. Riesgo conocido y aceptado |
| **Un competidor copia** | — | La ventaja es el nicho y la ejecución, no la tecnología. Acelerar, no defenderse |

**El que más miedo me daría:** que alguien cuente que la app le borró el historial de
ventas. Costaría más que cualquier campaña. Por eso el fuzzer, las sondas y las pruebas de
volumen están en CI — no es sobre-ingeniería, es defensa del activo.

---

## 7. Qué revisar y cada cuánto

**Todos los días (2 min):** `sale_created` de ayer. Nada más.

**Cada lunes (15 min):**

| Número | Se saca de |
|---|---|
| Usuarios nuevos activados | `sale_created` únicos |
| Costo por activación | gasto ÷ activados |
| Conversión landing → activación | `cta_*` → `sale_created` |
| Tiempo de carga de la primera venta | `duracion` en `sale_created` |
| Conversiones a Básico Pro | `mp_checkout_redirect` |

**Cada mes:** ¿se cumplió la compuerta de la fase? Si no, **no se avanza**. Repetir una
fase no es fracasar: avanzar sin la compuerta sí.

---

## 8. Material que ya existe

| Archivo | Qué tiene | Cuándo se usa |
|---|---|---|
| **`MARKETING-SEMANA-1.md`** | Grupos, mensajes escritos, ritmo diario | **Fase 0** |
| `ADS-META-IG-BRIEF.md` | 12 ads: headline, texto, CTA, specs | Fase 1 (3 de los 12) y Fase 2 (el resto) |
| `ADS-META-IG.json` | Los mismos, para importar | Fase 1 |
| `DESIGN-BRIEF-12-ADS.md` | Briefs de diseño de las piezas | Fase 1-2 |
| `_p_tiktok_ads.html` | ~20 guiones escena por escena | Fase 2 |

Todos en la **raíz** del repo.

---

## 9. Lo primero que hay que hacer

**Hoy no se gasta un peso.**

1. Abrí `MARKETING-SEMANA-1.md`.
2. Buscá y entrá a 5-8 grupos de Facebook (§1 tiene los términos y los criterios).
3. Mañana: leer los grupos y anotar 15-20 candidatos.
4. Pasado: arrancar con 5 comentarios + 10 DMs por día.

**En 7 días vas a saber tres cosas que hoy no sabés**, y las tres valen más que $3.000 de
ads: si la gente activa, por qué no lo hace, y qué te dirían de bueno tus primeros usuarios.
