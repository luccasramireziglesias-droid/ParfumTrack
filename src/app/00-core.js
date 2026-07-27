
  currentScreen: 'inicio',
  formaPago: 'contado',
  stockFilter: 'todos',
  perfumes: [],
  ventas: [],
  cuotasData: [],
  pedidosData: [],
  pedidosFilter: 'pendiente',
  pedidoPerfumes: [],
  cajaData: [],
  gastosData: [],
  cajaTipo: 'entrada',
  gastoCat: 'transporte',

  async init() {
    await DB.init();
    await DB.seedDemo();
    await DB.dedupEncryptedRecords();
    await this._fixCorruptDates();
    // Una sola lectura de cuotas para ambas migraciones (antes: 3 lecturas +
    // descifrado completo de la tabla en cada arranque)
    const cuotasInit = await DB.getAll('cuotas');
    const huboCambioIds = await this._fixStringCuotaIds(cuotasInit);
    await this._fixCuotasSaldadas(huboCambioIds ? null : cuotasInit);
    await this.loadData();
    this._initLang();
    this.loadMoneda();
    this.loadNombreNegocio();
    this.loadAccount();
    await this._initializeEncryption();
    this._initCsrfToken();
    this.checkPinOnStart();
    this.checkConsent();
    this.renderAll();
    this.registerSW();
    this._initTabSync();
    this._checkPendingLicense();
    this._initEventDelegation();
    this._initAutoUpdate();
    await this._initDOMContentLoaded();
  },

  _initEventDelegation() {
    // BUG #2 FIX: Event delegation para botones WhatsApp y Pago (evita XSS)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-whatsapp[data-msg]');
      if (btn) {
        e.preventDefault();
        try {
          // BUG #B-02 FIX: Validar base64 encoding antes de decodificar
          // UTF-8-safe: atob solo no soporta emojis del mensaje (fuera de Latin1)
          const msg = this.b64Decode(btn.dataset.msg);
          this.cobrarWhatsApp(msg);
        } catch (err) {
          console.error('Error decodificando mensaje WhatsApp:', err);
          this.toast('Error al procesar mensaje', 'error');
        }
      }

      const payBtn = e.target.closest('.btn-pay[data-cuota-id]');
      if (payBtn) {
        e.preventDefault();
        try {
          // El id viaja como JSON percent-encoded (soporta ids numéricos y
          // string sin romper el atributo HTML); fallback al valor crudo
          const raw = decodeURIComponent(payBtn.dataset.cuotaId);
          let cuotaId;
          try { cuotaId = JSON.parse(raw); } catch { cuotaId = raw; }
          this.abrirPagoCuota(cuotaId);
        } catch (err) {
          console.error('Error parseando cuota ID:', err);
          this.toast('Error al abrir pago de cuota', 'error');
        }
      }
    });
  },

  async _initCsrfToken() {
    const existing = localStorage.getItem('pt_csrf_token');
    if (existing) return;
    const token = await this._generateCsrfToken();
    localStorage.setItem('pt_csrf_token', token);
  },

  async _generateCsrfToken() {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const buf = await crypto.subtle.digest('SHA-256', randomBytes);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async _rotateCsrfToken() {
    const newToken = await this._generateCsrfToken();
    localStorage.setItem('pt_csrf_token', newToken);
    return newToken;
  },

  _getCsrfToken() {
    return localStorage.getItem('pt_csrf_token') || '';
  },

  _getCsrfHeaders() {
    return {
      'X-CSRF-Token': this._getCsrfToken()
    };
  },

  _checkPendingLicense() {
    try {
      const params = new URLSearchParams(location.search);
      const code = params.get('activate') || localStorage.getItem('pt_pending_license');
      if (code && /^PT-[A-Z0-9-]{6,}$/i.test(code)) {
        localStorage.removeItem('pt_pending_license');
        if (params.has('activate')) history.replaceState(null, '', location.pathname);
        setTimeout(() => {
          this.toast('Código de licencia detectado: ' + code, 'vpn_key');
          const el = document.getElementById('license-code-input');
          if (el) { el.value = code; }
        }, 1500);
      }
    } catch (_) { /* ignore */ }
  },

  _tabChannel: null,
  _initTabSync() {
    if (!('BroadcastChannel' in window)) return;
    this._tabChannel = new BroadcastChannel('pt_sync');
    this._tabChannel.onmessage = async (e) => {
      if (e.data === 'data_changed') {
        await this.loadData();
        this.renderAll();
      }
    };
  },
  _notifyTabs() {
    if (this._tabChannel) this._tabChannel.postMessage('data_changed');
  },

  async _fixCorruptDates() {
    if (localStorage.getItem('pt_dates_fixed_v3')) return;
    const ventas = await DB.getAll('ventas');
    for (const v of ventas) {
      if (!v.fecha || typeof v.fecha === 'string' || isNaN(new Date(v.fecha).getTime())) {
        v.fecha = this._parseDate(v.fecha, v.creado || Date.now());
        await DB.put('ventas', v);
      }
    }
    const cuotas = await DB.getAll('cuotas');
    for (const c of cuotas) {
      if (c.vence && (typeof c.vence === 'string' || isNaN(new Date(c.vence).getTime()))) {
        c.vence = this._parseDate(c.vence, Date.now());
        await DB.put('cuotas', c);
      }
    }
    localStorage.setItem('pt_dates_fixed_v3', '1');
  },

  // Sin flag one-time: los imports pueden reintroducir ids string en
  // cualquier momento. Idempotente — solo escribe si encuentra ids string.
  async _fixStringCuotaIds(cuotasPre) {
    // Recibe las cuotas ya leídas para no volver a leer+descifrar toda la tabla
    const cuotas = cuotasPre || await DB.getAll('cuotas');
    let cambio = false;
    for (const c of cuotas) {
      if (typeof c.id === 'string') {
        const copy = Object.assign({}, c);
        delete copy.id;
        await DB.delete('cuotas', c.id);
        await DB.add('cuotas', copy);
        cambio = true;
      }
    }
    return cambio;
  },

  // Sana cuotas que quedaron "atrapadas" como pendientes aunque la deuda ya
  // está cubierta (data vieja, imports duplicados). Corre en cada init: es
  // idempotente y solo escribe cuando encuentra algo que corregir.
  async _fixCuotasSaldadas(cuotasPre) {
    const cuotas = cuotasPre || await DB.getAll('cuotas');

    // BUG-03: acotar montoPagado > monto (datos viejos o backups adulterados)
    // que dejan el total "a cobrar" en negativo
    for (const c of cuotas) {
      if ((c.montoPagado || 0) > (c.monto || 0)) {
        c.montoPagado = c.monto || 0;
        c.pagado = true;
        await DB.put('cuotas', c);
      }
    }

    // 1) Cuota individualmente cubierta pero sin marcar como pagada
    for (const c of cuotas) {
      if (!c.pagado && (c.monto || 0) > 0 && (c.montoPagado || 0) >= c.monto - 0.01) {
        c.pagado = true;
        c.montoPagado = c.monto;
        await DB.put('cuotas', c);
      }
    }

    // 2) Venta cuyo total ya está cubierto entre todas sus cuotas (p.ej.
    //    cuotas duplicadas por un import): marcar las pendientes como pagadas
    const grupos = {};
    for (const c of cuotas) {
      // Sin ventaId no se puede saber a qué venta pertenece: agruparlas todas
      // bajo "undefined" mezclaría deudas de clientes distintos y podría
      // condonar plata que el usuario sí tiene que cobrar.
      if (c.ventaId === undefined || c.ventaId === null || c.ventaId === '') continue;
      const k = String(c.ventaId);
      if (!grupos[k]) grupos[k] = [];
      grupos[k].push(c);
    }
    for (const grupo of Object.values(grupos)) {
      const montoTotal = grupo[0].montoTotal || 0;
      if (montoTotal <= 0) continue;
      const totalPagado = grupo.reduce((s, c) => s + (c.pagado ? (c.monto || 0) : (c.montoPagado || 0)), 0);
      if (totalPagado >= montoTotal - 0.01) {
        for (const c of grupo) {
          if (!c.pagado) {
            c.pagado = true;
            c.montoPagado = c.monto;
            await DB.put('cuotas', c);
          }
        }
      }
    }
  },

  async loadData() {
    this.perfumes = await DB.getPerfumes();
    this.ventas = await DB.getVentas();
    this.cuotasData = await DB.getCuotas();
    this.pedidosData = await DB.getPedidos();
    this.cajaData = await DB.getCaja();
    this.gastosData = await DB.getGastos();
  },

  registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  },