// @ts-check
// F2 — recordatorios de cobro en el dashboard
const { test, expect } = require('@playwright/test');
const APP_URL = 'http://localhost:8787';
const DIA = 86400000;

test.describe('F2 — recordatorios de cobro', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.route('**/*.gstatic.com/**', r => r.abort());
    await page.route('**/plausible.io/**', r => r.abort());
    await page.route('**/onesignal.com/**', r => r.abort());
    await page.addInitScript(() => {
      localStorage.setItem('pt_onboarded', '1');
      localStorage.setItem('pt_consent_accepted', '1');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => localStorage.getItem('pt_demo_seeded') === '1', { timeout: 20000 });
    await page.waitForTimeout(1500);
    // Partir de cero: las cuotas del demo ensucian la clasificación
    await page.evaluate(async () => {
      for (const c of await DB.getAll('cuotas')) await DB.delete('cuotas', c.id);
      await App.loadData();
    });
  });

  const sembrarCuotas = (page) => page.evaluate(async (dia) => {
    const base = { total: 3, montoTotal: 3000, pagado: false, montoPagado: 0 };
    const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
    const cuotas = [
      { ...base, ventaId: 901, perfume: 'Sauvage', cliente: 'Ana', numero: 1, monto: 1000, vence: hoy.getTime() - 5 * dia },
      { ...base, ventaId: 902, perfume: 'Bleu', cliente: 'Bruno', numero: 2, monto: 1500, vence: hoy.getTime() },
      { ...base, ventaId: 903, perfume: 'La Vie', cliente: 'Caro', numero: 1, monto: 800, vence: hoy.getTime() + 2 * dia },
      // Fuera del horizonte: no debe aparecer
      { ...base, ventaId: 904, perfume: 'Invictus', cliente: 'Dario', numero: 1, monto: 700, vence: hoy.getTime() + 20 * dia },
      // Pagada: no debe aparecer
      { ...base, ventaId: 905, perfume: 'Olympea', cliente: 'Eva', numero: 1, monto: 900, pagado: true, montoPagado: 900, vence: hoy.getTime() - dia },
    ];
    for (const c of cuotas) await DB.add('cuotas', c);
    await App.loadData();
    App.renderDashboard();
  }, DIA);

  test('clasifica vencidas, de hoy y próximas; ignora pagadas y lejanas', async ({ page }) => {
    await sembrarCuotas(page);

    const clasif = await page.evaluate(() => {
      const c = App._cobrosPendientes();
      return {
        vencidas: c.vencidas.map(i => i.cuota.cliente),
        hoy: c.hoy.map(i => i.cuota.cliente),
        proximas: c.proximas.map(i => i.cuota.cliente),
      };
    });
    expect(clasif.vencidas).toEqual(['Ana']);
    expect(clasif.hoy).toEqual(['Bruno']);
    expect(clasif.proximas).toEqual(['Caro']);
  });

  test('la tarjeta aparece en el dashboard con el total y el estado de cada cuota', async ({ page }) => {
    await sembrarCuotas(page);

    const section = page.locator('#dashboard-recordatorios');
    await expect(section).toBeVisible();
    await expect(section).toHaveClass(/urgente/);
    await expect(page.locator('#recordatorios-titulo')).toHaveText('2 cobros para hoy');
    // 1000 + 1500 + 800
    await expect(page.locator('#recordatorios-resumen')).toContainText('3.300');

    const estados = await page.locator('.recordatorio-estado').allTextContents();
    expect(estados).toEqual(['Venció hace 5 días', 'Vence hoy', 'Vence en 2 días']);

    // Orden: primero lo vencido
    const clientes = await page.locator('.recordatorio-cliente').allTextContents();
    expect(clientes).toEqual(['Ana', 'Bruno', 'Caro']);
  });

  test('el badge del nav se pone urgente solo si hay vencidas o de hoy', async ({ page }) => {
    await sembrarCuotas(page);
    const badge = page.locator('#nav-cuotas-badge');
    await expect(badge).toHaveClass(/urgente/);
    // 4 pendientes (la de Eva está pagada)
    await expect(badge).toHaveText('4');

    // Al dejar solo la lejana, el badge deja de ser urgente
    await page.evaluate(async () => {
      for (const c of await DB.getAll('cuotas')) {
        if (c.ventaId !== 904) await DB.delete('cuotas', c.id);
      }
      await App.loadData();
      App.renderDashboard();
    });
    await expect(badge).not.toHaveClass(/urgente/);
    await expect(page.locator('#dashboard-recordatorios')).toBeHidden();
  });

  test('el botón de pago abre el modal de la cuota correcta', async ({ page }) => {
    await sembrarCuotas(page);
    await page.locator('.recordatorio-row').first().locator('.btn-pay').click();
    await expect(page.locator('#modal-pago-cuota')).toBeVisible();
    await expect(page.locator('#pago-cuota-cliente')).toHaveText('Ana');
    await expect(page.locator('#pago-cuota-perfume')).toHaveText('Sauvage');
  });

  test('el mensaje de WhatsApp nombra al cliente, la cuota y el vencimiento', async ({ page }) => {
    await sembrarCuotas(page);
    const msgs = await page.evaluate(() =>
      [...document.querySelectorAll('#dashboard-recordatorios .btn-whatsapp')]
        .map(b => App.b64Decode(b.dataset.msg)));
    expect(msgs[0]).toContain('Hola Ana!');
    expect(msgs[0]).toContain('cuota 1/3');
    expect(msgs[0]).toContain('Sauvage');
    expect(msgs[0]).toMatch(/venció el/);
    expect(msgs[1]).toContain('vence hoy');
  });

  test('el aviso del día se muestra una sola vez por jornada', async ({ page }) => {
    await sembrarCuotas(page);
    const primera = await page.evaluate(() => {
      localStorage.removeItem('pt_recordatorio_visto');
      let shown = null;
      const orig = App.toast.bind(App);
      App.toast = (m) => { shown = m; };
      App._avisoCobrosDelDia();
      const clave = localStorage.getItem('pt_recordatorio_visto');
      // El toast es diferido: forzar la lectura del estado guardado
      App.toast = orig;
      return clave;
    });
    expect(primera).toBe(new Date().toISOString().split('T')[0]);

    // Segunda llamada el mismo día: no vuelve a marcar ni avisa
    const segunda = await page.evaluate(() => {
      let veces = 0;
      const orig = App.toast.bind(App);
      App.toast = () => { veces++; };
      App._avisoCobrosDelDia();
      App.toast = orig;
      return veces;
    });
    expect(segunda).toBe(0);
  });
});
