// @ts-check
// Perfil del negocio: los datos que el CLIENTE ve.
//
// No es un formulario que junta datos y los deja ahí: el nombre y el logo
// van al header, y el contacto encabeza el catálogo de WhatsApp y el PDF.
// Los tests verifican esa cadena, no solo que se guarde.
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';

// 1×1 px transparente, suficiente para probar el circuito de la foto
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PERFIL = {
  nombre: 'VIP Parfums',
  tipo: 'Perfumes',
  pais: '+598',
  telefono: '94 466 577',
  email: 'vip@parfums.com',
  direccion: 'Av. 18 de Julio 1234',
  ciudad: 'Montevideo',
  documento: '210001234567',
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
});

const completar = (page, datos) => page.evaluate(async (d) => {
  App.showScreen('cuenta');
  App.renderNegocio();
  for (const [k, v] of Object.entries(d)) {
    const el = document.getElementById('negocio-' + k);
    if (el) el.value = v;
  }
  await App._guardarNegocioImpl();
}, datos);

test.describe('Perfil del negocio', () => {
  test('se guarda y sobrevive a recargar la app', async ({ page }) => {
    await completar(page, PERFIL);

    // En el store config, no en localStorage: así entra en el backup
    const enConfig = await page.evaluate(() => DB.getConfig('negocio'));
    expect(enConfig).toMatchObject(PERFIL);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });
    expect(await page.evaluate(() => App.getNegocio())).toMatchObject(PERFIL);
  });

  test('el nombre exige contenido; el resto es opcional', async ({ page }) => {
    await completar(page, { nombre: '   ' });
    expect(await page.evaluate(() => DB.getConfig('negocio'))).toBeNull();

    await completar(page, { nombre: 'Solo Nombre' });
    const g = await page.evaluate(() => DB.getConfig('negocio'));
    expect(g.nombre).toBe('Solo Nombre');
    expect(g.ciudad).toBe('');
  });

  test('rechaza un email mal escrito antes de guardar', async ({ page }) => {
    await completar(page, { nombre: 'Test', email: 'no-es-un-email' });
    expect(await page.evaluate(() => DB.getConfig('negocio'))).toBeNull();
  });

  test('cada campo respeta su límite', async ({ page }) => {
    await completar(page, {
      nombre: 'N'.repeat(80), ciudad: 'C'.repeat(80), documento: 'D'.repeat(60),
    });
    const g = await page.evaluate(() => DB.getConfig('negocio'));
    expect(g.nombre.length).toBe(30);
    expect(g.ciudad.length).toBe(40);
    expect(g.documento.length).toBe(20);
  });

  test('el nombre también va al header, que lo lee antes de abrir la base', async ({ page }) => {
    await completar(page, { nombre: 'VIP Parfums' });
    expect(await page.evaluate(() => localStorage.getItem('pt_negocio'))).toBe('VIP Parfums');
    await page.evaluate(() => App.showScreen('inicio'));
    await expect(page.locator('.logo-text')).toHaveText('VIP Parfums');
  });
});

test.describe('Logo', () => {
  test('reemplaza la gota dorada del header', async ({ page }) => {
    await page.evaluate(async ({ pixel, nombre }) => {
      App.showScreen('cuenta');
      App.renderNegocio();
      document.getElementById('negocio-nombre').value = nombre;
      App._negocio = App.getNegocio();
      App._negocio.logo = pixel;
      await App._guardarNegocioImpl();
    }, { pixel: PIXEL, nombre: 'Con Logo' });

    const drop = await page.evaluate(() => {
      const el = document.querySelector('#screen-inicio .logo-drop');
      return { clases: el.className, tieneImagen: el.style.backgroundImage.includes('data:image/') };
    });
    expect(drop.clases).toContain('con-logo');
    expect(drop.tieneImagen).toBe(true);
  });

  test('se puede quitar y vuelve la gota', async ({ page }) => {
    await page.evaluate(async ({ pixel }) => {
      App.showScreen('cuenta');
      App.renderNegocio();
      document.getElementById('negocio-nombre').value = 'Sin Logo';
      App._negocio = App.getNegocio();
      App._negocio.logo = pixel;
      await App._guardarNegocioImpl();
      await App.quitarLogoNegocio();
      await App._guardarNegocioImpl();
    }, { pixel: PIXEL });

    const drop = await page.evaluate(() => document.querySelector('#screen-inicio .logo-drop').className);
    expect(drop).not.toContain('con-logo');
    expect(await page.evaluate(() => App.getNegocio().logo)).toBe('');
  });

  test('ignora un logo que no sea una imagen', async ({ page }) => {
    // El sanitizador no puede aceptar cualquier string: iría a un src
    const r = await page.evaluate(() =>
      App._sanitizarNegocio({ nombre: 'X', logo: 'javascript:alert(1)' }).logo);
    expect(r).toBe('');
  });
});

