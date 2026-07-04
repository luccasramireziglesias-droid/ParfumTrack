

  // ====== PIN LOCK ======
  async _hashPin(pin) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  _pinBuffer: '',

  checkPinOnStart() {
    const pin = localStorage.getItem('pt_pin');
    if (pin) {
      document.getElementById('lock-screen').classList.remove('hidden');
      document.getElementById('lock-screen').style.display = 'flex';
    }
    const toggle = document.getElementById('toggle-pin');
    const knob = document.getElementById('toggle-pin-knob');
    if (toggle && pin) {
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
      const saved = localStorage.getItem('pt_pin');
      const hashed = await this._hashPin(this._pinBuffer);
      if (hashed === saved || this._pinBuffer === saved) {
        document.getElementById('lock-screen').classList.add('hidden');
        document.getElementById('lock-screen').style.display = 'none';
        this._pinBuffer = '';
        this.haptic('success');
        if (this._pinBuffer !== saved && saved.length === 4) {
          localStorage.setItem('pt_pin', hashed);
        }
      } else {
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
        localStorage.setItem('pt_pin', hashed);
        knob.style.left = '23px';
        knob.style.background = 'var(--gold2)';
        knob.parentElement.querySelector('span:nth-child(2)').style.background = 'rgba(201,168,76,.3)';
        this.toast('PIN activado', 'lock');
      } else {
        document.getElementById('toggle-pin').checked = false;
        if (pin !== null) this.toast('El PIN debe tener 4 dígitos', 'warning');
      }
    } else {
      localStorage.removeItem('pt_pin');
      knob.style.left = '3px';
      knob.style.background = 'var(--text4)';
      knob.parentElement.querySelector('span:nth-child(2)').style.background = 'var(--card2)';
      this.toast('PIN desactivado', 'lock_open');
    }
  },
