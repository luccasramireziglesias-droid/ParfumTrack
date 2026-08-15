import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Import + Dashboard Month Navigation', () => {
  let mockApp;
  let backupData;

  // Las ventas del backup son de JUNIO 2026. Antes el test hacía
  // `changeDashboardMonth(-1)` a secas, dando por sentado que "hoy" era julio: el 1 de
  // agosto empezó a fallar solo, sin que nadie tocara nada, porque ese -1 caía en julio y
  // ahí no hay ventas. Ahora se calcula cuántos meses hay que retroceder de verdad.
  const MES_DEL_BACKUP = 5;   // junio, 0-indexed
  const ANIO_DEL_BACKUP = 2026;

  /** Retrocede mes a mes hasta junio 2026, como haría alguien tocando la flecha. */
  const irAlMesDelBackup = (app) => {
    const hoy = new Date();
    const pasos = (hoy.getFullYear() - ANIO_DEL_BACKUP) * 12 + (hoy.getMonth() - MES_DEL_BACKUP);
    app.resetDashboardMonth();
    // De a un paso: el mock solo sabe envolver el año en saltos de ±1.
    for (let i = 0; i < pasos; i++) app.changeDashboardMonth(-1);
    return pasos;
  };

  beforeEach(() => {
    // Mock backup data (similar to the JSON file)
    backupData = {
      ventas: [
        {
          id: 1782046899159484,
          perfume: 'The kingdom',
          precioVenta: 2600,
          precioCompra: 1890,
          fecha: '21/06/2026',
          createdAt: 1782046899159,
        },
        {
          id: 1782046877669825,
          perfume: 'The kingdom',
          precioVenta: 2600,
          precioCompra: 1890,
          fecha: '21/06/2026',
          createdAt: 1782046877669,
        },
        {
          id: 1781962633765515,
          perfume: 'Liquid brun limited edition',
          precioVenta: 3700,
          precioCompra: 2700,
          fecha: '20/06/2026',
          createdAt: 1781962633765,
        },
        {
          id: 1781962516905625,
          perfume: 'Cdn intense',
          precioVenta: 2800,
          precioCompra: 1700,
          fecha: '20/06/2026',
          createdAt: 1781962516905,
        },
      ],
      perfumes: [],
      cuotas: [],
      pedidos: [],
      caja: [],
      gastos: [],
    };

    // Mock document
    global.document = {
      querySelector: vi.fn((selector) => {
        if (selector === 'meta[name="app-version"]') {
          return { content: '1.1.0' };
        }
        return null;
      }),
      getElementById: vi.fn((id) => ({
        textContent: '',
        innerHTML: '',
        classList: { add: vi.fn(), remove: vi.fn() },
      })),
      querySelectorAll: vi.fn(() => []),
    };

    // Simple mock App object
    mockApp = {
      ventas: [],
      _dashboardMonth: null,
      _dashboardYear: null,

      _parseDate(v, fallback) {
        if (!v) return fallback;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
          if (/^\d+$/.test(v)) return Number(v);
          const dmy = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
          if (dmy) {
            const ms = new Date(+dmy[3], +dmy[2] - 1, +dmy[1], 12).getTime();
            return isNaN(ms) ? fallback : ms;
          }
          const ms = new Date(v).getTime();
          return isNaN(ms) ? fallback : ms;
        }
        return fallback;
      },

      // Simulate import
      importVentas(data) {
        this.ventas = data.ventas.map(v => ({
          ...v,
          precioVenta: Number(v.precioVenta) || 0,
          precioCompra: Number(v.precioCompra) || 0,
          fecha: this._parseDate(v.fecha, Date.now()),
        }));
      },

      // Dashboard logic
      changeDashboardMonth(offset) {
        const now = new Date();
        if (!this._dashboardMonth) this._dashboardMonth = now.getMonth();
        if (!this._dashboardYear) this._dashboardYear = now.getFullYear();

        this._dashboardMonth += offset;
        if (this._dashboardMonth > 11) {
          this._dashboardMonth = 0;
          this._dashboardYear += 1;
        } else if (this._dashboardMonth < 0) {
          this._dashboardMonth = 11;
          this._dashboardYear -= 1;
        }
      },

      resetDashboardMonth() {
        this._dashboardMonth = null;
        this._dashboardYear = null;
      },

      // Calculate ganancia for selected month
      getMonthGanancia() {
        const now = new Date();
        const displayMonth = this._dashboardMonth ?? now.getMonth();
        const displayYear = this._dashboardYear ?? now.getFullYear();

        const thisMonth = this.ventas.filter(v => {
          const d = new Date(v.fecha);
          return d.getMonth() === displayMonth && d.getFullYear() === displayYear;
        });

        return thisMonth.reduce((s, v) => s + (v.precioVenta - v.precioCompra), 0);
      },

      getMonthVentasCount() {
        const now = new Date();
        const displayMonth = this._dashboardMonth ?? now.getMonth();
        const displayYear = this._dashboardYear ?? now.getFullYear();

        return this.ventas.filter(v => {
          const d = new Date(v.fecha);
          return d.getMonth() === displayMonth && d.getFullYear() === displayYear;
        }).length;
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('debe importar ventas correctamente', () => {
    mockApp.importVentas(backupData);
    expect(mockApp.ventas).toHaveLength(4);
  });

  it('debe parsear fechas del backup correctamente', () => {
    mockApp.importVentas(backupData);
    const venta = mockApp.ventas[0];
    expect(venta.fecha).toBeDefined();
    expect(typeof venta.fecha).toBe('number');

    // Verificar que es junio 2026
    const d = new Date(venta.fecha);
    expect(d.getMonth()).toBe(5); // junio (0-indexed)
    expect(d.getFullYear()).toBe(2026);
  });

  it('debe convertir precios a números', () => {
    mockApp.importVentas(backupData);
    const venta = mockApp.ventas[0];
    expect(typeof venta.precioVenta).toBe('number');
    expect(typeof venta.precioCompra).toBe('number');
    expect(venta.precioVenta).toBe(2600);
    expect(venta.precioCompra).toBe(1890);
  });

  it('debe mostrar 0 ganancias en el mes actual', () => {
    mockApp.importVentas(backupData);
    mockApp.resetDashboardMonth();
    // El backup es de junio 2026: mientras el mes actual no sea ese, no hay ventas.
    const hoy = new Date();
    const estamosEnJunio2026 =
      hoy.getMonth() === MES_DEL_BACKUP && hoy.getFullYear() === ANIO_DEL_BACKUP;
    expect(mockApp.getMonthGanancia()).toBe(estamosEnJunio2026 ? 3520 : 0);
  });

  it('debe mostrar ganancias correctas cuando navega a junio', () => {
    mockApp.importVentas(backupData);
    irAlMesDelBackup(mockApp);

    const ganancia = mockApp.getMonthGanancia();
    // Ganancias: (2600-1890) + (2600-1890) + (3700-2700) + (2800-1700)
    // = 710 + 710 + 1000 + 1100 = 3520
    expect(ganancia).toBe(3520);
  });

  it('debe contar 4 ventas en junio', () => {
    mockApp.importVentas(backupData);
    irAlMesDelBackup(mockApp);

    const count = mockApp.getMonthVentasCount();
    expect(count).toBe(4);
  });

  it('debe poder navegar múltiples meses hacia atrás', () => {
    mockApp.importVentas(backupData);
    irAlMesDelBackup(mockApp);          // junio 2026
    mockApp.changeDashboardMonth(-1);   // mayo
    mockApp.changeDashboardMonth(-1);   // abril

    const ganancia = mockApp.getMonthGanancia();
    expect(ganancia).toBe(0); // mayo/abril no tienen ventas
  });

  it('debe poder volver al mes actual', () => {
    mockApp.importVentas(backupData);
    mockApp.changeDashboardMonth(-5); // ir muy atrás
    mockApp.resetDashboardMonth(); // volver a hoy

    const ganancia = mockApp.getMonthGanancia();
    expect(ganancia).toBe(0); // hoy es julio, sin ventas
  });

  it('debe mantener correctas las ganancias al navegarse entre meses', () => {
    mockApp.importVentas(backupData);

    // Ida: hasta junio 2026, donde están las 4 ventas
    irAlMesDelBackup(mockApp);
    expect(mockApp.getMonthGanancia()).toBe(3520);

    // Un mes adelante: julio 2026, sin ventas
    mockApp.changeDashboardMonth(1);
    expect(mockApp.getMonthGanancia()).toBe(0);

    // Y de vuelta a junio: el total tiene que ser el mismo que la primera vez
    mockApp.changeDashboardMonth(-1);
    expect(mockApp.getMonthGanancia()).toBe(3520);
  });
});
