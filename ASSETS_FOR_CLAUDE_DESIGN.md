# ASSETS COMPLETOS PARA CLAUDE DESIGN
## 7 Videos Promocionales - ParfumTrack

**Fecha:** Julio 5, 2026  
**Proyecto:** ParfumTrack LATAM Campaign  
**Entregables:** 7 videos (60s, 45s, 40s, 45s, 90s, 60s, 30s)  

---

## 1. PALETA DE COLORES OFICIAL

### Colores Primarios (Copiar exactamente)

```
BACKGROUNDS:
├─ Dark Primary:       #0f0f1a  (RGB: 15, 15, 26)
├─ Dark Secondary:     #1a1a2e  (RGB: 26, 26, 46)
├─ Dark Tertiary:      #13131f  (RGB: 19, 19, 31)
├─ Card Default:       #1b1b30  (RGB: 27, 27, 48)
└─ Card Elevated:      #1d1d36  (RGB: 29, 29, 54)

ACCENTS:
├─ Gold Primary:       #c9a84c  (RGB: 201, 168, 76)
├─ Gold Secondary:     #e8c97e  (RGB: 232, 201, 126)
├─ Gold Tertiary:      #f5dfa0  (RGB: 245, 223, 160)
├─ Success Green:      #70c9a0  (RGB: 112, 201, 160)
├─ Alert Red:          #e07070  (RGB: 224, 112, 112)
└─ Warning Warm:       #e0b060  (RGB: 224, 176, 96)

TEXT:
├─ Primary:            #f0ece4  (RGB: 240, 236, 228)
├─ Secondary:          #b8b5d0  (RGB: 184, 181, 208)
├─ Tertiary:           #9a97c0  (RGB: 154, 151, 192)
└─ Quaternary:         #7a7798  (RGB: 122, 119, 152)
```

### Gradientes Listos

```css
/* Gold Gradient (primario para botones, highlights) */
linear-gradient(135deg, #c9a84c, #e8c97e)

/* Dark Gradient (para cards, backgrounds) */
linear-gradient(135deg, #1d1d36, #181a2d)

/* Success Pulse (para validaciones) */
#70c9a0 con opacity 0.3
```

---

## 2. TIPOGRAFÍA

### Fuentes (Google Fonts)

**Cormorant Garamond** (Títulos)
- Weights: 600 Bold, 700 Extra Bold
- Uso: Números grandes (ganancias, ventas), headlines
- Carácter: Elegancia, lujo, confianza
- Import: `https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&display=swap`

**DM Sans** (Body)
- Weights: 400 Regular, 500 Medium, 600 Semi-bold, 700 Bold
- Uso: Párrafos, botones, labels, UI
- Carácter: Moderno, legible, neutral
- Import: `https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap`

### Tamaños Recomendados

```
HEADLINES:
├─ H1 (Main):         48-56px, Cormorant 700, line-height 1.05
├─ H2 (Section):      36-40px, Cormorant 700, line-height 1.1
├─ H3 (Feature):      20-24px, Cormorant 600, line-height 1.15
└─ Numbers Big:       36-48px, Cormorant 700 (para ganancias, ventas)

BODY:
├─ Large:             16-18px, DM Sans 500, line-height 1.6
├─ Normal:            14-16px, DM Sans 400, line-height 1.6
├─ Small:             12-14px, DM Sans 400, line-height 1.5
├─ Label:             11-13px, DM Sans 500, uppercase, letter-spacing 0.06em
└─ CTA Button:        14-16px, DM Sans 700
```

---

## 3. DATOS REALES DE LA APP

### Dashboard (Pantalla Principal)

```json
{
  "mes": "Junio 2026",
  "ganancia_total": 9671,
  "cantidad_ventas": 13,
  "dinero_por_cobrar": 2600,
  "ultimas_ventas": [
    {
      "perfume": "Yara EDT",
      "precio_venta": 4400,
      "precio_compra": 2500,
      "ganancia": 1900,
      "cliente": "María G.",
      "vendedor": "#13"
    },
    {
      "perfume": "Black Opium",
      "precio_venta": 3800,
      "precio_compra": 1900,
      "ganancia": 1900,
      "cliente": "Juan P.",
      "vendedor": "#12"
    },
    {
      "perfume": "J'adore",
      "precio_venta": 3200,
      "precio_compra": 1600,
      "ganancia": 1600,
      "cliente": "Ana M.",
      "vendedor": "#11"
    }
  ]
}
```

### Stock (Inventario)

