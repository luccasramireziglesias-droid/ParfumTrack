// ====== AUTO-UPDATE (Versionado + Actualización automática) ======

  _updateCheckInterval: null,
  _currentVersion: null,
  _latestVersion: null,

  // Inicializar verificación automática de actualizaciones
  async _initAutoUpdate() {
    // Obtener versión actual del meta tag
    const versionMeta = document.querySelector('meta[name="app-version"]');
    this._currentVersion = versionMeta?.content || '1.0.0';

    // Verificar versión al iniciar
    await this._checkForUpdates();

    // Verificar cada 5 minutos
    this._updateCheckInterval = setInterval(() => {
      this._checkForUpdates().catch(err => console.warn('Update check failed:', err.message));
    }, 5 * 60 * 1000); // 5 minutos
  },

  // Verificar si hay actualización disponible
  async _checkForUpdates() {
    try {
      const response = await fetch('/version', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      this._latestVersion = data.version;


      // Si hay versión más nueva, recargar
      if (this._isNewerVersion(this._latestVersion, this._currentVersion)) {
        this._reloadWithNewVersion();
      }
    } catch (err) {
      console.warn('Failed to check for updates:', err.message);
    }
  },

  // Comparar versiones (true si version1 > version2)
  _isNewerVersion(version1, version2) {
    const v1 = version1.split('.').map(Number);
    const v2 = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const num1 = v1[i] || 0;
      const num2 = v2[i] || 0;
      if (num1 > num2) return true;
      if (num1 < num2) return false;
    }

    return false;
  },

  // Recargar con nueva versión
  _reloadWithNewVersion() {
    // Limpiar interval
    if (this._updateCheckInterval) {
      clearInterval(this._updateCheckInterval);
      this._updateCheckInterval = null;
    }

    // Opción 1: Recargar inmediatamente (agresivo)
    // window.location.reload();

    // Opción 2: Notificar al usuario (amigable)
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--gold2);
      color: var(--bg);
      padding: 16px;
      text-align: center;
      font-weight: 600;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      animation: slideUp 0.3s ease-out;
    `;
    banner.innerHTML = `
      <span class="ms" style="font-size: 20px;">system_update</span>
      <span>Actualización disponible</span>
      <button onclick="window.location.reload()" style="
        background: var(--bg);
        color: var(--gold2);
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
        margin-left: 12px;
      ">Recargar</button>
    `;

    // Agregar estilos de animación si no existen
    if (!document.getElementById('pt-auto-update-styles')) {
      const style = document.createElement('style');
      style.id = 'pt-auto-update-styles';
      style.textContent = `
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(banner);

    // Recargar automáticamente pasado un rato, PERO nunca encima de alguien que
    // está cargando datos: perdería la venta a medio escribir. Si hay trabajo
    // en curso, se deja el aviso y que recargue cuando quiera.
    setTimeout(() => {
      if (this._hayTrabajoEnCurso()) return;
      window.location.reload();
    }, 30000);
  },

  // ¿El usuario está en medio de algo que se perdería con una recarga?
  _hayTrabajoEnCurso() {
    // Un formulario con datos escritos, o un modal abierto
    const camposConTexto = ['venta-perfume-nombre', 'venta-precio', 'venta-cliente',
      'gasto-monto', 'gasto-desc', 'caja-monto', 'add-perfume-nombre', 'pedido-nombre'];
    for (const id of camposConTexto) {
      const el = document.getElementById(id);
      if (el && String(el.value || '').trim() !== '') return true;
    }
    const modalAbierto = [...document.querySelectorAll('.modal-overlay')]
      .some(m => !m.classList.contains('hidden'));
    if (modalAbierto) return true;
    // También si está tipeando ahora mismo
    const a = document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
  },

  // Limpiar interval al desmontar
  _cleanupAutoUpdate() {
    if (this._updateCheckInterval) {
      clearInterval(this._updateCheckInterval);
      this._updateCheckInterval = null;
    }
  },
