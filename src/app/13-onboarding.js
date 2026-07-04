

  // ====== CONSENT & ONBOARDING ======

  checkConsent() {
    if (!localStorage.getItem('pt_consent_accepted')) {
      const el = document.getElementById('consent-modal');
      el.style.display = 'flex';
    } else {
      this.checkOnboarding();
    }
  },

  acceptConsent() {
    const terms = document.getElementById('consent-terms').checked;
    const privacy = document.getElementById('consent-privacy').checked;
    const cookies = document.getElementById('consent-cookies').checked;
    const marketing = document.getElementById('consent-marketing').checked;

    if (!terms || !privacy || !cookies) {
      document.getElementById('consent-error').textContent = 'Debes aceptar todos los términos para continuar';
      return;
    }

    localStorage.setItem('pt_consent_accepted', '1');
    localStorage.setItem('pt_consent_date', new Date().toISOString());
    localStorage.setItem('pt_consent_marketing', marketing ? '1' : '0');
    document.getElementById('consent-modal').style.display = 'none';
    this.checkOnboarding();
  },

  rejectConsent() {
    if (confirm('Si rechazas, no podrás usar Parfum Track. ¿Estás seguro?')) {
      document.getElementById('consent-modal').style.display = 'none';
      document.getElementById('onboarding').classList.remove('hidden');
      document.getElementById('onboarding').innerHTML = `
        <div style="text-align:center;color:var(--gold2);font-size:16px;">
          <div class="logo-drop" style="width:64px;height:64px;margin-bottom:20px;"></div>
          <p style="margin-bottom:20px;">No pudimos continuar sin tu consentimiento.</p>
          <button class="btn-primary" onclick="window.location.href='/'">Volver al inicio</button>
        </div>
      `;
    }
  },

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