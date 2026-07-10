

  // ====== CAJA ======

  setCajaTipo(tipo) {
    this.cajaTipo = tipo;
    const opts = document.querySelectorAll('#caja-tipo-seg .seg-option');
    opts.forEach((o, i) => o.classList.toggle('active', (i === 0 && tipo === 'entrada') || (i === 1 && tipo === 'salida')));
  },

  async guardarCaja() {
    const monto = this.parseMonto(document.getElementById('caja-monto').value) || 0;
    const desc = document.getElementById('caja-desc').value.trim();
    if (monto <= 0) { this.toast('Ingresá un monto', 'warning'); return; }

    try {
      await DB.addCaja({ tipo: this.cajaTipo, monto, descripcion: desc || (this.cajaTipo === 'entrada' ? 'Entrada' : 'Salida') });
    } catch (e) {
      this.toast('Error al registrar movimiento', 'error');
      return;
    }
    document.getElementById('caja-monto').value = '';
    document.getElementById('caja-desc').value = '';
    await this.loadData();
    this.renderCaja();
    this.toast(this.cajaTipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada', 'check_circle');
    this.haptic('success');
    this._notifyTabs();
  },

  async deleteCaja(id) {
    if (!await this.appConfirm('¿Eliminar este movimiento?', 'Eliminar', 'delete')) return;
    try {
      await DB.deleteCaja(id);
    } catch (e) {
      this.toast('Error al eliminar el movimiento', 'error');
      return;
    }
    await this.loadData();
    this.renderCaja();
    this.toast('Movimiento eliminado', 'delete');
    this._notifyTabs();
  },

  renderCaja() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayItems = this.cajaData.filter(c => new Date(c.fecha) >= today);
    const entradas = todayItems.filter(c => c.tipo === 'entrada').reduce((s, c) => s + c.monto, 0);
    const salidas = todayItems.filter(c => c.tipo === 'salida').reduce((s, c) => s + c.monto, 0);

    document.getElementById('caja-entradas').textContent = this.fmt(entradas);
    document.getElementById('caja-salidas').textContent = this.fmt(salidas);
    const balance = entradas - salidas;
    const balEl = document.getElementById('caja-balance');
    const sign = balance >= 0 ? '+' : '-';
    const prefix = this._moneda + (this._moneda.length > 1 ? ' ' : '');
    balEl.textContent = prefix + sign + Math.abs(balance).toLocaleString('es-AR');
    balEl.style.color = balance >= 0 ? 'var(--green)' : 'var(--red)';

    const container = document.getElementById('caja-list');
    if (todayItems.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="ms">account_balance</span><span>No hay movimientos hoy</span></div>';
      return;
    }
    container.innerHTML = todayItems.map(c => {
      const isEntrada = c.tipo === 'entrada';
      return `<div class="venta-card" style="margin-bottom:8px;">
        <div class="venta-top">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="ms ${isEntrada ? 'green' : 'danger'}">${isEntrada ? 'arrow_downward' : 'arrow_upward'}</span>
            <span class="venta-nombre">${this.esc(c.descripcion)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font:700 16px 'DM Sans';color:${isEntrada ? 'var(--green)' : 'var(--red)'};">${this.fmt(isEntrada ? c.monto : -c.monto)}</span>
            <button class="venta-action-btn ms" onclick="App.deleteCaja(${c.id})">delete</button>
          </div>
        </div>
      </div>`;
    }).join('');
  },