```json
{
  "perfumes": [
    {
      "nombre": "Yara EDT",
      "stock_actual": 3,
      "precio_compra": 2500,
      "alerta_bajo": true,
      "vendidas": 15
    },
    {
      "nombre": "Black Opium",
      "stock_actual": 8,
      "precio_compra": 1900,
      "alerta_bajo": false,
      "vendidas": 12
    },
    {
      "nombre": "J'adore",
      "stock_actual": 5,
      "precio_compra": 1600,
      "alerta_bajo": false,
      "vendidas": 10
    },
    {
      "nombre": "Sauvage",
      "stock_actual": 0,
      "precio_compra": 2800,
      "alerta_bajo": true,
      "vendidas": 20
    }
  ]
}
```

### Cuotas y Cobros

```json
{
  "cuotas_pendientes": [
    {
      "cliente": "Cliente 1",
      "monto": 5000,
      "vencimiento": "2026-07-10",
      "dias_vencido": 0,
      "status": "vencido"
    },
    {
      "cliente": "Cliente 2",
      "monto": 2600,
      "vencimiento": "2026-07-15",
      "dias_para_vencer": 10,
      "status": "por_cobrar"
    }
  ],
  "total_por_cobrar": 7600
}
```

### Estadísticas (Gráficos)

```json
{
  "ganancias_por_mes": {
    "enero": 1200,
    "febrero": 1800,
    "marzo": 2500,
    "abril": 3200,
    "mayo": 5400,
    "junio": 9671
  },
  "perfumes_mas_vendidos": [
    {"nombre": "Yara EDT", "ventas": 15, "ganancia": 28500},
    {"nombre": "Black Opium", "ventas": 12, "ganancia": 22800},
    {"nombre": "Sauvage", "ventas": 20, "ganancia": 56000}
  ],
  "clientes_top": [
    {"nombre": "María G.", "ventas": 8, "total_gastado": 15000},
    {"nombre": "Juan P.", "ventas": 5, "total_gastado": 12000}
  ]
}
```

### Evolución 6 Meses (Para Video 5: Transformación)

```
MES 1: Ganancia $1.200, Ventas 8, Estado: Caótico
MES 2: Ganancia $1.800, Ventas 11, Estado: Implementó ParfumTrack
MES 3: Ganancia $2.500, Ventas 14, Estado: Primeros resultados
MES 4: Ganancia $3.200, Ventas 16, Estado: Escalada
MES 5: Ganancia $5.400, Ventas 22, Estado: Momentum
MES 6: Ganancia $9.671, Ventas 31, Estado: 3x crecimiento
```

---

## 4. SCREENSHOTS DE LA APP

### Archivo 1: Dashboard
**Ubicación:** `/home/user/ParfumTrack/img/sc-dashboard.png`
**Tamaño:** 1440x2560px  
**Contenido:**
- Ganancia total del mes: $9.671
- Últimas ventas listadas
- Cards de estadísticas
- Bottom navigation visible

### Archivo 2: Cuotas
**Ubicación:** `/home/user/ParfumTrack/img/sc-cuotas.png`
**Tamaño:** 1440x2560px  
**Contenido:**
- Cuotas pendientes
- Vencimientos destacados
- Botón WhatsApp para recordatorios
- Status de cobro

### Archivo 3: Ventas Empty
**Ubicación:** `/home/user/ParfumTrack/img/sc-ventas-empty.png`
**Tamaño:** 1440x2560px  
**Contenido:**
- Pantalla vacía (para contraste before/after)
- Estados de confusión visual

### Archivo 4: WhatsApp Integration
**Ubicación:** `/home/user/ParfumTrack/img/whatsapp-cobro.jpg`
**Tamaño:** Variable  
**Contenido:**
- Screenshot real de cobro por WhatsApp
- Recordatorio automático
- Formato profesional

### Archivo 5: OG Image (Para referencia de estilo)
**Ubicación:** `/home/user/ParfumTrack/og-image.png`
**Tamaño:** 1200x630px  
**Contenido:**
- Ejemplo de composición visual
- Paleta de colores en acción
- Tipografía aplicada

---

## 5. ANIMACIONES Y MOVIMIENTO

### Timing Rules

```
Fast reactions:       150ms    (hover, state changes)
Normal transitions:   200-250ms (screen changes)
Entrance reveals:     300-500ms (storytelling reveals)
Slow cinematic:       600-800ms (hero moments)
```

### Easing Functions

```css
/* Normal transitions */
cubic-bezier(0.4, 0, 0.2, 1)

/* Smooth slow reveals */
cubic-bezier(0.25, 0.46, 0.45, 0.94)

/* Quick exits */
cubic-bezier(0.4, 0, 1, 1)
```