test.describe('Dónde se usan los datos', () => {
  test('el catálogo de WhatsApp lleva el nombre y el contacto', async ({ page }) => {
    await completar(page, PERFIL);
    const msg = await page.evaluate(() => {
      let capturado = '';
      const orig = App.cobrarWhatsApp;
      App.cobrarWhatsApp = (m) => { capturado = m; };
      App._catalogoSelected = new Set(App.perfumes.slice(0, 2).map(p => p.id));
      App.enviarCatalogoTexto();
      App.cobrarWhatsApp = orig;
      return capturado;
    });
    console.log(msg);
    expect(msg).toContain('VIP Parfums');
    expect(msg).toContain('+598 94 466 577');
    expect(msg).toContain('vip@parfums.com');
    expect(msg).toContain('Av. 18 de Julio 1234, Montevideo');
  });

  test('sin datos de contacto no queda un pie vacío', async ({ page }) => {
    await completar(page, { nombre: 'Pelado' });
    const contacto = await page.evaluate(() => App._negocioContacto());
    expect(contacto).toBe('');
  });

  test('el contacto del PDF se arma en una línea', async ({ page }) => {
    await completar(page, PERFIL);
    const linea = await page.evaluate(() => App._negocioContacto({ separador: '  ·  ' }));
    expect(linea).not.toContain('\n');
    expect(linea).toContain('·');
  });
});

test.describe('Backup', () => {
  test('el perfil entra en el export y vuelve en el restore', async ({ page }) => {
    await completar(page, PERFIL);
    const backup = await page.evaluate(async () => {
      const config = await DB.getAll('config');
      return { config, settings: { perfilNegocio: App.getNegocio() } };
    });
    expect(backup.settings.perfilNegocio).toMatchObject(PERFIL);
    // Y viaja también en el store config, que es lo que restaura de verdad
    expect(backup.config.some(c => c.key === 'negocio')).toBe(true);

    // Borrarlo y restaurarlo desde el settings de respaldo
    await page.evaluate(async (b) => {
      await DB.setConfig('negocio', App._negocioVacio());
      await DB.setConfig('negocio', App._sanitizarNegocio(b.settings.perfilNegocio));
      await App.loadNegocio();
    }, backup);
    expect(await page.evaluate(() => App.getNegocio())).toMatchObject(PERFIL);
  });
});


