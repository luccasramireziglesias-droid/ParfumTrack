// Regresiones de contenido y marca de la landing.
//
// El build test de al lado verifica que landing.html se GENERE. Esto verifica que lo
// generado no vuelva a romper tres cosas concretas que ya estuvieron mal (30/07):
//
//  1. Prueba social inventada — "+340 revendedores en LATAM" en el hero y en la barra de
//     stats, con el producto en 0 usuarios. Publicidad engañosa (regulada en AR/UY/CO/MX)
//     y además pelea con la estrategia, que es conseguir a los primeros de verdad.
//  2. 18 MB de video en la primera carga — el <video> sin preload="none" hacía que el
//     navegador se bajara demo.mp4 entero aunque nadie lo mirara: 98% del peso de la
//     página, en un mercado de datos móviles caros.
//  3. Tipografía fuera de marca — los títulos en DM Sans cuando la regla del proyecto
//     (y la app, en 18 lugares) usan Cormorant Garamond.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const root = path.join(import.meta.dirname, '..');
const landing = readFileSync(path.join(root, 'landing.html'), 'utf8');
const src = (f) => readFileSync(path.join(root, 'src', 'landing', f), 'utf8');

/** Texto visible de la landing, sin etiquetas, sin <script> ni <style> ni comentarios. */
const textoVisible = (() => {
  let t = landing.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  return t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
})();

