

  // ====== NUEVA VENTA ======

  _checkVendedorRestriction() {
    const input = document.getElementById('venta-vendedor');
    const badge = document.getElementById('vendedor-pro-badge');
    const group = document.getElementById('vendedor-group');

    if (!this.isPro()) {
      // Free tier: deshabilitar vendedor
      input.disabled = true;
      input.value = 'Luccas';
      badge.style.display = 'inline-block';
      group.style.opacity = '0.6';
      group.title = 'Feature disponible en plan Pro';
    } else {
      // Pro: habilitar vendedor
      input.disabled = false;
      badge.style.display = 'none';
      group.style.opacity = '1';
      group.title = '';
    }
  },

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
    this.setPrimeraCuota(true);
    document.getElementById('venta-primer-pago').value = '';
    this.toggleVentaDetalles(false);
    this.calcLiveProfit();
    this.setupAutocomplete();
    this._checkVendedorRestriction();
    this._editingVentaId = null;
    const saveBtn = document.querySelector('#screen-nueva-venta .btn-primary');
    if (saveBtn) {
      saveBtn.innerHTML = '<span class="ms">save</span>Guardar venta';
      saveBtn.setAttribute('onclick', 'App.guardarVenta()');
    }
    const title = document.querySelector('#screen-nueva-venta .sub-title');
    if (title) title.textContent = 'Nueva venta';
  },

  // UX-4: campos secundarios (proveedor, vendedor, descuento, fecha, nota)
  // colapsados por defecto — el form rápido queda en 4 decisiones
  toggleVentaDetalles(forzar) {
    const panel = document.getElementById('venta-detalles');
    const toggle = document.getElementById('venta-detalles-toggle');
    if (!panel || !toggle) return;
    const abrir = forzar !== undefined ? forzar : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !abrir);
    toggle.classList.toggle('open', abrir);
    document.getElementById('venta-detalles-label').textContent = abrir ? 'Ocultar detalles' : 'Más detalles';
  },

  // UX-1: repetir una venta existente — abre el form prefillado (fecha = hoy,
  // cliente vacío: el caso típico es mismo perfume, otro cliente)
  repetirVenta(id) {
    const v = this.ventas.find(x => x.id === id);
    if (!v) return;
    this.showScreen('nueva-venta'); // resetea el form
    document.getElementById('venta-perfume-id').value = v.perfumeId || '';
    document.getElementById('venta-perfume-nombre').value = v.perfume;
    document.getElementById('venta-perfume-display').textContent = v.perfume;
    document.getElementById('venta-precio').value = v.precioOriginal || v.precioVenta;
    document.getElementById('venta-compra').value = v.precioCompra;
    document.getElementById('venta-proveedor').value = v.proveedor || '';
    if (v.vendedor) document.getElementById('venta-vendedor').value = v.vendedor;
    if (v.descuento) document.getElementById('venta-descuento').value = v.descuento;
    this.setFormaPago(v.formaPago === 'cuotas' ? 'cuotas' : 'contado');
    if (v.formaPago === 'cuotas' && v.numCuotas > 1) {
      document.getElementById('venta-num-cuotas').value = v.numCuotas;
    }
    this._checkVendedorRestriction();
    // Si la venta original usa campos secundarios, mostrarlos
    if (v.proveedor || v.descuento || v.nota) this.toggleVentaDetalles(true);
    this.calcLiveProfit();
    this.toast('Venta copiada — completá el cliente', 'content_copy');
    setTimeout(() => document.getElementById('venta-cliente').focus(), 150);
  },

  calcLiveProfit() {
    const pv = this.parseMonto(document.getElementById('venta-precio').value) || 0;
    const pc = this.parseMonto(document.getElementById('venta-compra').value) || 0;
    const desc = parseFloat(document.getElementById('venta-descuento').value) || 0;
    const pvFinal = desc > 0 ? Math.round(pv * (1 - desc / 100)) : pv;
    const gan = pvFinal - pc;
    const margen = pvFinal > 0 ? Math.round((gan / pvFinal) * 100) : 0;

    document.getElementById('live-ganancia').textContent = this.fmtSigned(gan);
    document.getElementById('live-venta').textContent = this.fmt(pvFinal);
    document.getElementById('live-compra').textContent = this.fmt(pc);
    document.getElementById('live-margen').textContent = margen + '%';

    // Sugerir el valor de la 1ª cuota como placeholder del primer pago
    const primerPagoInput = document.getElementById('venta-primer-pago');
    if (primerPagoInput) {
      const n = parseInt(document.getElementById('venta-num-cuotas').value) || 2;
      primerPagoInput.placeholder = pvFinal > 0 ? this.fmt(Math.round(pvFinal / n)) : '';
    }
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

    // BUG #1 FIX: Usar addEventListener en lugar de onclick inline para evitar XSS
    listEl.innerHTML = filtered.map(v => {
      return `<div class="ac-item" data-value="${this.esc(v)}">${this.esc(v)}</div>`;
    }).join('');

    // Agregar listeners a cada item
    listEl.querySelectorAll('.ac-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const input = document.getElementById(inputId);
        const list = document.getElementById(listId);
        if (input && list) {
          input.value = item.dataset.value;
          list.classList.add('hidden');
          this.calcLiveProfit();
        }
      });
    });

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

  _primeraCuotaPagada: true,

  setPrimeraCuota(pagada) {
    this._primeraCuotaPagada = pagada;
    const opts = document.querySelectorAll('#seg-primera-cuota .seg-option');
    if (opts.length === 2) {
      opts[0].classList.toggle('active', pagada);
      opts[1].classList.toggle('active', !pagada);
    }
    const wrap = document.getElementById('primer-pago-wrap');
    if (wrap) wrap.classList.toggle('hidden', !pagada);
    const input = document.getElementById('venta-primer-pago');
    if (input && !pagada) input.value = '';
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
    const precioVenta = this.parseMonto(document.getElementById('venta-precio').value) || 0;
    const precioCompra = this.parseMonto(document.getElementById('venta-compra').value) || 0;
    const cliente = document.getElementById('venta-cliente').value;
    let vendedor = document.getElementById('venta-vendedor').value;
    const proveedor = document.getElementById('venta-proveedor').value;
    const descuento = parseFloat(document.getElementById('venta-descuento').value) || 0;
    const fechaStr = document.getElementById('venta-fecha').value;
    // BUG #5 FIX: Usar 'Z' para UTC en lugar de hora local para evitar discrepancias de zona horaria
    const fecha = fechaStr ? new Date(fechaStr + 'T00:00:00Z').getTime() : Date.now();
    const nota = document.getElementById('venta-nota').value;
    const perfumeId = document.getElementById('venta-perfume-id').value;
    const numCuotas = parseInt(document.getElementById('venta-num-cuotas').value) || 2;
    const pvFinal = descuento > 0 ? Math.round(precioVenta * (1 - descuento / 100)) : precioVenta;

    // P-01 FIX: Multi-vendedor solo para Pro
    if (!this.isPro()) {
      vendedor = 'Luccas';
    }

    if (!perfume || perfume === 'Elegir perfume…') {
      this.toast('Elegí un perfume', 'warning');
      return;
    }
    if (precioVenta <= 0) {
      this.toast('Ingresá el precio de venta', 'warning');
      return;
    }

    // BUG #8 FIX: Validar descuento entre 0 y 100
    if (descuento < 0 || descuento > 100) {
      this.toast('Descuento debe estar entre 0 y 100%', 'warning');
      return;
    }

    // BUG #11 FIX: Validar número de cuotas entre 1 y 12
    if (numCuotas < 1 || numCuotas > 12) {
      this.toast('Cuotas debe estar entre 1 y 12', 'warning');
      return;
    }

    // Monto cobrado ahora (solo cuotas + "Cobrada ahora"): vacío = 1ª cuota completa
    let primerPago = null;
    if (this.formaPago === 'cuotas' && this._primeraCuotaPagada) {
      const raw = document.getElementById('venta-primer-pago').value.trim();
      if (raw !== '') {
        primerPago = this.parseMonto(raw);
        if (primerPago <= 0) {
          this.toast('El monto cobrado debe ser mayor a 0 (o elegí "Sin cobrar")', 'warning');
          return;
        }
        if (primerPago > pvFinal) {
          this.toast('El monto cobrado no puede superar el total de la venta', 'warning');
          return;
        }
      }
    }

    // Plan limit check: Free = max 10 pending cuotas
    if (!this.isPro() && this.formaPago === 'cuotas' && numCuotas > 1) {
      const pendingCuotas = this.cuotasData.filter(c => !c.pagado).length;
      const montoCuotaEst = Math.round(pvFinal / numCuotas) || 1;
      const cubiertas = !this._primeraCuotaPagada ? 0
        : (primerPago === null ? 1 : Math.min(numCuotas, Math.floor((primerPago + 0.01) / montoCuotaEst)));
      const newCuotasCount = numCuotas - cubiertas;
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
        primeraPagada: this._primeraCuotaPagada,
        primerPago,
        // BUG #7 FIX: Usar null en lugar de '' para perfumeId vacío
        perfumeId: perfumeId ? parseInt(perfumeId, 10) : null
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