test.describe('Nada asume Uruguay', () => {
  test('el teléfono guarda el código de país por separado', async ({ page }) => {
    await completar(page, PERFIL);
    const g = await page.evaluate(() => DB.getConfig('negocio'));
    expect(g.pais).toBe('+598');
    expect(g.telefono).toBe('94 466 577');
    // Y se muestra junto
    expect(await page.evaluate(() => App._telefonoCompleto(App.getNegocio()))).toBe('+598 94 466 577');
  });

  test('no guarda un número sin código de país', async ({ page }) => {
    // Un número suelto no sirve para escribirle desde otro país, que es
    // justo para lo que está en el catálogo
    await completar(page, { nombre: 'Sin Pais', telefono: '94466577' });
    expect(await page.evaluate(() => DB.getConfig('negocio'))).toBeNull();
  });

  test('respeta los perfiles viejos que tenían todo junto', async ({ page }) => {
    const r = await page.evaluate(() =>
      App._telefonoCompleto({ pais: '', telefono: '+54 11 5555 5555' }));
    expect(r).toBe('+54 11 5555 5555');
  });

  test('la lista de países cubre el mercado, no solo Uruguay', async ({ page }) => {
    const codigos = await page.evaluate(() => App._NEGOCIO_PAISES.map(p => p.codigo));
    // Los cuatro países objetivo del producto
    for (const c of ['+54', '+598', '+57', '+52']) expect(codigos).toContain(c);
    expect(codigos.length).toBeGreaterThan(10);
  });

  test('ningún placeholder asume un país', async ({ page }) => {
    const phs = await page.evaluate(() => {
      App.showScreen('cuenta');
      return ['nombre', 'telefono', 'email', 'direccion', 'ciudad', 'documento']
        .map(id => document.getElementById('negocio-' + id).placeholder).join(' | ');
    });
    console.log(phs);
    for (const prohibido of ['Montevideo', '+598', 'Uruguay', 'Siempre Viva']) {
      expect(phs, prohibido).not.toContain(prohibido);
    }
  });

  test('el documento no se llama solo RUT ni CUIT', async ({ page }) => {
    // En Colombia es NIT y en México RFC
    const ph = await page.evaluate(() => {
      App.showScreen('cuenta');
      return document.getElementById('negocio-documento').placeholder;
    });
    expect(ph).toContain('RFC');
    expect(ph).toContain('NIT');
  });

  test('el catálogo sin nombre no sale con la marca de la app', async ({ page }) => {
    // El cliente recibiría un catálogo que dice que el negocio se llama
    // "Parfum Track"
    const msg = await page.evaluate(async () => {
      await DB.setConfig('negocio', App._negocioVacio());
      await App.loadNegocio();
      localStorage.removeItem('pt_negocio');
      App._negocio.nombre = '';
      let capturado = '';
      const orig = App.cobrarWhatsApp;
      App.cobrarWhatsApp = (m) => { capturado = m; };
      App._catalogoSelected = new Set(App.perfumes.slice(0, 1).map(p => p.id));
      App.enviarCatalogoTexto();
      App.cobrarWhatsApp = orig;
      return capturado;
    });
    expect(msg).not.toContain('Parfum Track');
    expect(msg).toContain('Mi negocio');
  });
});

test.describe('Sin duplicados entre pantallas', () => {
  test('"Mi negocio" en Más lleva al perfil, no es otro input', async ({ page }) => {
    // Dos inputs escribiendo pt_negocio se desincronizan: el que editabas
    // último ganaba y el otro quedaba mostrando algo viejo
    await page.evaluate(() => App.setNombreNegocio('VIP Parfums'));
    await page.evaluate(() => App.showScreen('mas'));

    await expect(page.locator('#input-negocio')).toHaveCount(0);
    await expect(page.locator('#mas-negocio-valor')).toHaveText('VIP Parfums');

    await page.click('#mas-negocio-valor');
    await expect.poll(() => page.evaluate(() => App.currentScreen)).toBe('cuenta');
  });

  test('la fila de Más se actualiza al guardar el perfil', async ({ page }) => {
    await completar(page, { nombre: 'Nuevo Nombre' });
    await page.evaluate(() => App.showScreen('mas'));
    await expect(page.locator('#mas-negocio-valor')).toHaveText('Nuevo Nombre');
  });

  test('la moneda se movió al perfil y sigue funcionando', async ({ page }) => {
    // Es una decisión del negocio, no una preferencia suelta
    await page.evaluate(() => App.showScreen('cuenta'));
    await expect(page.locator('#negocio-form, .negocio-form')).toBeVisible();
    await page.selectOption('#sel-moneda', 'ARS');
    await expect.poll(() => page.evaluate(() => App._moneda)).toBe('ARS');
    expect(await page.evaluate(() => localStorage.getItem('pt_moneda'))).toBe('ARS');

    // Y ya no está suelta en Más
    const enMas = await page.evaluate(() =>
      document.querySelector('#screen-mas')?.contains(document.getElementById('sel-moneda')));
    expect(enMas).toBe(false);
  });
});
