

  // ====== PIN LOCK ======
  async _hashPin(pin) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  _pinBuffer: '',

  // El hash (SHA-256, nunca el PIN en claro) vive en localStorage para que
  // sobreviva al cierre de la app. Solo la verificación de la sesión actual
  // va en sessionStorage, así vuelve a pedir el PIN en cada apertura.
  _getPinHash() {
    // Migración: versiones viejas guardaban el hash en sessionStorage
    const legacy = sessionStorage.getItem('pt_pin_hash');
    const stored = localStorage.getItem('pt_pin_hash');
    if (!stored && legacy) {
      localStorage.setItem('pt_pin_hash', legacy);
      return legacy;
    }
    return stored;
  },

  checkPinOnStart() {
    // Verificar si PIN está ACTIVADO (guardado en localStorage)
    const pinEnabled = localStorage.getItem('pt_pin_enabled') === '1';
    // Verificar si ya ingresó PIN en ESTA sesión (sessionStorage)
    const pinVerified = sessionStorage.getItem('pt_pin_verified') === '1';
    const savedHash = this._getPinHash();

    // FAIL-OPEN: si el PIN figura activado pero no hay hash recuperable, el
    // usuario quedaría encerrado para siempre (ningún PIN podría coincidir).
    // Preferimos abrir la app y desactivar el PIN antes que perder sus datos.
    if (pinEnabled && !savedHash) {
      localStorage.removeItem('pt_pin_enabled');
      setTimeout(() => this.toast('El PIN se desactivó por seguridad. Volvé a activarlo si querés.', 'lock_open'), 1200);
      return;
    }

    if (pinEnabled && !pinVerified) {
      // PIN activado pero no verificado en esta sesión → mostrar lock screen
      document.getElementById('lock-screen').classList.remove('hidden');
      document.getElementById('lock-screen').style.display = 'flex';
    }

    const toggle = document.getElementById('toggle-pin');
    const knob = document.getElementById('toggle-pin-knob');
    if (toggle && pinEnabled) {
      toggle.checked = true;
      knob.style.left = '23px';
      knob.style.background = 'var(--gold2)';
      knob.parentElement.querySelector('span:nth-child(2)').style.background = 'rgba(201,168,76,.3)';
    }
  },

  async pinInput(n) {
    if (this._pinBuffer.length >= 4) return;
    this._pinBuffer += n;
    this._updatePinDots();
    if (this._pinBuffer.length === 4) {
      // Obtener PIN hasheado guardado (localStorage: sobrevive al cierre de la app)
      const savedHash = this._getPinHash();
      const hashed = await this._hashPin(this._pinBuffer);

      // Comparar: hash de entrada vs hash guardado
      if (hashed === savedHash) {
        // PIN correcto → desbloquear
        document.getElementById('lock-screen').classList.add('hidden');
        document.getElementById('lock-screen').style.display = 'none';
        sessionStorage.setItem('pt_pin_verified', '1');
        this._pinBuffer = '';
        this.haptic('success');
      } else {
        // PIN incorrecto
        document.getElementById('pin-error').textContent = 'PIN incorrecto';
        this.haptic('warning');
        setTimeout(() => {
          this._pinBuffer = '';
          this._updatePinDots();
          document.getElementById('pin-error').textContent = '';
        }, 800);
      }
    }
  },

  pinDelete() {
    this._pinBuffer = this._pinBuffer.slice(0, -1);
    this._updatePinDots();
  },

  _updatePinDots() {
    const dots = document.querySelectorAll('#pin-dots .pin-dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < this._pinBuffer.length));
  },

  async togglePin(on) {
    const knob = document.getElementById('toggle-pin-knob');
    if (on) {
      const pin = await this.appPrompt('Creá un PIN de 4 dígitos:', { inputMode: 'numeric', maxLength: 4, pattern: '\\d{4}' });
      if (pin && /^\d{4}$/.test(pin)) {
        const hashed = await this._hashPin(pin);
        // Ambos en localStorage: el flag y el hash SHA-256 (nunca el PIN en
        // claro). Si el hash fuera a sessionStorage, al reabrir la app no
        // habría con qué comparar y el usuario quedaría bloqueado.
        localStorage.setItem('pt_pin_enabled', '1');
        localStorage.setItem('pt_pin_hash', hashed);
        sessionStorage.setItem('pt_pin_verified', '1');
        knob.style.left = '23px';
        knob.style.background = 'var(--gold2)';
        knob.parentElement.querySelector('span:nth-child(2)').style.background = 'rgba(201,168,76,.3)';
        this.toast('PIN activado', 'lock');
      } else {
        document.getElementById('toggle-pin').checked = false;
        if (pin !== null) this.toast('El PIN debe tener 4 dígitos', 'warning');
      }
    } else {
      // Desactivar PIN
      localStorage.removeItem('pt_pin_enabled');
      localStorage.removeItem('pt_pin_hash');
      sessionStorage.removeItem('pt_pin_hash');
      sessionStorage.removeItem('pt_pin_verified');
      knob.style.left = '3px';
      knob.style.background = 'var(--text4)';
      knob.parentElement.querySelector('span:nth-child(2)').style.background = 'var(--card2)';
      this.toast('PIN desactivado', 'lock_open');
    }
  },
