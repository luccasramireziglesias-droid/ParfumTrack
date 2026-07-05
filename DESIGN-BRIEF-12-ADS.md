# DESIGN BRIEF — 12 Ads Meta/IG para Parfum Track

**Para:** Claude Design (Canva/Figma)  
**Proyecto:** ParfumTrack Campaign LATAM  
**Deliverable:** 12 imágenes feed ads (1200 × 628 px)  
**Timeline:** ASAP  
**Reference Docs:** 
- [BRIEF-OG-IMAGE.md](BRIEF-OG-IMAGE.md) — Paleta + tipografía
- [BRAND-COLORS.json](BRAND-COLORS.json) — Colores exactos
- [ADS-META-IG-BRIEF.md](ADS-META-IG-BRIEF.md) — Copy de cada ad

---

## SPECS TÉCNICO

| Campo | Valor |
|-------|-------|
| **Dimensiones** | 1200 × 628 px (ratio 1.91:1) |
| **Format** | PNG/JPG @ 72 DPI |
| **Tamaño máximo** | 5 MB por imagen |
| **Color space** | sRGB |
| **Safe text area** | Centro 900×500 (no edges) |
| **Plataformas** | Meta feeds + Instagram feeds |

---

## PALETA DE COLORES

**Referencia:** BRAND-COLORS.json

### Colores primarios
- **Dark BG**: #0f0f1a (fondo principal)
- **Dark BG2**: #1a1a2e (fondo secundario)
- **Gold**: #c9a84c (acentos, highlights)
- **Gold Light**: #f5dfa0 (gradientes)
- **Text Primary**: #f0ece4 (texto blanco cálido)
- **Text Secondary**: #b8b5d0 (texto gris)
- **Success**: #70c9a0 (checkmarks, positivo)
- **Error**: #e07070 (negativo, atención)

### Gradientes listos
```css
Gold: linear-gradient(135deg, #f5dfa0, #c9a84c)
BG: linear-gradient(135deg, #0f0f1a, #1a1a2e)
```

---

## TIPOGRAFÍA

| Elemento | Font | Weight | Size | Tracking |
|----------|------|--------|------|----------|
| **Headlines** | Cormorant Garamond | Bold (700) | 36-48px | -0.5px |
| **Body text** | DM Sans | Regular (400) | 16-18px | Normal |
| **CTA text** | DM Sans | Bold (700) | 14-16px | Normal |

**Fuentes**: Descargar de Google Fonts

---

## LOS 12 ADS — DETALLES DE DISEÑO

### AD 1: PROBLEMA — "Vendés, pero ¿ganás?"
**Ángulo:** Pain point  
**Tema:** Caos vs Claridad

**Layout:**
- Split vertical: 50% izquierda / 50% derecha
- **Izquierda (caos):**
  - Fondo: Dark BG + red tint overlay (rgba(224,112,112,0.2))
  - Contenido: Números desordenados, signo de pregunta grande
  - Texto overlay: "❌ ¿Adivinando?" (blanco, bold)
  - Iconos: Calculadora + signo de interrogación (confundidos)

