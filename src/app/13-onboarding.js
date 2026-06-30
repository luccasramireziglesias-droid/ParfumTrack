

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