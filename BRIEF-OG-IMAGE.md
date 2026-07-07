# BRIEF — OG Image Parfum Track

## ESPECIFICACIONES TÉCNICAS

| Parámetro | Valor |
|-----------|-------|
| **Dimensiones** | 1200 x 630 px (ratio 1.91:1) |
| **Formato** | PNG @ 72 DPI |
| **Caso de uso** | Open Graph (Facebook, Twitter, LinkedIn sharing) |
| **Tamaño máximo** | 200 KB |

---

## PALETA DE COLORES

### Colores Brand
| Nombre | Hex | RGB | Uso |
|--------|-----|-----|-----|
| **Dark BG** | `#0f0f1a` | 15, 15, 26 | Fondo principal |
| **Dark BG2** | `#1a1a2e` | 26, 26, 46 | Fondo secundario |
| **Gold** | `#c9a84c` | 201, 168, 76 | Acentos, CTA |
| **Gold Light** | `#f5dfa0` | 245, 223, 160 | Highlights, gradientes |
| **Gold Bright** | `#e8c97e` | 232, 201, 126 | Texto dorado |
| **Text Primary** | `#f0ece4` | 240, 236, 228 | Texto principal |
| **Text Secondary** | `#b8b5d0` | 184, 181, 208 | Texto secundario |
| **Text Muted** | `#9a97c0` | 154, 151, 192 | Texto más claro |
| **Green** | `#70c9a0` | 112, 201, 160 | Checkmarks, positivo |
| **Red** | `#e07070` | 224, 112, 112 | Alertas, negativo |

### Gradientes
- **Gold Gradient**: `#f5dfa0` → `#c9a84c` (135deg)
- **BG Gradient**: `#0f0f1a` → `#1a1a2e` (135deg)

---

## TIPOGRAFÍA

| Elemento | Fuente | Peso | Tamaño | Letra | Kerning |
|----------|--------|------|--------|-------|---------|
| **H1** (Headline) | Cormorant Garamond | Bold (700) | 72 px | -0.5px (tracking) | Normal |
| **H2** (Subheadline) | Cormorant Garamond | Bold (700) | 42 px | -0.5px | Normal |
| **Body** (Descripción) | DM Sans | Regular (400) | 20 px | 0px | Normal |
| **Badge** | DM Sans | Medium (500) | 14 px | 0px | Normal |
| **Button** | DM Sans | Bold (700) | 18 px | 0px | Normal |

---

## LAYOUT

```
┌─────────────────────────────────────────────────────────────┐
│ 1200px (width)                                              │
├─────────────────────────────────────────────────────────────┤
│  100px                                                       │ 160px (top)
│  ┌──────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │   LOGO (Bottle icon)        [MAIN TEXT SECTION]    │   │
│  │   [left 100-200px]          [center-right 380px]   │   │
│  │                                                      │   │
│  │   • Bottle shape             "Dejá de"             │   │
│  │   • Gold stroke              "adivinar"            │   │
│  │   • Subtle glow              "cuánto ganás"        │   │
│  │                                                      │   │
│  │                              [SUBHEADLINE]         │   │
│  │                              Small gray text       │   │
│  │                                                      │   │
│  │                              [3 BADGES]            │   │
│  │                              ✓ Sin descarga        │   │
│  │                              ✓ 100% offline        │   │
│  │                              ✓ Gratis siempre      │   │
│  │                                                      │   │
│  │                              [CTA BUTTON]          │   │
│  │                              Gold gradient button  │   │
│  │                              "Empezar gratis →"    │   │
│  │                                                      │   │
│  │                              [BRANDING]            │   │
│  │                              Logo + "Parfum Track" │   │
│  │                              "Para LATAM"          │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                 [border accent]│
└─────────────────────────────────────────────────────────────┘
630px (height)
```

---

## CONTENIDO & ELEMENTOS

### 1. FONDO
- **Base**: Gradiente `#0f0f1a` → `#1a1a2e` (diagonal 135deg)
- **Glow**: Círculo radial transparente en centro (rgba(201,168,76,0.12))
- **Decorativo**: Círculo pequeño arriba derecha (muy sutil, ~20% opacidad)

### 2. LOGO BOTELLA (Izquierda)
- **Posición**: Arriba izquierda (x: 100-150, y: 180-280)
- **Estilo**: Outline stroke gold, sin fill
- **Forma**: Botella de perfume estilizada
  - Cuello delgado en la parte superior
  - Cuerpo redondeado abajo
  - Tapa cuadrada
  - Líquido parcial adentro (gold 40% opacidad)
- **Tamaño**: ~80-100px alto
- **Animación en web**: Ninguna (es imagen estática)

### 3. HEADLINE (Centro-Derecha)
**Línea 1:** "Dejá de"
- Color: `#f0ece4` (blanco cálido)
- Posición: x: 380, y: 180