- **Derecha (claridad):**
  - Fondo: Dark BG2 con gold glow radial
  - Contenido: Números ordenados (grandes, gold)
  - Texto overlay: "✓ Sabemos" (gold, bold)
  - Ícono: Checkmark (verde #70c9a0)

**Text overlay:**
- Headline: "Vendés, pero ¿ganás?" (Cormorant, 40px, white)
- Posición: Centro superior
- Sombra: Drop shadow rgba(0,0,0,0.5)

---

### AD 2: SOLUCIÓN — "Ganancia automática"
**Ángulo:** Solution  
**Tema:** Input → Output

**Layout:**
- Phone mockup (280-300px wide) centered
- **Phone screen content:**
  - Status bar: "9:41" + wifi/battery icons (real)
  - App header: Parfum Track logo small
  - Venta input: "Yara EDT | $4.400"
  - Arrow down (animated concept): →
  - Ganancia output: "$1.200" (GRANDE, gold gradient)
  - Verde checkmark junto a ganancia

**Background:**
- Radial glow: Gold (weak, 20% opacity) detrás del phone
- Fondo: BG gradient

**Text overlay:**
- Headline: "Ganancia automática" (Cormorant, 38px, white, top-left)
- Subtext: "Registrá una venta\nVe tu ganancia al instante" (DM Sans, 14px, gray)

---

### AD 3: BENEFICIO — "Vende en cualquier lado"
**Ángulo:** Mobility  
**Tema:** 3 locations

**Layout:**
- 3 locations in montage (grid 1×3 diagonal or staggered)
  1. **Feria:** Person vendiendo + phone in hand
  2. **Calle:** Street vendor + phone visible
  3. **Evento:** Event booth + phone prominent

- Cada location: Foto/illustration + location label small
- **Overlay:** Wifi icon ❌ (big, red, center-top)
- **Text overlay bottom:** "✓ Sin internet, sin problema" (green)

**Background:**
- Dark BG
- Subtle location pins (map style icons)

**Text overlay:**
- Headline: "Vende en cualquier lado" (Cormorant, 40px, white)
- CTA hint: "Funciona 100% offline" (DM Sans, 14px, gray)

---

### AD 4: VELOCIDAD — "Venta en 10 segundos"
**Ángulo:** Speed  
**Tema:** Timeline visual

**Layout:**
- Horizontal timeline: 3 steps (círculos conectados)
  - Step 1 (2sec): "Elegí perfume" + perfume icon
  - Step 2 (3sec): "Cargá precio" + price icon
  - Step 3 (5sec): "✓ Listo" + checkmark (green)

- Cada círculo: 40-50px, conectado con línea (gold)
- Números pequeños abajo de cada círculo (2s, 3s, 5s)

**Center:** Phone mockup pequeño (200px) mostrando cada step

**Background:**
- BG gradient
- Clock icon subtle (top-right, low opacity)

**Text overlay:**
- Headline: "Venta en 10 segundos" (Cormorant, 42px, white, top)
- Bottom: "La forma más rápida de vender" (DM Sans, 14px, gray)

---

### AD 5: SOCIAL PROOF — "Revendedores en LATAM"
**Ángulo:** Community  
**Tema:** Mapa + números

**Layout:**
- LATAM map (simplified, stylized)
- 4 countries highlighted (AR, UY, CO, MX) con pin icons
- Banderas pequeñas en cada país
- **Center big text:** "3,000+" (Cormorant, 60px, gold)
- **Under numbers:** "Usuarios activos" (DM Sans, 18px, white)

**Background:**
- Dark BG
- Subtle map line texture (muy faint)
- Glow around "3,000+" number

**Text overlay:**
- Headline: "Revendedores en LATAM confían" (Cormorant, 36px, white, top)

---

### AD 6: GRATUITO — "Gratis. De verdad."
**Ángulo:** No friction  
**Tema:** Credit card rejected

**Layout:**
- Split 60/40 (left card, right checklist)

- **Left side:**
  - Credit card visual (golden/silver outline, stylized)
  - Big red ❌ over card
  - Fondo: Dark BG con red tint subtle

- **Right side:**
  - Green checkmarks list (3 items):
    - ✓ Sin tarjeta
    - ✓ Sin límite
    - ✓ Sin costo
  - Cada línea: DM Sans, 16px, white
  - Checkmarks: Green (#70c9a0), 24px

**Background:**
- Dark BG clean, minimalista

**Text overlay:**
- Headline: "Gratis. De verdad." (Cormorant, 44px, gold, center-top)

---

### AD 7: URGENCY — "Cierre de mes fácil"
**Ángulo:** Time-sensitive  
**Tema:** Stress → Relief

**Layout:**
- Split visual: Left (stressed), Right (relief)

- **Left (estrés):**
  - Calendar mostrando últimos días del mes
  - Caras confundidas/números borrosos
  - Color: Dark BG + red stress overlay

- **Right (alivio):**
  - Dashboard tablet/phone mockup
  - Stats claros: "13 ventas | $9,671 ganancia | $2,600 por cobrar"
  - Green ✓ marks
  - Clean, organized

**Center arrow:** → (big, gold)

**Background:**
- BG gradient

**Text overlay:**
- Headline: "Cierre de mes fácil" (Cormorant, 40px, white)
- Bottom: "Control total en 2 clics" (DM Sans, 14px, gray)

---

### AD 8: COMPARISON — "Adiós Excel y cuadernos"
**Ángulo:** Before/After  
**Tema:** Caos vs Orden

**Layout:**
- Split 50/50 vertical

- **Left side (ANTES):**
  - Excel spreadsheet (messy, chaotic)
  - Papel cuaderno (half-filled, notes scattered)
  - Red X overlay
  - Colores: Dark + red tint
  - Ícono: 😫 (frustrated)

- **Right side (DESPUÉS):**
  - Phone clean app interface
  - Stats organized
  - Green ✓ checkmarks
  - Ícono: 😊 (happy)

**Center divider:** Vertical line (gold, dashed)

**Background:**
- Dark BG

**Text overlay:**
- Headline: "Adiós Excel y cuadernos" (Cormorant, 42px, white)
- Bottom left: "❌ Complicado" (red, small)
- Bottom right: "✓ Moderno" (green, small)

---

### AD 9: FEATURE — "Cobros por WhatsApp"
**Ángulo:** Unique feature  
**Tema:** WhatsApp central

**Layout:**
- Center: WhatsApp icon (big, 100px+, prominent green)
- Around it (3 nodes connected):
  1. **Top:** Recordatorio de cobro (SMS-style bubble)
  2. **Bottom-left:** Catálogo producto (gallery preview)
  3. **Bottom-right:** Phone mostrando conversación

- Lines connecting cada node (gold, subtle)

**Background:**
- Dark BG
- Green glow subtle alrededor WhatsApp icon (20% opacity)

**Text overlay:**
- Headline: "Cobros por WhatsApp" (Cormorant, 40px, white, top)
- Bottom: "Tus clientes ya usan WA" (DM Sans, 14px, gray)

---

### AD 10: GAMIFICATION — "¿Quién vende más?"
**Ángulo:** Leaderboard  
**Tema:** Competition

**Layout:**
- Leaderboard table (3 top spots):
  - 🥇 #1: "Carlos | 32 ventas | $12,400"
  - 🥈 #2: "María | 28 ventas | $10,200"
  - 🥉 #3: "Juan | 24 ventas | $8,900"

- Each row: Small card (dark, bordered gold)
- Medals prominentes (big, colorful)
- Números grandes (gold text)

**Background:**
- Dark BG
- Subtle competitive energy (maybe lightning bolt icon top-right)

**Text overlay:**
- Headline: "¿Quién vende más?" (Cormorant, 44px, white, top)
- Bottom: "Motiva a tu equipo | Gestiona mejor" (DM Sans, 13px, gray)

---

### AD 11: SECURITY — "Tus datos en tu celular"
**Ángulo:** Privacy  
**Tema:** Phone = Safe

**Layout:**
- Center: Phone illustration/mockup (300px height)
- **Over phone:** Lock icon (BIG, 80px+, gold)
- Around phone: Shield outline (subtle, gold stroke)

**Background:**
- Dark BG
- Green tint subtle (trust color, 10% opacity)

**Text overlay:**
- Headline: "Tus datos en tu celular" (Cormorant, 40px, white, top)
- Body: "No en servidores. Bajo tu control. 🔒" (DM Sans, 14px, gray)
- Bottom: "Seguridad garantizada" (DM Sans, 12px, gold)

---

### AD 12: OBJECTION HANDLER — "Míralo en acción"
**Ángulo:** Demo/Proof  
**Tema:** Play button

**Layout:**
- Center: App screen mockup (teaser of dashboard)
- **Over mockup:** Big PLAY button (▶ triángulo, 80px, white, semi-transparent)
- Glow around play button (gold, soft)

**Background:**
- Dark BG
- Subtle movement lines (concept of "action")

**Text overlay:**
- Headline: "Míralo en acción" (Cormorant, 44px, white, top)
- Bottom: "Demo en 30 segundos | Prueba sin riesgos" (DM Sans, 13px, gray)

---

## INSTRUCCIONES GENERALES

1. **Fuentes:** Descargar de Google Fonts
   - Cormorant Garamond Bold (700)
   - DM Sans Regular (400) y Bold (700)

2. **Colores:** Usar valores exactos de BRAND-COLORS.json
   - No aproximar dorados (#c9a84c, no #d4a574)
   - No usar tonos puros blanco (#f0ece4, no #ffffff)

3. **Text placement:**
   - Mantener safe area: 50px margins from edges
   - Usar drop shadows para legibilidad en fondos oscuros
   - Headline siempre legible (contrast ≥4.5:1 WCAG AA)

4. **Export settings:**
   - Formato: PNG
   - Resolución: 1200 × 628 px @ 72 DPI
   - sRGB color space
   - Optimizar para web (<1MB preferible, máx 5MB)

5. **Phone mockups (cuando se usen):**
   - Usar mockup style "flat" o "minimal" (no 3D perspective heavy)
   - Pantalla interna: 100% de contenido visible, limpio
   - Frame: Dark gris/negro (#07070d referencia)

6. **Icons:**
   - Usar Google Material Symbols style (ej: checkmark, clock, lock, shield)
   - O Feather Icons (minimal, consistent)
   - Color según contexto (green para success, red para error)

7. **Fotografías:**
   - Si usas fotos reales (personas, locaciones): Buscar en Unsplash/Pexels
   - Recomendación: Usar illustrations minimalistas en lugar de fotos (más consistente con brand)
   - Aplicar overlay oscuro si es necesario para texto legibility

---

## QA CHECKLIST ANTES DE ENTREGAR

- [ ] 12 imágenes creadas (1200 × 628 px)
- [ ] Colores exactos (oro #c9a84c, no aproximaciones)
- [ ] Tipografía correcta (Cormorant + DM Sans)
- [ ] Text legible en preview pequeño (thumbnail)
- [ ] Ningún texto cortado en edges (safe area OK)
- [ ] Gradient gold visible y claro
- [ ] Checkmarks verdes (#70c9a0) donde aparecen
- [ ] Números grandes y legibles en imágenes
- [ ] Contraste texto/fondo ≥4.5:1 (WCAG AA)
- [ ] Formato PNG, sRGB, optimizado
- [ ] Estilos consistentes entre los 12 ads (paleta, tipografía, layout rhythm)

---

## REFERENCIAS VISUALES

- **Inspiración color:** Paleta gold + dark (luxury fintech)
- **Inspiración layout:** Directa, limpia, sin ruido
- **Inspiración tipografía:** Cormorant para elegancia, DM Sans para legibilidad

---

## ENTREGA

Enviar 12 imágenes PNG con nombres:
```
parfum-track-ad-001-problema.png
parfum-track-ad-002-solucion.png
...
parfum-track-ad-012-objection-handler.png
```

**Listo para:** Importar a Meta Ads Manager directamente

---

**Creado:** 5 Julio 2026  
**Para:** Parfum Track LATAM Campaign  
**Status:** Ready for Claude Design
