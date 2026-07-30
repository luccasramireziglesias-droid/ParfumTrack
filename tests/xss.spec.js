// @ts-check
// Inyección en atributos HTML.
//
// Los tres vectores de acá se verificaron EXPLOTABLES en producción antes del
// fix: llegaban a ejecutar JS en el origen de la app, con acceso a las ventas,
// los clientes, el código de licencia y el token CSRF.
//
// La raíz era una sola: `esc()` no escapa comillas. Sirve para contenido de
// texto, pero se estaba usando dentro de atributos, donde una comilla cierra
// el atributo e inyecta uno nuevo. Y la validación de las imágenes miraba
// solo el prefijo `data:image/`, así que el resto de la cadena pasaba libre.
//
// Cada test de acá falla si se revierte el fix. Están escritos con el payload
// real, no con una aproximación.
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

// Rompe el atributo y engancha un handler que se dispara solo al no cargar
const PAYLOAD_IMG = 'data:image/png,z" onerror="window.__XSS=true';
// Rompe un aria-label y agrega un handler
const PAYLOAD_NOMBRE = 'Yara" onmouseover="window.__XSS=true" x="';

test.beforeEach(async ({ page }) => {
  await page.route('**/*.googleapis.com/**', r => r.abort());
  await page.route('**/*.gstatic.com/**', r => r.abort());
  await page.route('**/plausible.io/**', r => r.abort());
  await page.addInitScript(() => {
    localStorage.setItem('pt_onboarded', '1');
    localStorage.setItem('pt_consent_accepted', '1');
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
  await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });
  await page.evaluate(() => { window.__XSS = false; });
});