**Línea 2:** "adivinar" + "cuánto ganás"
- "adivinar": `#f0ece4` (blanco)
- "cuánto ganás": Gradiente gold (f5dfa0 → c9a84c)
- Posición: x: 380, y: 270
- **Line height**: 1.05 (apretado)

**Subtitles/Description**: 
"Registrá tus ventas en segundos · Controlá tu stock · Sabé exactamente cuánto ganás"
- Color: `#b8b5d0` (gray warm)
- Tamaño: 20px
- Posición: x: 380, y: 330
- **Line height**: 1.6

### 4. BADGES (3 items)
Posición base: y: 380, gap: 160px entre ellos

**Formato de cada badge**:
- Fondo: `rgba(27,27,48,0.8)` (muy oscuro con transparencia)
- Border: 1px `rgba(201,168,76,0.2)` (gold subtle)
- Border-radius: 20px (plenamente redondeado)
- Padding: 8px vertical, 16px horizontal
- Alto: ~40px

**Badge 1** (x: 380)
- Icono: Checkmark (green `#70c9a0`)
- Texto: "Sin descarga" (14px, medium)

**Badge 2** (x: 540)
- Icono: Checkmark (green)
- Texto: "100% offline"

**Badge 3** (x: 700)
- Icono: Checkmark (green)
- Texto: "Gratis para siempre"

### 5. CTA BUTTON
- **Posición**: x: 380, y: 460
- **Tamaño**: 220px ancho × 56px alto
- **Style**: 
  - Relleno: Gradiente gold (c9a84c → e8c97e)
  - Border-radius: 28px (píldora)
  - Shadow: 0 10px 24px rgba(201,168,76,0.35)
- **Texto**: "Empezar gratis →"
  - Color: `#1a1a2e` (muy oscuro)
  - Tamaño: 18px, Bold
  - Centrado

### 6. BRANDING SECTION (Abajo derecha)
**Posición**: x: 920, y: 520

**Icono Brand**:
- Círculo: 40px diameter
- Border: 1.5px gold (c9a84c)
- Fill: Gradiente gold suave, ~50% opacidad

**Nombre**:
- "Parfum Track"
- Font: Cormorant Garamond, 20px, Bold
- Color: `#e8c97e` (gold bright)

**Tagline**:
- "Para revendedores de LATAM"
- Font: DM Sans, 11px, Medium
- Color: `#9a97c0` (gray muted)

### 7. DECORATIVOS
- **Border inferior**: 1px línea gold (c9a84c) @ 30% opacidad, en y: 629
- **Ambient glow**: Círculo radial 400px radio en centro, gradient rgba(201,168,76,0.08) → transparent

---

## REFERENCIAS VISUALES

### Inspiración Color
- **Paleta**: Luxury dark mode + gold accents
- **Mood**: Premium, minimal, modern
- **Referencia**: High-end fintech apps (Stripe, Square, etc.)

### Inspiración Layout
- **Estilo**: Diagonal composition (left logo, center-right text)
- **Énfasis**: Headline + CTA journey (eye follows left → center → right → bottom)
- **Whitespace**: Generoso, respira

---

## EXPORTACIÓN

**Final Deliverable**:
- Nombre: `og-image.png`
- Formato: PNG (8-bit)
- Resolución: 1200 × 630 px @ 72 DPI
- Compresión: Optimizada para web (<200 KB)
- Perfil color: sRGB

---

## VARIACIONES (OPCIONAL FUTURO)

Posibles versiones:
1. **Dark** (actual): Fondo `#0f0f1a`
2. **Medium**: Fondo `#1a1a2e` (más claro, menos contrast)
3. **Languages**: Versiones EN/PT/FR con mismo diseño, solo texto traducido

---

## NOTAS PARA DISEÑADOR

- ✅ Sin fotografías reales (síntesis pure)
- ✅ Tipografía Google Fonts (descargable)
- ✅ Colores brand exactos (no aproximaciones)
- ✅ Icono de botella: Puede ser SVG incrustado o path vectorial
- ✅ Compatibilidad: Debe renderizar bien en preview de Twitter, Facebook, LinkedIn
- ❌ NO usar fuentes custom no web-safe
- ❌ NO usar efectos complejos (films, noise, etc.)
- ❌ NO usar fotografías stock

---

## CHECKLIST FINAL

- [ ] Dimensiones correctas (1200 × 630)
- [ ] Colores exactos (sin tonos aproximados)
- [ ] Texto legible en tamaño pequeño (thumbnails)
- [ ] Logo botella visible y reconocible
- [ ] Headline destacado (color gradient)
- [ ] CTA button evidente (gold, llamativo)
- [ ] Branding Parfum Track visible
- [ ] Archivo PNG optimizado (<200 KB)
- [ ] Testear en Facebook/Twitter preview tool
