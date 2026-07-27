

  // ====== COMPRAS AL PROVEEDOR (F4) ======
  // Reponer stock a mano con el botón "+" no dejaba rastro de cuánto costó la
  // tanda. Sin ese dato, el "precio de compra" del perfume se vuelve un número
  // viejo y la ganancia deja de ser real.

  _compraPerfumeId: null,

  abrirCompra(perfumeId) {
    const p = this.perfumes.find(x => x.id === perfumeId);
    if (!p) {
      this.toast('No se encontró el perfume', 'error');
      return;
    }
    this._compraPerfumeId = perfumeId;

    document.getElementById('compra-perfume').textContent = p.nombre;
    document.getElementById('compra-stock-actual').textContent = `${Math.max(0, p.stock || 0)} en stock`;
    document.getElementById('compra-cantidad').value = '1';
    // El costo anterior es el mejor punto de partida: normalmente se repite
    document.getElementById('compra-precio').value = p.precioCompra || '';
    document.getElementById('compra-proveedor').value = this._defaultProveedor();
    document.getElementById('compra-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('compra-nota').value = '';
    document.getElementById('compra-actualiza-costo').checked = true;

    this.calcTotalCompra();
    document.getElementById('modal-compra').classList.remove('hidden');
  },

  cerrarCompra() {
    document.getElementById('modal-compra').classList.add('hidden');
    this._compraPerfumeId = null;
  },

  _getCantidadCompra() {
    const el = document.getElementById('compra-cantidad');
    const n = parseInt((el?.value || '1').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 1;
  },

  cambiarCantidadCompra(delta) {
    const el = document.getElementById('compra-cantidad');
    if (!el) return;
    el.value = Math.max(1, Math.min(9999, this._getCantidadCompra() + delta));
    this.calcTotalCompra();
    this.haptic();
  },

  calcTotalCompra() {
    const cant = this._getCantidadCompra();
    const precio = this.parseMonto(document.getElementById('compra-precio').value) || 0;
    const el = document.getElementById('compra-total');
    if (el) el.textContent = this.fmt(precio * cant);

    // Cuánto queda en stock después de esta compra
    const p = this.perfumes.find(x => x.id === this._compraPerfumeId);
    const hint = document.getElementById('compra-stock-final');
    if (hint && p) hint.textContent = `Queda en ${Math.max(0, p.stock || 0) + cant}`;
  },

  registrarCompra() {
    // Anti doble-tap: dos toques sumaban la tanda dos veces al inventario
    return this._once('compra', () => this._registrarCompraImpl(),
      document.getElementById('compra-confirmar'));
  },

  async _registrarCompraImpl() {
    const perfumeId = this._compraPerfumeId;
    if (!perfumeId) return;

    const cantidad = this._getCantidadCompra();
    const precioUnitario = this.parseMonto(document.getElementById('compra-precio').value) || 0;
    const proveedor = document.getElementById('compra-proveedor').value.trim();
    const nota = (document.getElementById('compra-nota').value || '').trim().slice(0, 300);
    const actualizarCosto = document.getElementById('compra-actualiza-costo').checked;
    const fechaStr = document.getElementById('compra-fecha').value;
    const fecha = fechaStr ? new Date(fechaStr + 'T00:00:00Z').getTime() : Date.now();

    if (precioUnitario <= 0) {
      this.toast('Ingresá el precio de compra por unidad', 'warning');
      return;
    }
    if (precioUnitario > 1e9) {
      this.toast('El monto es demasiado grande (máx mil millones)', 'warning');
      return;
    }

    try {
      await DB.registrarCompra({ perfumeId, cantidad, precioUnitario, proveedor, fecha, nota, actualizarCosto });
    } catch (e) {
      this.toast('Error al registrar la compra', 'error');
      return;
    }

    if (proveedor) localStorage.setItem('pt_ultimo_proveedor', proveedor);
    this.cerrarCompra();
    await this.loadData();
    this.renderStock();
    this.renderAll();
    this.toast(`+${cantidad} al stock por ${this.fmt(precioUnitario * cantidad)}`, 'local_shipping');
    this.haptic('success');
    this._notifyTabs();
  },

  async eliminarCompra(id) {
    const c = this.comprasData.find(x => x.id === id);
    if (!c) return;
    if (!await this.appConfirm(`¿Borrar la compra de ${c.cantidad} × ${c.perfume}? Se descuentan del stock.`, 'Borrar', 'delete')) return;
    try {
      await DB.eliminarCompra(id);
    } catch (e) {
      this.toast('Error al borrar la compra', 'error');
      return;
    }
    await this.loadData();
    this.renderStock();
    this.renderAll();
    this.toast('Compra borrada', 'delete');
    this._notifyTabs();
  },

  _COMPRAS_VISIBLES: 5,

  renderCompras() {
    const section = document.getElementById('stock-compras');
    const list = document.getElementById('stock-compras-list');
    if (!section || !list) return;

    const compras = this.comprasData || [];
    if (compras.length === 0) {
      section.classList.add('hidden');
      list.innerHTML = '';
      return;
    }

    // Invertido total del mes: lo que salió de la caja para reponer
    const ahora = new Date();
    const delMes = compras.filter(c => {
      const d = new Date(c.fecha || 0);
      return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear();
    });
    const totalMes = delMes.reduce((s, c) => s + (c.total || 0), 0);
    const resumen = document.getElementById('stock-compras-resumen');
    if (resumen) {
      resumen.textContent = totalMes > 0
        ? `${this.fmt(totalMes)} invertidos este mes`
        : 'Sin compras este mes';
    }

    section.classList.remove('hidden');
    list.innerHTML = compras.slice(0, this._COMPRAS_VISIBLES).map(c => `
      <div class="compra-row">
        <div class="compra-info">
          <div class="compra-nombre">${this.esc(c.perfume || '—')} <span class="compra-cant">×${c.cantidad}</span></div>
          <div class="compra-meta">${this.fmtDate(c.fecha)}${c.proveedor ? ` · ${this.esc(c.proveedor)}` : ''} · ${this.fmt(c.precioUnitario)} c/u</div>
        </div>
        <span class="compra-total">${this.fmt(c.total)}</span>
        <button class="compra-del ms" onclick="App.eliminarCompra(${c.id})" aria-label="Borrar compra">delete</button>
      </div>`).join('');
  },