test.describe('Los escapadores hacen lo que dicen', () => {
  test('escAttr escapa comillas; esc NO (y por eso no va en atributos)', async ({ page }) => {
    const r = await page.evaluate((p) => ({
      esc: App.esc(p),
      escAttr: App.escAttr(p),
    }), PAYLOAD_NOMBRE);

    // esc deja las comillas: documentado a propósito, no es un bug de esc
    expect(r.esc).toContain('"');
    // escAttr no puede dejar ninguna
    expect(r.escAttr).not.toContain('"');
    expect(r.escAttr).not.toContain("'");
    expect(r.escAttr).toContain('&quot;');
  });

  test('esImagenSegura valida la cadena completa, no el prefijo', async ({ page }) => {
    const r = await page.evaluate((p) => ({
      payload: App.esImagenSegura(p),
      real: App.esImagenSegura('data:image/png;base64,iVBORw0KGgo='),
      sinBase64: App.esImagenSegura('data:image/png,abc'),
      svg: App.esImagenSegura('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
      noImagen: App.esImagenSegura('data:text/html;base64,PHNjcmlwdD4='),
      vacio: App.esImagenSegura(''),
      nulo: App.esImagenSegura(null),
    }), PAYLOAD_IMG);

    expect(r.payload, 'aceptó el payload').toBe(false);
    expect(r.real, 'rechazó una imagen legítima').toBe(true);
    expect(r.sinBase64, 'aceptó un data URL sin base64').toBe(false);
    expect(r.svg, 'aceptó SVG — puede llevar scripts').toBe(false);
    expect(r.noImagen).toBe(false);
    expect(r.vacio).toBe(false);
    expect(r.nulo).toBe(false);
  });
});

test.describe('Vector 1 — logo del negocio (llega por un backup restaurado)', () => {
  test('un logo adulterado no ejecuta nada', async ({ page }) => {
    const ejecuto = await page.evaluate(async (payload) => {
      await DB.setConfig('negocio', { nombre: 'x', logo: payload });
      await App.loadNegocio();
      App.showScreen('cuenta');
      App.renderNegocio();
      await new Promise(r => setTimeout(r, 400));
      return window.__XSS;
    }, PAYLOAD_IMG);
    expect(ejecuto, 'XSS vía logo del negocio').toBe(false);
  });

  test('el sanitizador lo descarta antes de guardarlo', async ({ page }) => {
    const guardado = await page.evaluate((payload) =>
      App._sanitizarNegocio({ nombre: 'x', logo: payload }).logo, PAYLOAD_IMG);
    expect(guardado).toBe('');
  });
});

test.describe('Vector 2 — foto de perfume (backup o planilla)', () => {
  test('una foto adulterada no ejecuta nada al editar el perfume', async ({ page }) => {
    const ejecuto = await page.evaluate(async (payload) => {
      const p = App.perfumes[0];
      p.foto = payload;
      await DB.put('perfumes', p);
      await App.loadData();
      App.openEditPerfume(p.id);
      await new Promise(r => setTimeout(r, 400));
      return window.__XSS;
    }, PAYLOAD_IMG);
    expect(ejecuto, 'XSS vía foto de perfume').toBe(false);
  });

  test('tampoco en la lista del catálogo', async ({ page }) => {
    const ejecuto = await page.evaluate(async (payload) => {
      const p = App.perfumes[0];
      p.foto = payload;
      await DB.put('perfumes', p);
      await App.loadData();
      App._catalogoSelected = new Set();
      App._renderCatalogoList(App.perfumes);
      await new Promise(r => setTimeout(r, 400));
      return window.__XSS;
    }, PAYLOAD_IMG);
    expect(ejecuto).toBe(false);
  });
});

test.describe('Vector 3 — nombre de perfume (se puede tipear o importar de Excel)', () => {
  test('un nombre con comillas no inyecta un handler', async ({ page }) => {
    const r = await page.evaluate(async (payload) => {
      for (const p of await DB.getAll('perfumes')) await DB.delete('perfumes', p.id);
      await DB.addPerfume({ nombre: payload, stock: 2, precioCompra: 1, precioVenta: 2 });
      await App.loadData();
      App.showScreen('stock');
      App.renderStock();
      await new Promise(r => setTimeout(r, 300));
      const btn = document.querySelector('.stock-reponer');
      return {
        atributos: btn ? Array.from(btn.attributes).map(a => a.name) : [],
        // El nombre tiene que seguir siendo legible: escapar no es borrar
        aria: btn ? btn.getAttribute('aria-label') : '',
      };
    }, PAYLOAD_NOMBRE);

    expect(r.atributos, 'inyectó un handler en el botón').not.toContain('onmouseover');
    expect(r.atributos).not.toContain('x');
    expect(r.aria, 'el nombre se perdió al escapar').toContain('Yara');
  });

  test('tampoco en las alertas de stock agotado', async ({ page }) => {
    const atributos = await page.evaluate(async (payload) => {
      for (const p of await DB.getAll('perfumes')) await DB.delete('perfumes', p.id);
      await DB.addPerfume({ nombre: payload, stock: 0, precioCompra: 1, precioVenta: 2 });
      await App.loadData();
      App.showScreen('stock');
      App.renderStock();
      await new Promise(r => setTimeout(r, 300));
      const btn = document.querySelector('.stock-alert-btn');
      return btn ? Array.from(btn.attributes).map(a => a.name) : [];
    }, PAYLOAD_NOMBRE);
    expect(atributos).not.toContain('onmouseover');
  });

  test('un nombre de cliente con comilla simple no rompe el onclick', async ({ page }) => {
    // Antes se escapaba a mano con .replace(/'/g,"\\\\'"), que un backslash
    // rompe. Ahora el nombre viaja percent-encoded, que es inerte.
    const r = await page.evaluate(async () => {
      for (const v of await DB.getAll('ventas')) await DB.delete('ventas', v.id);
      const nombre = "O'Brien\\' + window.__XSS=true + '";
      await DB.addVenta({
        perfume: 'X', perfumeId: '', cantidad: 1, precioVenta: 100, precioCompra: 50,
        cliente: nombre, vendedor: 'Yo', formaPago: 'contado', numCuotas: 1, fecha: Date.now(),
      });
      await App.loadData();
      App.showScreen('clientes');
      App.renderClientes();
      await new Promise(r => setTimeout(r, 300));
      const card = document.querySelector('.cliente-card');
      if (card) card.click();
      await new Promise(r => setTimeout(r, 300));
      return { xss: window.__XSS, abrio: App.currentScreen };
    });
    expect(r.xss, 'XSS vía nombre de cliente en el onclick').toBe(false);
    // Y el click tiene que seguir funcionando con un apóstrofo en el nombre
    expect(r.abrio).toBe('cliente-detalle');
  });
});

test.describe('Restaurar un backup no mete datos envenenados en la base', () => {
  test('la foto adulterada se descarta al restaurar, no solo al renderizar', async ({ page }) => {
    // Defensa en profundidad: si el dato entra sucio, cualquier render nuevo
    // que se olvide de validar vuelve a abrir el agujero
    const guardado = await page.evaluate((payload) =>
      App._sanearImportado('perfumes', { id: 1, nombre: 'X', foto: payload }).foto, PAYLOAD_IMG);
    expect(guardado).toBe('');
  });

  test('una imagen legítima sobrevive al saneado', async ({ page }) => {
    const ok = 'data:image/png;base64,iVBORw0KGgo=';
    const guardado = await page.evaluate((img) =>
      App._sanearImportado('perfumes', { id: 1, nombre: 'X', foto: img }).foto, ok);
    expect(guardado).toBe(ok);
  });

  test('el perfil del negocio de un backup pasa por el sanitizador', async ({ page }) => {
    const r = await page.evaluate((payload) =>
      App._sanearImportado('config', { key: 'negocio', value: { nombre: 'X', logo: payload } }).value.logo,
    PAYLOAD_IMG);
    expect(r).toBe('');
  });
});
