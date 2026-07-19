

  // ====== UTILS ======

  _moneda: '$',

  // Guarda anti doble-submit: evita que un doble/triple-toque en un botón
  // "Guardar" async ejecute la operación más de una vez. Envuelve el handler
  // y deshabilita el botón mientras corre.
  _saveGuards: {},
  async _once(key, fn, btnEl) {
    if (this._saveGuards[key]) return;
    this._saveGuards[key] = true;
    if (btnEl) btnEl.disabled = true;
    try {
      return await fn();
    } finally {
      this._saveGuards[key] = false;
      if (btnEl) btnEl.disabled = false;
    }
  },

  fmt(n, forceAbs) {
    const sep = this._moneda.length > 1 ? ' ' : '';
    if (n === undefined || n === null) return this._moneda + sep + '0';
    const abs = Math.abs(n).toLocaleString('es-AR');
    if (forceAbs) return this._moneda + sep + abs;
    if (n < 0) return '-' + this._moneda + sep + abs;
    return this._moneda + sep + abs;
  },

  fmtSigned(n) {
    const sep = this._moneda.length > 1 ? ' ' : '';
    const abs = Math.abs(n || 0).toLocaleString('es-AR');
    const sign = (n || 0) >= 0 ? '+' : '-';
    return sign + this._moneda + sep + abs;
  },

  async setMoneda(val) {
    this._moneda = val;
    localStorage.setItem('pt_moneda', val);
    this.renderAll();
    this.toast('Moneda actualizada', 'check_circle');
  },

  loadMoneda() {
    const saved = localStorage.getItem('pt_moneda');
    if (saved) {
      this._moneda = saved;
      const sel = document.getElementById('sel-moneda');
      if (sel) sel.value = saved;
    }
  },

  setNombreNegocio(val) {
    const name = val.trim();
    localStorage.setItem('pt_negocio', name);
    const logo = document.querySelector('.logo-text');
    if (logo) logo.textContent = name || 'Parfum Track';
  },

  loadNombreNegocio() {
    const saved = localStorage.getItem('pt_negocio');
    if (saved) {
      const input = document.getElementById('input-negocio');
      if (input) input.value = saved;
      const logo = document.querySelector('.logo-text');
      if (logo) logo.textContent = saved || 'Parfum Track';
    }
  },

  fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return d.getDate() + ' ' + months[d.getMonth()];
  },

  esc(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  },

  // Interpreta montos tipeados con separadores regionales: "1.400" (miles AR/UY),
  // "1400,50" (decimal con coma), "1.400,50", "$ 1400". parseFloat solo NO alcanza:
  // parseFloat("1.400") === 1.4
  parseMonto(str) {
    if (typeof str === 'number') return str;
    let s = String(str || '').trim().replace(/[^\d.,-]/g, '');
    if (!s) return 0;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot !== -1 && lastComma !== -1) {
      // Aparecen ambos: el último es el decimal, el otro es miles
      const dec = lastDot > lastComma ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      s = s.split(thou).join('');
      if (dec === ',') s = s.replace(',', '.');
    } else if (lastComma !== -1) {
      const decimales = s.length - lastComma - 1;
      // "1,400" o varias comas → miles; "1400,5"/"1400,50" → decimal
      if (decimales === 3 || s.split(',').length > 2) s = s.split(',').join('');
      else s = s.replace(',', '.');
    } else if (lastDot !== -1) {
      const decimales = s.length - lastDot - 1;
      // "1.400" o varios puntos → miles; "1400.5"/"1400.50" → decimal
      if (decimales === 3 || s.split('.').length > 2) s = s.split('.').join('');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  },

  // Base64 UTF-8-safe: btoa/atob solos lanzan InvalidCharacterError con emojis (fuera de Latin1)
  b64Encode(s) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  },

  b64Decode(b64) {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  },

  track(event, props) {
    if (window.plausible) window.plausible(event, props ? { props } : undefined);
  },

  toast(msg, icon) {
    const el = document.getElementById('toast');
    el.textContent = '';
    const span = document.createElement('span');
    span.className = 'ms';
    span.textContent = icon || 'info';
    el.appendChild(span);
    el.appendChild(document.createTextNode(this.t(msg)));
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  },

  haptic(type) {
    if (navigator.vibrate) {
      if (type === 'success') navigator.vibrate([10, 30, 10]);
      else if (type === 'warning') navigator.vibrate(50);
      else navigator.vibrate(10);
    }
  },

  appConfirm(msg, okLabel = 'Confirmar', icon = 'warning') {
    return new Promise((resolve) => {
      const modal = document.getElementById('modal-confirm');
      document.getElementById('confirm-msg').textContent = this.t(msg);
      document.getElementById('confirm-ok').textContent = this.t(okLabel);
      document.getElementById('confirm-icon').textContent = icon;
      modal.classList.remove('hidden');
      const cleanup = (val) => { modal.classList.add('hidden'); App._confirmResolve = null; App._confirmReject = null; resolve(val); };
      App._confirmResolve = () => cleanup(true);
      App._confirmReject = () => cleanup(false);
    });
  },

  appPrompt(msg, { inputMode = 'text', maxLength = 64, pattern = '' } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('modal-prompt');
      const input = document.getElementById('prompt-input');
      const error = document.getElementById('prompt-error');
      document.getElementById('prompt-msg').textContent = msg;
      input.value = '';
      input.inputMode = inputMode;
      if (maxLength) input.maxLength = maxLength;
      if (pattern) input.pattern = pattern;
      error.textContent = '';
      modal.classList.remove('hidden');
      setTimeout(() => input.focus(), 100);
      const cleanup = (val) => { modal.classList.add('hidden'); App._promptResolve = null; App._promptReject = null; resolve(val); };
      App._promptResolve = () => cleanup(input.value);
      App._promptReject = () => cleanup(null);
    });
  },