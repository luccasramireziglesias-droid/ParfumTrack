

  // ====== ONBOARDING ======

  checkOnboarding() {
    if (!localStorage.getItem('pt_onboarded')) {
      const el = document.getElementById('onboarding');
      el.classList.remove('hidden');
      el.style.display = 'flex';
    }
  },

  dismissOnboarding() {
    localStorage.setItem('pt_onboarded', '1');
    const el = document.getElementById('onboarding');
    el.classList.add('hidden');
    el.style.display = 'none';
  },

  showTutorial() {
    const el = document.getElementById('onboarding');
    el.classList.remove('hidden');
    el.style.display = 'flex';
    const steps = el.querySelectorAll('.onb-step');
    steps.forEach((s, i) => s.style.display = i === 0 ? 'flex' : 'none');
  },

  // ====== CONSENTIMIENTO (TÉRMINOS, PRIVACIDAD, COOKIES) ======

  checkConsent() {
    if (!localStorage.getItem('pt_consent_accepted')) {
      const modal = document.getElementById('modal-consent');
      if (modal) {
        modal.classList.remove('hidden');
        this._setupConsentListeners();
      }
    }
  },

  _setupConsentListeners() {
    const termsChk = document.getElementById('consent-terms');
    const privacyChk = document.getElementById('consent-privacy');
    const cookiesChk = document.getElementById('consent-cookies');
    const acceptBtn = document.getElementById('consent-btn-accept');

    const updateButtonState = () => {
      const allChecked = termsChk?.checked && privacyChk?.checked && cookiesChk?.checked;
      if (acceptBtn) {
        acceptBtn.disabled = !allChecked;
        acceptBtn.style.opacity = allChecked ? '1' : '0.5';
        acceptBtn.style.cursor = allChecked ? 'pointer' : 'not-allowed';
      }
    };

    [termsChk, privacyChk, cookiesChk].forEach(el => {
      if (el) el.addEventListener('change', updateButtonState);
    });
  },

  acceptConsent() {
    const termsChk = document.getElementById('consent-terms');
    const privacyChk = document.getElementById('consent-privacy');
    const cookiesChk = document.getElementById('consent-cookies');
    const emailChk = document.getElementById('consent-email');

    if (termsChk?.checked && privacyChk?.checked && cookiesChk?.checked) {
      const consentData = {
        accepted: true,
        timestamp: Date.now(),
        terms: true,
        privacy: true,
        cookies: true,
        email: emailChk?.checked || false
      };
      localStorage.setItem('pt_consent_accepted', JSON.stringify(consentData));
      const modal = document.getElementById('modal-consent');
      if (modal) modal.classList.add('hidden');
      this.toast('Términos aceptados', 'check_circle');
    }
  },

  rejectConsent() {
    this.toast('Debes aceptar los términos para usar la app', 'warning');
  },