
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
    await this._fixCorruptDates();
    await this._fixStringCuotaIds();
    await this.loadData();
    this.loadMoneda();
    this.loadNombreNegocio();
    this.loadAccount();
    this.checkPinOnStart();
    this.checkOnboarding();
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
          const msg = atob(btn.dataset.msg);
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
          // BUG #B-01 FIX: Validar JSON parsing de cuota ID
          const cuotaId = JSON.parse(payBtn.dataset.cuotaId);
          this.abrirPagoCuota(cuotaId);
        } catch (err) {
          console.error('Error parseando cuota ID:', err);
          this.toast('Error al abrir pago de cuota', 'error');
        }
      }
    });
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

  async _fixStringCuotaIds() {
    if (localStorage.getItem('pt_cuota_ids_fixed')) return;
    const cuotas = await DB.getAll('cuotas');
    for (const c of cuotas) {
      if (typeof c.id === 'string') {
        const copy = Object.assign({}, c);
        delete copy.id;
        await DB.delete('cuotas', c.id);
        await DB.add('cuotas', copy);
      }
    }
    localStorage.setItem('pt_cuota_ids_fixed', '1');
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