### Animaciones Específicas

1. **Counter Animation:** Números que cuentan (0 → valor final)
   - Ejemplo: $0 → $9.671
   - Duración: 2-3 segundos
   - Easing: ease-out

2. **Scale & Fade:** Elementos que entran con zoom suave
   - Scale: 0.9 → 1.0
   - Opacity: 0 → 1
   - Duración: 300-400ms

3. **Glow Effect:** Cards con brillo dorado sutil
   - Box-shadow: 0 0 20px rgba(201,168,76,0.2)
   - Animación: pulse suave (opcional)

4. **Icon Fill:** Material Symbols que se rellenan (FILL: 0 → 1)
   - Duración: 300ms
   - Uso: Validaciones, checkmarks

5. **Stagger Reveal:** Elementos en cascada
   - Delay entre items: 100-150ms
   - Efecto: Despliegue natural

---

## 6. ESTRUCTURA DE VIDEOS

### Video 1: PRODUCTO COMPLETO (60 segundos)

**Actos:**
- [0-5s] **HOOK:** "¿Cuánto ganaste hoy?" (incertidumbre)
- [5-25s] **ANTES/DESPUÉS:** Caos (izq) vs Claridad (der)
- [25-45s] **DEMO:** Dashboard, nueva venta (10s), cuota automática
- [45-55s] **BENEFICIO:** Transformación emocional + 3 personas
- [55-60s] **CTA:** Logo + "Empezar gratis"

**Visuals:** Dashboard real, phone mockup, split screens, números grandes

---

### Video 2: EL PROBLEMA (45 segundos)

**Actos:**
- [0-3s] **HOOK:** "¿CUÁNTO GANASTE HOY?" (incómodo)
- [3-10s] **CAOS:** Montaje rápido (cuaderno, calculadora, WhatsApp, confusión)
- [10-25s] **IMPACTO:** Números que muestran pérdida ($10k venta → $3.5k ganancia → ??? pérdido)
- [25-35s] **ESCALADA:** 4 vendedores, 4 pain points (stock, cobros, cálculos, estrés)
- [35-42s] **ESPERANZA:** "¿Y si supieras en 10 segundos?" + logo
- [42-45s] **CTA:** "Empezar gratis"

**Visuals:** Ambiente real (ferias, calles), rostros reales, números rojos, transiciones rápidas

---

### Video 3: CONTROL DE STOCK (40 segundos)

**Estructura:** Before/After minimalista
- [0-3s] **HOOK:** "OUT OF STOCK" (cliente desaparece)
- [3-15s] **ANTES:** Confusión, app genérica, no hay respuestas
- [15-30s] **DESPUÉS:** ParfumTrack, lista clara, números grandes, alertas de bajo stock
- [30-38s] **BENEFICIO:** Montaje: cliente llega → app muestra stock → venta exitosa → cliente sonríe
- [38-40s] **CTA:** Logo + button

**Visuals:** Phone screens, números pulsantes, alertas en rojo/verde, checkmarks

---

### Video 4: VENTAS, CLIENTES Y GANANCIAS (45 segundos)

**Estructura:** Dashboard tour + Automatización
- [0-5s] **HOOK:** Phone en mano, "Tu ganancia del mes"
- [5-20s] **DASHBOARD TOUR:** Card ganancia ($9.671 contador), ventas (13), por cobrar ($2.6k)
- [20-30s] **AUTOMATIZACIÓN:** Venta registrada → App calcula → Ganancia visible (repetir 3x)
- [30-40s] **BENEFICIO:** Vendedor sonriendo, 3 personas usando, "Control total"
- [40-45s] **CTA:** Logo + button

**Visuals:** App full screen, números animados, transiciones suaves, elegancia

---

### Video 5: TRANSFORMACIÓN 6 MESES (90 segundos)

**Estructura:** Journey progresivo
- [0-10s] **MES 1:** Caótico, pequeño, $1.2k
- [10-25s] **IMPLEMENTACIÓN:** Descarga app, setup, primeras ventas
- [25-45s] **MESES 2-3:** Gráfico subiendo ($1.8k → $2.5k), momentum
- [45-70s] **MESES 4-6:** Escalada fuerte ($3.2k → $5.4k → $9.671), múltiples vendedores, dinero contado
- [70-85s] **RESULTADO:** Vendedor en mejores ropas, quote: "Crecí 3 veces. No es suerte. Son datos."
- [85-90s] **CTA:** Logo + button

