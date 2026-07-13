

  // ====== GASTOS ======

  setGastoCat(cat) {
    this.gastoCat = cat;
    const opts = document.querySelectorAll('#gasto-cat-seg .seg-option');
    opts.forEach(o => o.classList.toggle('active', o.textContent.trim().toLowerCase() === cat));
    this._renderGastoChips();
  },

  // UX-8: chips con los gastos más repetidos de la categoría — un tap y guardar
  _renderGastoChips() {
    const wrap = document.getElementById('gasto-quick-chips');
    if (!wrap) return;
    const delCat = (this.gastosData || []).filter(g => g.categoria === this.gastoCat && g.monto > 0);
    // Frecuencia por combinación monto+descripción
    const freq = {};
    for (const g of delCat) {
      const key = g.monto + '|' + (g.descripcion || '');
      if (!freq[key]) freq[key] = { monto: g.monto, desc: g.descripcion || '', count: 0, ultima: 0 };
      freq[key].count++;
      if ((g.fecha || 0) > freq[key].ultima) freq[key].ultima = g.fecha || 0;
    }
    const top = Object.values(freq)
      .filter(f => f.count >= 2 || delCat.length <= 3)
      .sort((a, b) => b.count - a.count || b.ultima - a.ultima)
      .slice(0, 3);
    if (top.length === 0) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = top.map((f, i) =>
      `<span class="chip" data-chip-idx="${i}">${this.fmt(f.monto)}${f.desc && f.desc !== this.gastoCat ? ' · ' + this.esc(f.desc) : ''}</span>`
    ).join('');
    wrap.querySelectorAll('.chip').forEach((chip, i) => {
      chip.addEventListener('click', () => {
        document.getElementById('gasto-monto').value = top[i].monto;
        document.getElementById('gasto-desc').value = top[i].desc;
      });
    });
  },

  guardarGasto() {
    return this._once('gasto', () => this._guardarGastoImpl(), document.querySelector('#screen-gastos .btn-primary'));
  },

  async _guardarGastoImpl() {
    const monto = this.parseMonto(document.getElementById('gasto-monto').value) || 0;
    const desc = document.getElementById('gasto-desc').value.trim();
    if (monto <= 0) { this.toast('Ingresá un monto', 'warning'); return; }

    try {
      await DB.addGasto({ categoria: this.gastoCat, monto, descripcion: desc || this.gastoCat });
    } catch (e) {
      this.toast('Error al registrar gasto', 'error');
      return;
    }
    document.getElementById('gasto-monto').value = '';
    document.getElementById('gasto-desc').value = '';
    await this.loadData();
    this.renderGastos();
    this.toast('Gasto registrado', 'check_circle');
    this.haptic('success');
    this._notifyTabs();
  },

  async deleteGasto(id) {
    if (!await this.appConfirm('¿Eliminar este gasto?', 'Eliminar', 'delete')) return;
    try {
      await DB.deleteGasto(id);
    } catch (e) {
      this.toast('Error al eliminar el gasto', 'error');
      return;
    }
    await this.loadData();
    this.renderGastos();
    this.toast('Gasto eliminado', 'delete');
    this._notifyTabs();
  },

  renderGastos() {
    this._renderGastoChips();
    const now = new Date();
    const thisMonth = this.gastosData.filter(g => {
      const d = new Date(g.fecha);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const total = thisMonth.reduce((s, g) => s + g.monto, 0);
    document.getElementById('gastos-total').textContent = this.fmt(total);

    const container = document.getElementById('gastos-list');
    const recientes = this.gastosData.slice(0, 10);
    if (recientes.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="ms">payments</span><span>No hay gastos registrados</span></div>';
      return;
    }
    const catIcons = { transporte: 'local_shipping', embalaje: 'inventory', publicidad: 'campaign', envio_compra: 'local_shipping', otro: 'more_horiz' };
    const catLabels = { transporte: 'Transporte', embalaje: 'Embalaje', publicidad: 'Publicidad', envio_compra: 'Envío de compra', otro: 'Otro' };
    container.innerHTML = recientes.map(g => {
      const catLabel = catLabels[g.categoria] || g.categoria || 'otro';
      const desc = g.descripcion || (g.categoria !== 'otro' ? catLabel : null) || '—';
      return `
      <div class="venta-card" style="margin-bottom:8px;">
        <div class="venta-top">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
            <span class="ms gold">${catIcons[g.categoria] || 'payments'}</span>
            <div style="min-width:0;">
              <span class="venta-nombre" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.esc(desc)}</span>
              <div style="display:flex;gap:6px;margin-top:3px;">
                <span class="tag">${this.esc(catLabel)}</span>
                <span style="font:500 11px 'DM Sans';color:var(--text3);">${this.fmtDate(g.fecha)}</span>
              </div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font:700 16px 'DM Sans';color:var(--red);">${this.fmt(-g.monto)}</span>
            <button class="venta-action-btn ms" onclick="App.deleteGasto(${g.id})">delete</button>
          </div>
        </div>
      </div>
    `}).join('');
  },