describe('la landing no afirma cosas que no son ciertas', () => {
  it('no dice tener una base de usuarios que no existe', () => {
    // El número exacto que estuvo publicado. Si algún día es real, hay que actualizar
    // este test a conciencia — no borrarlo.
    expect(textoVisible).not.toMatch(/\+?\s*340\s*(revendedor|usuari)/i);
  });

  it('no inventa ningún otro número de usuarios', () => {
    const m = textoVisible.match(/[+]?\s?\d{2,6}\s*(revendedores|usuarios|clientes|negocios|personas)/gi);
    expect(
      m,
      'La landing afirma tener usuarios. Si el número es real, sumalo a este test con ' +
        'la fuente; si no, sacalo del hero y de la barra de stats.'
    ).toBeNull();
  });

  it('no promete un plan que no se puede comprar', () => {
    // El plan Pro de $19.99 no existe en el código (ni UI, ni precio en Mercado Pago).
    expect(textoVisible).not.toMatch(/19[.,]99/);
    // Mencionarlo como "próximamente" sí es honesto y está permitido.
    if (/plan Pro/i.test(textoVisible)) {
      expect(textoVisible).toMatch(/plan Pro\s*\(?pr[oó]ximamente/i);
    }
  });

  it('los precios coinciden con los que acepta Mercado Pago', () => {
    const wrangler = readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
    for (const monto of ['9.99', '7.99', '95.88']) {
      expect(textoVisible, `falta el precio ${monto}`).toContain(monto);
    }
    expect(wrangler).toContain('"MP_AMOUNT_MONTHLY": "9.99"');
    expect(wrangler).toContain('"MP_AMOUNT_ANNUAL": "95.88"');
  });
});

describe('la landing no le quema los datos móviles al visitante', () => {
  const demo = src('sections/03-demo.html');

  it('el video no se precarga (pesa ~18 MB)', () => {
    expect(demo).toMatch(/<video[^>]*\spreload=["']none["']/);
  });

  it('el video sigue siendo el único elemento pesado que se difiere', () => {
    // Si alguien agrega otro <video> o <audio>, que también lo piense.
    const medias = demo.match(/<(video|audio)\b[^>]*>/g) || [];
    for (const m of medias) {
      expect(m, `${m} tendría que llevar preload="none"`).toMatch(/preload=["']none["']/);
    }
  });

  it('"Ver demo" arranca la reproducción (si no, queda un rectángulo negro)', () => {
    const js = src('sections/14-scripts.html');
    expect(demo).toContain('onclick="abrirDemo()"');
    expect(js).toMatch(/function abrirDemo\(\)[\s\S]{0,240}\.play\(\)/);
  });

  it('cerrar el modal pausa el video (antes el audio seguía sonando)', () => {
    const js = src('sections/14-scripts.html');
    expect(demo).toContain('onclick="cerrarDemo()"');
    expect(js).toMatch(/function cerrarDemo\(\)[\s\S]{0,240}\.pause\(\)/);
  });

  it('las imágenes pesadas de abajo del fold van con loading="lazy"', () => {
    const imgs = landing.match(/<img\b[^>]*>/g) || [];
    // Se cuentan URLs únicas, no elementos: el logo aparece 3 veces (nav y footer) y es
    // una sola petición. Lo que importa es cuántos archivos distintos se piden al entrar.
    const urlsEager = new Set(
      imgs
        .filter((i) => !/loading=["']lazy["']/.test(i))
        .map((i) => (i.match(/src=["']([^"']+)["']/) || [])[1])
        .filter(Boolean)
    );
    // Permitidas: el logo (arriba del fold, 15 KB) y el screenshot del hero (es el LCP,
    // va con fetchpriority="high" a propósito). Cualquier otra tiene que ser lazy.
    const permitidas = new Set(['/icon-192.png', '/screenshot-app.webp']);
    const demas = [...urlsEager].filter((u) => !permitidas.has(u));
    expect(demas, 'estas imágenes se piden al entrar y deberían ser lazy:\n' + demas.join('\n')).toEqual([]);
  });

  it('las capturas grandes (>100 KB) son todas lazy', () => {
    const pesadas = ['screenshot-catalogo.jpg', 'whatsapp-cobro.jpg', 'screenshot-estadisticas.jpg'];
    for (const nombre of pesadas) {
      const tag = (landing.match(new RegExp('<img\\b[^>]*' + nombre + '[^>]*>')) || [])[0];
      expect(tag, `no se encontró el <img> de ${nombre}`).toBeTruthy();
      expect(tag, `${nombre} pesa >100 KB y tiene que ser lazy`).toMatch(/loading=["']lazy["']/);
    }
  });
});

/** Lee el ancho y alto reales de un JPEG o un WebP, sin dependencias. */
function dimensiones(rel) {
  const d = readFileSync(path.join(root, rel));
  if (d[0] === 0xff && d[1] === 0xd8) {
    // JPEG: recorrer los marcadores hasta el SOF, que trae alto y ancho.
    let i = 2;
    while (i < d.length - 9) {
      if (d[i] !== 0xff) { i++; continue; }
      const m = d[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
        return { w: d.readUInt16BE(i + 7), h: d.readUInt16BE(i + 5) };
      }
      i += 2 + d.readUInt16BE(i + 2);
    }
  }
  if (d.slice(0, 4).toString() === 'RIFF' && d.slice(8, 12).toString() === 'WEBP') {
    const fmt = d.slice(12, 16).toString();
    if (fmt === 'VP8 ') return { w: d.readUInt16LE(26) & 0x3fff, h: d.readUInt16LE(28) & 0x3fff };
    if (fmt === 'VP8L') {
      const b = d.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fmt === 'VP8X') return { w: (d.readUIntLE(24, 3) & 0xffffff) + 1, h: (d.readUIntLE(27, 3) & 0xffffff) + 1 };
  }
  throw new Error('no se pudo leer el tamaño de ' + rel);
}

describe('las capturas declaran el tamaño que realmente tienen', () => {
  // Un width/height mal declarado reserva el espacio equivocado y la página salta cuando
  // la imagen carga (CLS). Ya pasó con img/whatsapp-cobro.jpg: decía 1231 y son 1144.
  const tags = landing.match(/<img\b[^>]*>/g) || [];

  it.each(
    tags
      .map((t) => ({
        tag: t,
        src: (t.match(/src=["']\/([^"']+)["']/) || [])[1],
        w: Number((t.match(/width=["'](\d+)["']/) || [])[1]),
        h: Number((t.match(/height=["'](\d+)["']/) || [])[1]),
      }))
      .filter((x) => x.src && x.w && x.h && /\.(jpe?g|webp|png)$/.test(x.src))
      .map((x) => [x.src, x.w, x.h])
  )('%s declara %ix%i y el archivo coincide en proporción', (src, w, h) => {
    const real = dimensiones(src);
    const declarada = w / h;
    const verdadera = real.w / real.h;
    expect(
      Math.abs(declarada - verdadera),
      `${src}: declara ${w}x${h} (${declarada.toFixed(3)}) pero el archivo es ` +
        `${real.w}x${real.h} (${verdadera.toFixed(3)}). Corregí width/height o la página va a saltar al cargar.`
    ).toBeLessThan(0.01);
  });

  it('manifest.json declara el tamaño real de cada captura', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    for (const s of manifest.screenshots || []) {
      const real = dimensiones(s.src.replace(/^\//, ''));
      expect(s.sizes, `${s.src} en manifest.json`).toBe(`${real.w}x${real.h}`);
    }
  });

  it('las capturas de la landing no pesan de más', () => {
    for (const rel of ['screenshot-app.webp', 'screenshot-catalogo.jpg',
                       'screenshot-estadisticas.jpg', 'img/whatsapp-cobro.jpg']) {
      const kb = readFileSync(path.join(root, rel)).length / 1024;
      expect(kb, `${rel} pesa ${kb.toFixed(0)} KB`).toBeLessThan(300);
    }
  });
});

describe('el formulario donde entra la plata es usable con lector de pantalla', () => {
  it('el campo de email tiene un label asociado con for=', () => {
    // Había un <label> con el texto "Tu email" pero sin `for`, así que no quedaba
    // asociado: un lector de pantalla anunciaba el campo sin nombre.
    expect(landing).toMatch(/<label[^>]*\sfor=["']mp-email-input["']/);
    expect(landing).toMatch(/<input[^>]*\sid=["']mp-email-input["']/);
  });

  it('los errores de validación se anuncian solos', () => {
    expect(landing).toMatch(/id=["']mp-checkout-error["'][^>]*role=["']alert["']/);
    expect(landing).toMatch(/<input[^>]*aria-describedby=["']mp-checkout-error["']/);
  });

  it('el teclado del celular se abre en modo email', () => {
    const input = (landing.match(/<input[^>]*id=["']mp-email-input["'][^>]*>/) || [])[0] || '';
    expect(input).toMatch(/type=["']email["']/);
    expect(input).toMatch(/inputmode=["']email["']/);
  });
});

describe('la app no depende de un CDN de fuentes', () => {
  it('el Service Worker ya no cachea Google Fonts', () => {
    // Código muerto desde que las fuentes son locales, y la CSP (font-src 'self') lo
    // bloquearía igual. Se sacó para que nadie deduzca que todavía dependemos de Google.
    //
    // Se miran los comentarios aparte: el comentario que explica por qué se quitó nombra
    // los dominios, y eso está bien. Lo que no puede volver es el código.
    const sw = readFileSync(path.join(root, 'sw.js'), 'utf8');
    const codigo = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(codigo).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('las fuentes locales siguen precacheadas', () => {
    const sw = readFileSync(path.join(root, 'sw.js'), 'utf8');
    expect(sw).toContain('/fonts/fonts.css');
    expect(sw).toContain('/fonts/dm-sans-latin.woff2');
  });

  it('la CSP no permite pedir fuentes afuera', () => {
    expect(readFileSync(path.join(root, '_headers'), 'utf8')).toMatch(/font-src 'self'/);
  });
});

describe('la landing usa la tipografía de la marca', () => {
  it.each([
    ['styles/03-hero.css', '.hero h1'],
    ['styles/05-sections-common.css', '.section-h2'],
    ['styles/13-cta-footer.css', '.cta-final-h2'],
    ['styles/07-feature-catalog.css', '.feature-hero-title'],
    ['styles/04-demo.css', '.demo-title'],
  ])('%s → %s usa Cormorant Garamond', (archivo, selector) => {
    const css = src(archivo);
    const i = css.indexOf(selector + ' {');
    expect(i, `no se encontró la regla ${selector}`).toBeGreaterThan(-1);
    const bloque = css.slice(i, css.indexOf('}', i));
    expect(bloque).toMatch(/font-family:\s*'Cormorant Garamond'/);
  });

  it('ningún título pide un peso que la fuente no tiene', () => {
    // fonts.css solo trae Cormorant en 400, 600 y 700. Pedir 800/900 hace que el
    // navegador lo simule engrosando los trazos, y queda sucio.
    const dir = path.join(root, 'src', 'landing', 'styles');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
      const css = readFileSync(path.join(dir, f), 'utf8');
      for (const m of css.matchAll(/font-family:\s*'Cormorant Garamond'[\s\S]{0,220}?\}/g)) {
        const peso = m[0].match(/font-weight:\s*(\d{3})/);
        if (peso) {
          expect(
            Number(peso[1]),
            `${f}: Cormorant Garamond con font-weight ${peso[1]} (solo hay 400/600/700)`
          ).toBeLessThanOrEqual(700);
        }
      }
    }
  });

  it('el body sigue en DM Sans', () => {
    expect(src('styles/00-base.css')).toMatch(/font-family:\s*'DM Sans'/);
  });

  it('las fuentes son locales, sin pedidos a Google', () => {
    expect(landing).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(landing).toContain('/fonts/fonts.css');
  });
});
