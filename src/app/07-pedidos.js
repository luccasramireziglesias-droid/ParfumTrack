

  // ====== PEDIDOS ======

  renderPedidos() {
    const pendientes = this.pedidosData.filter(p => p.estado === 'pendiente');
    const enviados = this.pedidosData.filter(p => p.estado === 'enviado');

    document.getElementById('pedidos-count-pend').textContent = pendientes.length;
    document.getElementById('pedidos-count-env').textContent = enviados.length;

    const items = this.pedidosFilter === 'pendiente' ? pendientes : enviados;
    const container = document.getElementById('pedidos-list');

    if (items.length === 0) {
      const msg = this.pedidosFilter === 'pendiente' ? 'No hay pedidos pendientes' : 'No hay pedidos enviados';
      container.innerHTML = `<div class="empty-state"><span class="ms">package_2</span><span>${msg}</span></div>`;
      return;
    }

    container.innerHTML = items.map(p => {
      const chips = (p.perfumes || []).map(pf =>
        `<span class="pedido-producto-chip">${this.esc(pf.nombre)} × ${pf.cantidad}</span>`
      ).join('');

      const fecha = this.fmtDate(p.fecha);
      const isPendiente = p.estado === 'pendiente';

      return `<div class="pedido-card" onclick="App.showPedidoDetalle(${p.id})">
        <div class="pedido-card-top">
          <div>
            <div class="pedido-card-nombre">${this.esc(p.nombre)}</div>
            <div class="pedido-card-fecha">${fecha} · ${this.esc(p.transporte || '—')}</div>
          </div>
          <span class="pedido-status-badge ${p.estado}">${isPendiente ? 'Pendiente' : 'Enviado'}</span>
        </div>
        <div class="pedido-chips">${chips || '<span style="color:var(--text3);font-size:13px;">Sin perfumes</span>'}</div>
        <div class="pedido-card-actions" onclick="event.stopPropagation()">
          ${isPendiente
            ? `<button class="btn-enviar" onclick="App.marcarPedidoEnviado(${p.id})"><span class="ms">local_shipping</span>Marcar enviado</button>`
            : `<button class="btn-revertir" onclick="App.marcarPedidoPendiente(${p.id})"><span class="ms">undo</span>Revertir</button>`
          }
          <button class="btn-delete-pedido" onclick="App.editPedido(${p.id})" style="background:var(--gold-dim);color:var(--gold2);"><span class="ms">edit</span></button>
          <button class="btn-delete-pedido" onclick="App.deletePedido(${p.id})"><span class="ms">delete</span></button>
        </div>
      </div>`;
    }).join('');

    this.updatePedidosBadge();
  },

  filterPedidos(estado) {
    this.pedidosFilter = estado;
    const opts = document.querySelectorAll('#pedidos-filter .seg-option');
    opts.forEach((o, i) => {
      o.classList.toggle('active', (i === 0 && estado === 'pendiente') || (i === 1 && estado === 'enviado'));
    });
    this.renderPedidos();
  },

  resetPedidoForm() {
    document.getElementById('pedido-nombre').value = '';
    document.getElementById('pedido-cedula').value = '';
    document.getElementById('pedido-transporte').value = '';
    document.getElementById('pedido-direccion').value = '';
    document.getElementById('pedido-nota').value = '';
    this.pedidoPerfumes = [];
    this.renderPedidoPerfumesList();
    this._editingPedidoId = null;
    const saveBtn = document.querySelector('#screen-nuevo-pedido .btn-primary');
    if (saveBtn) {
      saveBtn.innerHTML = '<span class="ms">save</span>Guardar pedido';
      saveBtn.setAttribute('onclick', 'App.guardarPedido()');
    }
    const title = document.querySelector('#screen-nuevo-pedido .sub-title');
    if (title) title.textContent = 'Nuevo pedido';
  },

  renderPedidoPerfumesList() {
    const container = document.getElementById('pedido-perfumes-list');
    if (this.pedidoPerfumes.length === 0) {
      container.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;">Ningún perfume agregado</div>';
      return;
    }

    container.innerHTML = this.pedidoPerfumes.map((pf, idx) =>
      `<div class="pedido-perfume-item">
        <div class="pedido-perfume-info">
          <span class="pedido-perfume-name">${this.esc(pf.nombre)}</span>
          <span class="pedido-perfume-price">${this.fmt(pf.precioVenta)}</span>
        </div>
        <div class="pedido-perfume-controls">
          <button class="pedido-qty-btn minus" onclick="App.adjustPedidoPerfumeQty(${idx}, -1)"><span class="ms">remove</span></button>
          <span class="pedido-qty-display">${pf.cantidad}</span>
          <button class="pedido-qty-btn plus" onclick="App.adjustPedidoPerfumeQty(${idx}, 1)"><span class="ms">add</span></button>
          <button class="pedido-remove-btn" onclick="App.removePerfumeFromPedido(${idx})"><span class="ms">close</span></button>
        </div>
      </div>`
    ).join('');
  },

  openPedidoPerfumeSelector() {
    document.getElementById('modal-pedido-perfume').classList.remove('hidden');
    document.getElementById('modal-pedido-perfume-search').value = '';
    this.renderPedidoPerfumeModal();
  },

  closePedidoPerfumeSelector() {
    document.getElementById('modal-pedido-perfume').classList.add('hidden');
  },

  renderPedidoPerfumeModal() {
    const search = (document.getElementById('modal-pedido-perfume-search')?.value || '').toLowerCase();
    let items = this.perfumes;
    if (search) items = items.filter(p => p.nombre.toLowerCase().includes(search));

    document.getElementById('modal-pedido-perfume-list').innerHTML = items.map(p =>
      `<div class="modal-item" onclick="App.addPerfumeToPedido(${p.id})">
        <div>
          <div class="modal-item-name">${this.esc(p.nombre)}</div>
          <div class="modal-item-stock">Stock: ${p.stock}</div>
        </div>
        <span class="modal-item-price">${this.fmt(p.precioVenta)}</span>
      </div>`
    ).join('');
  },

  filterPedidoPerfumeModal() {
    this.renderPedidoPerfumeModal();
  },

  addPerfumeToPedido(id) {
    const p = this.perfumes.find(x => x.id === id);
    if (!p) return;

    const existing = this.pedidoPerfumes.find(x => x.id === id);
    if (existing) {
      existing.cantidad++;
    } else {
      this.pedidoPerfumes.push({ id: p.id, nombre: p.nombre, precioVenta: p.precioVenta, cantidad: 1 });
    }

    this.renderPedidoPerfumesList();
    this.closePedidoPerfumeSelector();
  },

  removePerfumeFromPedido(idx) {
    this.pedidoPerfumes.splice(idx, 1);
    this.renderPedidoPerfumesList();
  },

  adjustPedidoPerfumeQty(idx, delta) {
    const pf = this.pedidoPerfumes[idx];
    if (!pf) return;
    pf.cantidad = Math.max(1, pf.cantidad + delta);
    this.renderPedidoPerfumesList();
  },

  guardarPedido() {
    return this._once('pedido', () => this._guardarPedidoImpl(), document.querySelector('#screen-nuevo-pedido .btn-primary'));
  },

  async _guardarPedidoImpl() {
    const nombre = document.getElementById('pedido-nombre').value.trim();
    const cedula = document.getElementById('pedido-cedula').value.trim();
    const transporte = document.getElementById('pedido-transporte').value.trim();
    const direccion = document.getElementById('pedido-direccion').value.trim();
    const nota = document.getElementById('pedido-nota').value.trim();

    if (!nombre) {
      this.toast('Ingresá el nombre', 'warning');
      return;
    }
    if (!cedula) {
      this.toast('Ingresá la cédula / DNI', 'warning');
      return;
    }
    if (!transporte) {
      this.toast('Ingresá la empresa de transporte', 'warning');
      return;
    }
    if (this.pedidoPerfumes.length === 0) {
      this.toast('Agregá al menos un perfume', 'warning');
      return;
    }

    try {
      await DB.addPedido({
        nombre,
        cedula,
        transporte,
        direccion,
        nota,
        perfumes: this.pedidoPerfumes.map(pf => ({ id: pf.id, nombre: pf.nombre, precioVenta: pf.precioVenta, cantidad: pf.cantidad }))
      });
    } catch (e) {
      this.toast('Error al guardar el pedido', 'error');
      return;
    }

    await this.loadData();
    this.toast('Pedido guardado', 'check_circle');
    this.haptic('success');
    this._notifyTabs();
    this.showScreen('pedidos');
  },

  async marcarPedidoEnviado(id) {
    try {
      await DB.marcarEnviado(id);
    } catch (e) {
      this.toast('Error al actualizar el pedido', 'error');
      return;
    }
    await this.loadData();
    this.renderPedidos();
    this.updatePedidosBadge();
    this.toast('Pedido marcado como enviado', 'local_shipping');
    this.haptic('success');
  },

  async marcarPedidoPendiente(id) {
    try {
      await DB.marcarPendiente(id);
    } catch (e) {
      this.toast('Error al actualizar el pedido', 'error');
      return;
    }
    await this.loadData();
    this.renderPedidos();
    this.updatePedidosBadge();
    this.toast('Pedido revertido a pendiente', 'undo');
  },

  _editingPedidoId: null,

  editPedido(id) {
    const p = this.pedidosData.find(x => x.id === id);
    if (!p) return;
    this.showScreen('nuevo-pedido');
    this._editingPedidoId = id;

    document.getElementById('pedido-nombre').value = p.nombre || '';
    document.getElementById('pedido-cedula').value = p.cedula || '';
    document.getElementById('pedido-transporte').value = p.transporte || '';
    document.getElementById('pedido-direccion').value = p.direccion || '';
    document.getElementById('pedido-nota').value = p.nota || '';
    this.pedidoPerfumes = (p.perfumes || []).map(pf => ({ ...pf, cantidad: pf.cantidad || 1 }));
    this.renderPedidoPerfumesList();

    const saveBtn = document.querySelector('#screen-nuevo-pedido .btn-primary');
    if (saveBtn) {
      saveBtn.innerHTML = '<span class="ms">save</span>Actualizar pedido';
      saveBtn.setAttribute('onclick', 'App.updatePedido()');
    }
    const title = document.querySelector('#screen-nuevo-pedido .sub-title');
    if (title) title.textContent = 'Editar pedido';
  },

  async updatePedido() {
    const id = this._editingPedidoId;
    if (!id) return;

    const nombre = document.getElementById('pedido-nombre').value.trim();
    const cedula = document.getElementById('pedido-cedula').value.trim();
    const transporte = document.getElementById('pedido-transporte').value.trim();
    const direccion = document.getElementById('pedido-direccion').value.trim();
    const nota = document.getElementById('pedido-nota').value.trim();

    if (!nombre) { this.toast('Ingresá el nombre', 'warning'); return; }
    if (!cedula) { this.toast('Ingresá la cédula / DNI', 'warning'); return; }
    if (!transporte) { this.toast('Ingresá la empresa de transporte', 'warning'); return; }
    if (this.pedidoPerfumes.length === 0) { this.toast('Agregá al menos un perfume', 'warning'); return; }

    const p = this.pedidosData.find(x => x.id === id);
    if (p) {
      Object.assign(p, {
        nombre, cedula, transporte, direccion, nota,
        perfumes: this.pedidoPerfumes.map(pf => ({ id: pf.id, nombre: pf.nombre, precioVenta: pf.precioVenta, cantidad: pf.cantidad }))
      });
      try {
        await DB.updatePedido(p);
      } catch (e) {
        this.toast('Error al actualizar el pedido', 'error');
        return;
      }
    }

    this._editingPedidoId = null;
    await this.loadData();
    this.toast('Pedido actualizado', 'check_circle');
    this.haptic('success');
    this.showScreen('pedidos');
  },

  async deletePedido(id) {
    if (!await this.appConfirm('¿Eliminar este pedido?', 'Eliminar', 'delete')) return;
    try {
      await DB.deletePedido(id);
    } catch (e) {
      this.toast('Error al eliminar el pedido', 'error');
      return;
    }
    await this.loadData();
    this.renderPedidos();
    this.updatePedidosBadge();
    this.toast('Pedido eliminado', 'delete');
    this._notifyTabs();
  },

  showPedidoDetalle(id) {
    this.currentPedidoId = id;
    this.showScreen('pedido-detalle');
    this.renderPedidoDetalle(id);
  },

  renderPedidoDetalle(id) {
    const p = this.pedidosData.find(x => x.id === id);
    const container = document.getElementById('pedido-detalle-content');
    if (!p) {
      container.innerHTML = '<div class="empty-state"><span class="ms">search_off</span><span>Pedido no encontrado</span></div>';
      return;
    }

    const isPendiente = p.estado === 'pendiente';
    const totalItems = (p.perfumes || []).reduce((s, pf) => s + pf.cantidad, 0);
    const totalValor = (p.perfumes || []).reduce((s, pf) => s + (pf.precioVenta * pf.cantidad), 0);

    container.innerHTML = `
      <div class="detalle-envio-card">
        <div class="pedido-section-label" style="margin-top:0;"><span class="ms gold">person</span> DATOS DE ENVÍO</div>
        <div class="detalle-envio-row"><span class="detalle-label">Nombre</span><span class="detalle-value">${this.esc(p.nombre)}</span></div>
        <div class="detalle-envio-row"><span class="detalle-label">Cédula / DNI</span><span class="detalle-value">${this.esc(p.cedula)}</span></div>
        <div class="detalle-envio-row"><span class="detalle-label">Transporte</span><span class="detalle-value">${this.esc(p.transporte)}</span></div>
        ${p.direccion ? `<div class="detalle-envio-row"><span class="detalle-label">Dirección</span><span class="detalle-value">${this.esc(p.direccion)}</span></div>` : ''}
        ${p.nota ? `<div class="detalle-envio-row"><span class="detalle-label">Nota</span><span class="detalle-value">${this.esc(p.nota)}</span></div>` : ''}
        <div class="detalle-envio-row"><span class="detalle-label">Estado</span><span class="pedido-status-badge ${p.estado}">${isPendiente ? 'Pendiente' : 'Enviado'}</span></div>
        <div class="detalle-envio-row"><span class="detalle-label">Fecha</span><span class="detalle-value">${this.fmtDate(p.fecha)}</span></div>
        ${p.fechaEnvio ? `<div class="detalle-envio-row"><span class="detalle-label">Enviado</span><span class="detalle-value">${this.fmtDate(p.fechaEnvio)}</span></div>` : ''}
      </div>

      <div class="pedido-section-label"><span class="ms gold">local_mall</span> PERFUMES (${totalItems})</div>

      <div class="detalle-envio-card">
        ${(p.perfumes || []).map(pf => `
          <div class="detalle-envio-row">
            <span class="detalle-value">${this.esc(pf.nombre)} × ${pf.cantidad}</span>
            <span class="detalle-value" style="color:var(--gold);">${this.fmt(pf.precioVenta * pf.cantidad)}</span>
          </div>
        `).join('')}
        <div class="detalle-envio-row" style="border-top:1px solid rgba(201,168,76,0.15);padding-top:10px;margin-top:6px;">
          <span class="detalle-label" style="font-weight:600;">Total</span>
          <span class="detalle-value" style="color:var(--gold);font-weight:700;">${this.fmt(totalValor)}</span>
        </div>
      </div>

      <div class="pedido-card-actions" style="margin-top:16px;">
        ${isPendiente
          ? `<button class="btn-enviar" onclick="App.marcarPedidoEnviado(${p.id})"><span class="ms">local_shipping</span>Marcar enviado</button>`
          : `<button class="btn-revertir" onclick="App.marcarPedidoPendiente(${p.id})"><span class="ms">undo</span>Revertir</button>`
        }
        <button class="btn-delete-pedido" onclick="App.editPedido(${p.id})" style="background:var(--gold-dim);color:var(--gold2);"><span class="ms">edit</span></button>
        <button class="btn-delete-pedido" onclick="App.deletePedido(${p.id})"><span class="ms">delete</span></button>
      </div>
    `;
  },

  updatePedidosBadge() {
    const pendientes = this.pedidosData.filter(p => p.estado === 'pendiente').length;
    const badge = document.getElementById('mas-pedidos-badge');
    if (badge) {
      badge.textContent = pendientes;
      badge.style.display = pendientes > 0 ? 'inline-flex' : 'none';
    }
  },