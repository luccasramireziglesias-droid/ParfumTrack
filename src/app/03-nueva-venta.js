

  // ====== NUEVA VENTA ======

  resetVentaForm() {
    document.getElementById('venta-perfume-id').value = '';
    document.getElementById('venta-perfume-nombre').value = '';
    document.getElementById('venta-perfume-display').textContent = 'Elegir perfume…';
    document.getElementById('venta-precio').value = '';
    document.getElementById('venta-compra').value = '';
    document.getElementById('venta-cliente').value = '';
    document.getElementById('venta-vendedor').value = 'Luccas';
    document.getElementById('venta-proveedor').value = '';
    document.getElementById('venta-descuento').value = '';
    document.getElementById('venta-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('venta-nota').value = '';
    this.setFormaPago('contado');
    this.calcLiveProfit();
    this.setupAutocomplete();
    this._editingVentaId = null;
    const saveBtn = document.querySelector('#screen-nueva-venta .btn-primary');
    if (saveBtn) {
      saveBtn.innerHTML = '<span class="ms">save</span>Guardar venta';
      saveBtn.setAttribute('onclick', 'App.guardarVenta()');
    }
    const title = document.querySelector('#screen-nueva-venta .sub-title');
    if (title) title.textContent = 'Nueva venta';
  },

  calcLiveProfit() {
    const pv = parseFloat(document.getElementById('venta-precio').value) || 0;
    const pc = parseFloat(document.getElementById('venta-compra').value) || 0;
    const desc = parseFloat(document.getElementById('venta-descuento').value) || 0;
    const pvFinal = desc > 0 ? Math.round(pv * (1 - desc / 100)) : pv;
    const gan = pvFinal - pc;
    const margen = pvFinal > 0 ? Math.round((gan / pvFinal) * 100) : 0;

    document.getElementById('live-ganancia').textContent = this.fmtSigned(gan);
    document.getElementById('live-venta').textContent = this.fmt(pvFinal);
    document.getElementById('live-compra').textContent = this.fmt(pc);
    document.getElementById('live-margen').textContent = margen + '%';
  },

  setupAutocomplete() {
    const fields = [
      { input: 'venta-cliente', list: 'ac-cliente', key: 'cliente' },
      { input: 'venta-vendedor', list: 'ac-vendedor', key: 'vendedor' },
      { input: 'venta-proveedor', list: 'ac-proveedor', key: 'proveedor' }
    ];
    fields.forEach(f => {
      const el = document.getElementById(f.input);
      el.removeEventListener('input', el._acHandler);
      el._acHandler = () => this.showAutocomplete(f.input, f.list, f.key);
      el.addEventListener('input', el._acHandler);
      el.addEventListener('focus', el._acHandler);
      el.addEventListener('blur', () => setTimeout(() => {
        document.getElementById(f.list).classList.add('hidden');
      }, 200));
    });
  },

  showAutocomplete(inputId, listId, key) {
    const val = document.getElementById(inputId).value.toLowerCase();
    const listEl = document.getElementById(listId);
    const values = [...new Set(this.ventas.map(v => v[key]).filter(Boolean))];
    const filtered = val ? values.filter(v => v.toLowerCase().includes(val)) : values.slice(0, 5);

    if (filtered.length === 0) { listEl.classList.add('hidden'); return; }
    listEl.innerHTML = filtered.map(v => {
      const safe = this.esc(v).replace(/'/g, '&#39;');
      return `<div class="ac-item" onmousedown="document.getElementById('${inputId}').value='${safe}';document.getElementById('${listId}').classList.add('hidden');App.calcLiveProfit()">${this.esc(v)}</div>`;
    }).join('');
    listEl.classList.remove('hidden');
  },

  setFormaPago(tipo) {
    this.formaPago = tipo;
    const opts = document.querySelectorAll('#seg-forma-pago .seg-option');
    opts.forEach(o => {
      o.classList.toggle('active', o.textContent.trim().toLowerCase() === tipo);
    });
    document.getElementById('cuotas-config').classList.toggle('hidden', tipo !== 'cuotas');
  },

  openPerfumeSelector() {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-perfume-search').value = '';
    this.renderPerfumeModal();
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  },

  renderPerfumeModal() {
    const search = (document.getElementById('modal-perfume-search')?.value || '').toLowerCase();
    let items = this.perfumes;
    if (search) items = items.filter(p => p.nombre.toLowerCase().includes(search));

    document.getElementById('modal-perfume-list').innerHTML = items.map(p =>
      `<div class="modal-item" onclick="App.selectPerfume(${p.id})">
        <div>
          <div class="modal-item-name">${this.esc(p.nombre)}</div>
          <div class="modal-item-stock">Stock: ${p.stock}</div>
        </div>
        <span class="modal-item-price">${this.fmt(p.precioVenta)}</span>
      </div>`
    ).join('');
  },

  filterPerfumeModal() {
    this.renderPerfumeModal();
  },

  selectPerfume(id) {
    const p = this.perfumes.find(x => x.id === id);
    if (!p) return;
    document.getElementById('venta-perfume-id').value = p.id;
    document.getElementById('venta-perfume-nombre').value = p.nombre;
    document.getElementById('venta-perfume-display').textContent = p.nombre;
    document.getElementById('venta-precio').value = p.precioVenta;
    document.getElementById('venta-compra').value = p.precioCompra;
    this.calcLiveProfit();
    this.closeModal();
  },

  async guardarVenta() {
    const perfume = document.getElementById('venta-perfume-nombre').value || document.getElementById('venta-perfume-display').textContent;
    const precioVenta = parseFloat(document.getElementById('venta-precio').value) || 0;
    const precioCompra = parseFloat(document.getElementById('venta-compra').value) || 0;
    const cliente = document.getElementById('venta-cliente').value;
    const vendedor = document.getElementById('venta-vendedor').value;
    const proveedor = document.getElementById('venta-proveedor').value;
    const descuento = parseFloat(document.getElementById('venta-descuento').value) || 0;
    const fechaStr = document.getElementById('venta-fecha').value;
    const fecha = fechaStr ? new Date(fechaStr + 'T12:00:00').getTime() : Date.now();
    const nota = document.getElementById('venta-nota').value;
    const perfumeId = document.getElementById('venta-perfume-id').value;
    const numCuotas = parseInt(document.getElementById('venta-num-cuotas').value) || 2;
    const pvFinal = descuento > 0 ? Math.round(precioVenta * (1 - descuento / 100)) : precioVenta;

    if (!perfume || perfume === 'Elegir perfume…') {
      this.toast('Elegí un perfume', 'warning');
      return;
    }
    if (precioVenta <= 0) {
      this.toast('Ingresá el precio de venta', 'warning');
      return;
    }

    // Plan limit check: Free = max 10 pending cuotas
    if (!this.isPro() && this.formaPago === 'cuotas' && numCuotas > 1) {
      const pendingCuotas = this.cuotasData.filter(c => !c.pagado).length;
      const newCuotasCount = numCuotas - 1; // Primera cuota se marca pagada
      if (pendingCuotas + newCuotasCount > 10) {
        this.appConfirm(
          'Límite de cuotas alcanzado',
          `Plan Free: máx 10 cuotas pendientes. Tenés ${pendingCuotas} pendientes y querés agregar ${newCuotasCount}.\n\nActualiza a Básico Pro para ilimitadas.`,
          'Actualizar plan',
          'Cancelar'
        ).then(result => {
          if (result) this.showScreen('cuenta');
        });
        return;
      }
    }

    try {
      await DB.addVenta({
        perfume,
        precioVenta: pvFinal,
        precioOriginal: precioVenta,
        precioCompra,
        cliente: cliente || 'Anónimo',
        vendedor: vendedor || 'Anónimo',
        proveedor: proveedor || '',
        descuento,
        nota,
        fecha,
        formaPago: this.formaPago,
        numCuotas: this.formaPago === 'cuotas' ? numCuotas : 1,
        perfumeId: perfumeId ? parseInt(perfumeId) : ''
      });
    } catch (e) {
      this.toast('Error al guardar la venta. Intentá de nuevo.', 'error');
      return;
    }

    await this.loadData();
    this.track('sale_created', { method: this.formaPago });
    this.toast('Venta guardada', 'check_circle');
    this.haptic('success');
    this._notifyTabs();
    this.showScreen('inicio');
  },