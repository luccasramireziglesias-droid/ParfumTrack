

  // ====== CUENTA / LICENCIA ======

  _account: null,

  _getDeviceId() {
    let id = localStorage.getItem('pt_device_id');
    if (!id) {
      id = 'dev_' + crypto.randomUUID();
      localStorage.setItem('pt_device_id', id);
    }
    return id;
  },

  loadAccount() {
    const saved = localStorage.getItem('pt_account');
    if (saved) {
      try { this._account = JSON.parse(saved); } catch { this._account = null; }
    }
    this.updatePlanUI();
  },

  saveAccount() {
    if (this._account) {
      localStorage.setItem('pt_account', JSON.stringify(this._account));
    } else {
      localStorage.removeItem('pt_account');
    }
    this.updatePlanUI();
  },

  isPro() {
    return !!(this._account?.license);
  },

  updatePlanUI() {
    const chip = document.getElementById('plan-chip');
    const icon = document.getElementById('plan-chip-icon');
    const label = document.getElementById('plan-chip-label');
    const masStatus = document.getElementById('mas-cuenta-status');

    if (this.isPro()) {
      icon.textContent = 'diamond';
      label.textContent = 'Pro';
      chip.style.background = 'linear-gradient(135deg, var(--gold), var(--gold2))';
      chip.style.color = '#1a1a2e';
      if (masStatus) masStatus.textContent = 'Pro activo';
    } else {
      icon.textContent = 'person';
      label.textContent = 'Free';
      chip.style.background = '';
      chip.style.color = '';
      if (masStatus) masStatus.textContent = this._account?.email || '';
    }

    this.updateCuentaScreen();
  },

  updateCuentaScreen() {
    const noLogin = document.getElementById('cuenta-no-login');
    const otpDiv = document.getElementById('cuenta-otp');
    const logged = document.getElementById('cuenta-logged');
    if (!noLogin) return;

    const isPro = this.isPro();
    const icon = document.getElementById('cuenta-plan-icon');
    const title = document.getElementById('cuenta-plan-title');
    const desc = document.getElementById('cuenta-plan-desc');
    const licenseSection = document.getElementById('cuenta-license-section');
    const badgeFree = document.getElementById('plan-badge-free');
    const badgePro = document.getElementById('plan-badge-pro');
    const btnSuscribir = document.getElementById('plan-btn-suscribir');
    const annualOpt = document.getElementById('plan-annual-option');

    if (isPro) {
      icon.textContent = 'workspace_premium';
      icon.style.color = 'var(--gold2)';
      title.textContent = 'Plan Pro';
      desc.textContent = 'Todas las funciones desbloqueadas.';
      licenseSection.classList.add('hidden');
      badgeFree.classList.add('hidden');
      badgePro.classList.remove('hidden');
      if (btnSuscribir) btnSuscribir.classList.add('hidden');
      if (annualOpt) annualOpt.classList.add('hidden');
    } else {
      icon.textContent = 'lock_open';
      icon.style.color = 'var(--gold2)';
      title.textContent = 'Plan Free';
      desc.textContent = 'Ventas, stock, cuotas, cobros WA, offline. Gratis para siempre.';
      licenseSection.classList.remove('hidden');
      badgeFree.classList.remove('hidden');
      badgePro.classList.add('hidden');
      if (btnSuscribir) btnSuscribir.classList.remove('hidden');
      if (annualOpt) annualOpt.classList.remove('hidden');
    }

    if (this._account?.email) {
      noLogin.classList.add('hidden');
      otpDiv.classList.add('hidden');
      logged.classList.remove('hidden');
      document.getElementById('cuenta-email-display').textContent = this._account.email;
      const loggedLicense = document.getElementById('cuenta-logged-license');
      if (loggedLicense) {
        loggedLicense.classList.toggle('hidden', isPro);
      }
    } else {
      noLogin.classList.remove('hidden');
      otpDiv.classList.add('hidden');
      logged.classList.add('hidden');
    }
  },

  async registrarCuenta() {
    const email = document.getElementById('cuenta-email').value.trim();
    if (!email || !email.includes('@')) {
      this.toast('Ingresá un email válido', 'warning');
      return;
    }
    this.toast('Enviando código…', 'hourglass_top');
    try {
      const res = await fetch('/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'register', email, deviceId: this._getDeviceId() })
      });
      const data = await res.json();
      if (data.sent) {
        this._pendingEmail = email;
        document.getElementById('cuenta-no-login').classList.add('hidden');
        document.getElementById('cuenta-otp').classList.remove('hidden');
        this.toast('Código enviado a tu email', 'mail');
      } else {
        this.toast(data.error || 'Error al enviar', 'error');
      }
    } catch {
      this.toast('Error de conexión', 'cloud_off');
    }
  },

  async verificarOTP() {
    const otp = document.getElementById('cuenta-otp-input').value.trim();
    if (otp.length !== 6) {
      this.toast('El código debe tener 6 dígitos', 'warning');
      return;
    }
    this.toast('Verificando…', 'hourglass_top');
    try {
      const res = await fetch('/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'verify', email: this._pendingEmail, otp, deviceId: this._getDeviceId() })
      });
      const data = await res.json();
      if (data.verified) {
        this._account = this._account || {};
        this._account.email = this._pendingEmail;
        this._account.deviceId = this._getDeviceId();
        this.saveAccount();
        this.toast('Cuenta verificada', 'check_circle');
        this.haptic('success');
        this.updatePlanUI();
      } else {
        this.toast(data.error || 'Código incorrecto', 'error');
      }
    } catch {
      this.toast('Error de conexión', 'cloud_off');
    }
  },

  async activarLicenciaInput() {
    const input = document.getElementById('cuenta-license-code');
    const code = input?.value?.trim();
    if (!code) { this.toast('Ingresá un código', 'warning'); return; }
    return this._activarLicencia(code);
  },

  async activarLicenciaLoggedInput() {
    const input = document.getElementById('cuenta-logged-license-code');
    const code = input?.value?.trim();
    if (!code) { this.toast('Ingresá un código', 'warning'); return; }
    return this._activarLicencia(code);
  },

  async activarLicencia() {
    const code = await this.appPrompt('Ingresá tu código de licencia:');
    if (!code) return;
    return this._activarLicencia(code.trim());
  },

  async _activarLicencia(code) {
    this.toast('Validando…', 'hourglass_top');
    try {
      const res = await fetch('/validate-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (data.valid) {
        this._account = this._account || {};
        this._account.license = code;
        this._account.licenseData = data;
        this.saveAccount();
        this.toast('Licencia activada', 'check_circle');
        this.haptic('success');
        ['cuenta-license-code', 'cuenta-logged-license-code'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        this.updatePlanUI();
      } else {
        this.toast(data.error || 'Licencia inválida', 'error');
      }
    } catch {
      this.toast('Error de conexión', 'cloud_off');
    }
  },

  async suscribirPro(plan) {
    this.track('click_subscribe', { plan });
    if (!this._account?.email) {
      this.toast('Registrá tu email abajo para suscribirte', 'warning');
      return;
    }
    this.toast('Creando pago…', 'hourglass_top');
    try {
      const res = await fetch('/mp-create-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this._account.email, plan })
      });
      const data = await res.json();
      if (data.ok && data.initPoint) {
        window.open(data.initPoint, '_blank');
        this.toast('Redirigiendo al pago…', 'payments');
      } else {
        this.toast(data.error || 'Error al crear pago', 'error');
      }
    } catch {
      this.toast('Error de conexión', 'cloud_off');
    }
  },

  async syncToCloud() {
    const code = this._account?.license;
    const token = this._getAuthToken();
    if (!code || !token) {
      this.toast('Activá una licencia primero', 'warning');
      return;
    }
    if (!await this.appConfirm('¿Subir datos a la nube? Esto reemplazará los datos guardados.', 'Subir', 'cloud_upload')) return;
    this.toast('Sincronizando…', 'cloud_upload');
    const config = await DB.getAll('config');
    const data = {
      perfumes: this.perfumes,
      ventas: this.ventas,
      cuotas: this.cuotasData,
      pedidos: this.pedidosData,
      caja: this.cajaData,
      gastos: this.gastosData,
      config,
      settings: {
        moneda: localStorage.getItem('pt_moneda'),
        negocio: localStorage.getItem('pt_negocio'),
        pin: localStorage.getItem('pt_pin'),
      }
    };
    try {
      const res = await fetch('/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, token, data })
      });
      const result = await res.json();
      if (result.ok) {
        this._account.lastSync = Date.now();
        this.saveAccount();
        this.toast('Datos sincronizados', 'check_circle');
        this.haptic('success');
      } else {
        this.toast(result.error || 'Error al sincronizar', 'error');
      }
    } catch {
      this.toast('Error de conexión', 'cloud_off');
    }
  },

  async syncFromCloud() {
    const code = this._account?.license;
    const token = this._getAuthToken();
    if (!code || !token) {
      this.toast('Activá una licencia primero', 'warning');
      return;
    }
    if (!await this.appConfirm('¿Cargar datos desde la nube? Esto reemplazará tus datos actuales.', 'Cargar', 'cloud_download')) return;
    this.toast('Descargando…', 'cloud_download');
    try {
      const res = await fetch('/sync', {
        headers: { 'X-PT-Code': code, 'X-PT-Token': token }
      });
      const result = await res.json();
      if (!result.ok) {
        this.toast(result.error || 'No se encontraron datos', 'error');
        return;
      }
      const data = this._normalizeBackupData(result.data || result);
      const { total, skipped } = await this._restoreData(data);
      this.toast(`${total} registros restaurados${skipped ? ` (${skipped} omitidos)` : ''}`, 'check_circle');
      this.haptic('success');
      this._notifyTabs();
    } catch {
      this.toast('Error de conexión', 'cloud_off');
    }
  },

  async cerrarSesion() {
    if (!await this.appConfirm('¿Cerrar sesión? Tus datos locales se mantienen.', 'Cerrar sesión', 'logout')) return;
    this._account = null;
    this.saveAccount();
    this.updatePlanUI();
    this.toast('Sesión cerrada', 'logout');
  },