**Visuals:** Gráficos lineales ascendentes, números crecientes, personas sonriendo, evolución visual

---

### Video 6: EMOCIONAL (60 segundos)

**Estructura:** Vulnerable → Transformación → Paz
- [0-10s] **VULNERABLE:** Vendedor en cama de noche, "¿Ganaste dinero hoy?" (incertidumbre)
- [10-30s] **PESO:** Montaje anotaciones, clientes dudosos, dormir sin respuesta
  - VO (opcional): "Cuando no sabés cuánto ganás, todo pesa más"
- [30-50s] **TRANSFORMACIÓN:** Mismo vendedor, mañana siguiente, abre app, sonríe, duerme en paz
  - VO: "Cuando sabés cuánto ganás, todo cambia. Confianza. Certeza. Paz."
- [50-55s] **VALIDACIÓN:** 3-4 personas usando, sonriendo, "Miles de revendedores ganaron esa paz"
- [55-60s] **CTA:** Logo + "Dejá de adivinar"

**Visuals:** Atmósfera intensa, luz baja → luz alta, rostros genuinos, esperanza

---

### Video 7: PUBLICIDAD SOCIAL (30 segundos)

**Estructura:** Hook brutal + Speed showcase + CTA
- [0-3s] **HOOK:** Split screen: cuaderno (rojo) vs app (oro), "¿O esto?"
- [3-8s] **SPEED:** 3 demostraciones rápidas (venta 1s, ganancia 1s, cobro 1s)
- [8-15s] **BENEFIT SLAM:** Números que aparecen, $0 confusión → $3.5k ganancia → $9.671
- [15-25s] **SOCIAL PROOF:** 4 avatares + "1.000+ revendedores", "Offline", "Gratis", "Sin tarjeta"
- [25-30s] **CTA:** Button gold, "Empezar gratis"

**Visuals:** Ritmo frenético, trending beat, emojis/íconos, números pulsantes

---

## 7. COPYWRITING EXACTO

### Hooks (3 segundos máximo)

```
Video 1: "¿Cuánto ganaste hoy?"
Video 2: "Anotás en cuadernos. No sabés cuánta ganancia. Pierdes dinero cada día."
Video 3: "Sin stock = Sin venta"
Video 4: "Tu ganancia del mes" (mostrando $9.671)
Video 5: "Seis meses. Misma dedicación. Triple ganancia."
Video 6: "¿Ganaste dinero hoy?" (vulnerable, noche)
Video 7: "¿Cuaderno o app profesional?"
```

### Textos Overlay (DM Sans 16-18px, bold)

```
PROBLEMA:
"Anotaciones perdidas"
"¿Cuánta ganancia?"
"¿Quién debe?"
"No controlo mi stock"

SOLUCIÓN:
"✓ Venta en 10 segundos"
"✓ Ganancia automática"
"✓ Control total"
"✓ Stock en tiempo real"

RESULTADO:
"Ganancia: $9.671"
"Ventas: 13"
"Por cobrar: $2.600"
"Crecimiento 3x"
```

### CTAs (Golden button, DM Sans 600)

```
Primary:         "Empezar gratis"
Secondary:       "Probar ahora"
Social/Urgency:  "Sumáte 1.000+ revendedores"
Reactivation:    "Recuperá dinero hoy"
Demo:            "Ver demo"
```

### Disclaimers (DM Sans 12px, muted)

```
"Sin tarjeta de crédito"
"Gratis para siempre"
"Offline 100%"
"Ningún compromiso"
```

---

## 8. MÚSICA Y SONIDO

### Recomendaciones por Video

| Video | Tipo | Tempo | Mood | Duración |
|-------|------|-------|------|----------|
| 1 | Synth minimalista | 120 BPM | Profesional, esperanza | 60s |
| 2 | Tensión → Resolución | Variable | Caos → Esperanza | 45s |
| 3 | Moderno, clean | 110 BPM | Claro, satisfacción | 40s |
| 4 | Cinematic suave | 120 BPM | Premium, confianza | 45s |
| 5 | Progresión ascendente | 120 BPM | Motivacional, growth | 90s |
| 6 | Ambient emocional | 90 BPM | Vulnerable → Esperanza | 60s |
| 7 | Trending TikTok | 140+ BPM | Energía, urgencia | 30s |

### Sonidos Específicos

```
✓ Confirmación: Ding satisfactorio (500Hz, 200ms)
✓ Alerta: Suave beep (900Hz, 100ms)
✓ Transición: Whoosh (digital, 300ms)
✓ Counter: Tick suave para cada número (opcional)
✓ Heartbeat: Para ansiedad/stress (Video 2, 6)
✓ Resolved: Major key resolution (satisfying)
```

---

## 9. REFERENCIAS VISUALES

### Inspiración de Estilo

**Marca:** Similar a Stripe, Shopify, Linear, Notion
- Minimalismo lujoso
- Dark theme elegante
- Acentos dorados
- Movimiento fluido
- Tipografía serif + sans-serif

**Competidores a NO copiar:**
- Generic fintech (boring)
- Corporate (rígido)
- Over-animated (distrayente)

### Mood Board Conceptual

1. **Profesionalismo:** No es juguete, es herramienta seria
2. **Accesibilidad:** Para vendedores sin tech experience
3. **Esperanza:** De caos a claridad, de ignorancia a poder
4. **Humanidad:** Rostros reales, situaciones reales, emociones reales

---

## 10. ARCHIVOS DISPONIBLES EN REPO

```
Texto Briefs:
├─ MASTER_CREATIVE_BRIEF_PARFUMTRACK.md (2.850+ palabras)
├─ DESIGN-BRIEF-12-ADS.md (12 ads Meta/IG)
├─ ADS-META-IG-BRIEF.md (copy + targeting)
└─ BRAND-COLORS.json (paleta importable)

Imágenes App:
├─ img/sc-dashboard.png (ganancia $9.671)
├─ img/sc-cuotas.png (cuotas pendientes)
├─ img/sc-ventas-empty.png (estado vacío)
└─ img/whatsapp-cobro.jpg (integración WA)

Assets Brand:
├─ og-image.png (1200x630, referencia diseño)
├─ icon-192.png (logo app)
└─ icon-512.png (logo app grande)

Base de Datos (En MASTER_CREATIVE_BRIEF_PARFUMTRACK.md):
├─ Dashboard data (ganancias, ventas, por cobrar)
├─ Stock data (3 perfumes, alertas)
├─ Cuotas data (2 cuotas pendientes)
└─ Evolución 6 meses (crecimiento 3x)
```

---

## 11. INSTRUCCIONES FINALES PARA CLAUDE DESIGN

### Qué necesitás hacer:

1. **Descargá todos los archivos de este repo:**
   - MASTER_CREATIVE_BRIEF_PARFUMTRACK.md (narrativa completa)
   - ASSETS_FOR_CLAUDE_DESIGN.md (este documento)
   - Imágenes: `/img/sc-*.png`, `/img/whatsapp-cobro.jpg`, `/og-image.png`
   - BRAND-COLORS.json (paleta)

2. **Importá colores a tu herramienta:**
   - Canva: Import palette JSON
   - Figma: Create color library
   - After Effects: Create solid layers con los hexs

3. **Descargá fuentes:**
   - Cormorant Garamond (Google Fonts)
   - DM Sans (Google Fonts)

4. **Creá los 7 videos:**
   - Seguí la estructura acto-a-acto de cada brief
   - Usá screenshots reales de la app
   - Anima números (counters, scales)
   - Respetá timings exactos (60s = 60.00s, no 60.05s)

5. **Exportá en formatos:**
   - MP4 H.264, 8-12 Mbps, sRGB
   - 1080x1920px (mobile)
   - 1920x1080px (web)
   - Añadí subtítulos SRT (sin VO, solo text)

6. **Entregá:**
   - 7 videos MP4 (nombrados video-1-producto.mp4, etc.)
   - 7 JPG previews (1200x1080px)
   - 1 SRT subtítulo por video

---

## 12. CHECKLIST PARA VALIDAR

- [ ] Colores exactos (sin aproximaciones)
- [ ] Tipografía: Cormorant + DM Sans (correcta)
- [ ] Duración exacta (60.00s, 45.00s, etc.)
- [ ] Safe margins: 50px mínimo desde edges
- [ ] Números animados (counters fluidos)
- [ ] Transiciones 200-300ms (smooth)
- [ ] Audio: -14 LUFS (normalizado)
- [ ] Subtítulos: Claros, sin sobreposición de rostros
- [ ] Mobile + desktop compatible
- [ ] Offline en mente (sin dependencias de web)

---

**Todo listo. Pasamele este documento a Claude Design junto con:**
1. MASTER_CREATIVE_BRIEF_PARFUMTRACK.md
2. Las imágenes `/img/sc-*.png`
3. BRAND-COLORS.json

¡Listo para producción! 🎬

---

**Versión:** 1.0  
**Estado:** Listo para Claude Design  
**Próximo paso:** Producción de videos  
