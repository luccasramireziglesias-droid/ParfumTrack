

  // ====== SEÑAS Y ENCARGOS (F5) ======
  // El cliente deja un adelanto para asegurar un perfume que muchas veces
  // todavía no está en stock. Antes eso vivía en la cabeza del revendedor o
  // en un chat de WhatsApp: se perdía la seña, el precio acordado y quién
  // estaba esperando qué.

  _reservaEditId: null,
  _reservaFiltro: 'pendiente',

  _reservasPorEstado(estado) {
    return (this.reservasData || []).filter(r => r.estado === estado);
  },

  // Cuántas unidades están comprometidas de un perfume (encargos sin entregar)
  _reservadasDe(perfumeId) {
    return this._reservasPorEstado('pendiente')
      .filter(r => r.perfumeId === perfumeId)
      .reduce((n, r) => n + (r.cantidad || 1), 0);
  },

  abrirReserva(id) {
    this._reservaEditId = id || null;
    const r = id ? (this.reservasData || []).find(x => x.id === id) : null;

    document.getElementById('reserva-modal-titulo').textContent = r ? 'Editar encargo' : 'Nueva seña / encargo';
    document.getElementById('reserva-cliente').value = r ? (r.cliente || '') : '';
    document.getElementById('reserva-perfume-nombre').value = r ? (r.perfume || '') : '';
    document.getElementById('reserva-perfume-id').value = r && r.perfumeId ? r.perfumeId : '';
    document.getElementById('reserva-cantidad').value = r ? (r.cantidad || 1) : 1;
    document.getElementById('reserva-precio').value = r ? r.precioAcordado : '';
    document.getElementById('reserva-sena').value = r ? (r.sena || '') : '';
    document.getElementById('reserva-nota').value = r ? (r.nota || '') : '';
    const est = r && r.fechaEstimada ? new Date(r.fechaEstimada) : null;
    document.getElementById('reserva-estimada').value = est && !isNaN(est.getTime())
      ? est.toISOString().split('T')[0] : '';

    this.calcRestaReserva();
    this._renderSugerenciasReserva();
    document.getElementById('modal-reserva').classList.remove('hidden');
  },

  cerrarReserva() {
    document.getElementById('modal-reserva').classList.add('hidden');
    this._reservaEditId = null;
  },

  // Elegir un perfume del stock completa nombre, id y precio de una
  _renderSugerenciasReserva() {
    const cont = document.getElementById('reserva-sugerencias');
    if (!cont) return;
    cont.innerHTML = (this.perfumes || []).slice(0, 12).map(p =>
      `<button type="button" class="motivo-chip" onclick="App.elegirPerfumeReserva(${p.id})">${this.esc(p.nombre)}</button>`
    ).join('');
  },

  elegirPerfumeReserva(perfumeId) {
    const p = this.perfumes.find(x => x.id === perfumeId);
    if (!p) return;
    document.getElementById('reserva-perfume-nombre').value = p.nombre;
    document.getElementById('reserva-perfume-id').value = p.id;
    const precio = document.getElementById('reserva-precio');
    if (!precio.value) precio.value = p.precioVenta || '';
    this.calcRestaReserva();
    this.haptic();
  },

  calcRestaReserva() {
    const cant = Math.max(1, parseInt((document.getElementById('reserva-cantidad').value || '1').replace(/[^\d]/g, ''), 10) || 1);
    const precio = this.parseMonto(document.getElementById('reserva-precio').value) || 0;
    const sena = this.parseMonto(document.getElementById('reserva-sena').value) || 0;
    const total = precio * cant;
    const resta = Math.max(0, total - sena);
    const el = document.getElementById('reserva-resta');
    if (el) el.textContent = `Total ${this.fmt(total)} · resta ${this.fmt(resta)}`;
  },

  guardarReserva() {
    return this._once('reserva', () => this._guardarReservaImpl(),
      document.getElementById('reserva-confirmar'));
  },

  async _guardarReservaImpl() {
    const cliente = document.getElementById('reserva-cliente').value.trim();
    const perfume = document.getElementById('reserva-perfume-nombre').value.trim();
    const perfumeIdRaw = document.getElementById('reserva-perfume-id').value;
    const cantidad = Math.max(1, parseInt((document.getElementById('reserva-cantidad').value || '1').replace(/[^\d]/g, ''), 10) || 1);
    const precioAcordado = this.parseMonto(document.getElementById('reserva-precio').value) || 0;
    const sena = this.parseMonto(document.getElementById('reserva-sena').value) || 0;
    const nota = (document.getElementById('reserva-nota').value || '').trim().slice(0, 300);
    const estimadaStr = document.getElementById('reserva-estimada').value;

    if (!perfume) {
      this.toast('Poné qué perfume encargó', 'warning');
      return;
    }
    if (precioAcordado <= 0) {
      this.toast('Ingresá el precio acordado', 'warning');
      return;
    }
    if (precioAcordado > 1e9 || sena > 1e9) {
      this.toast('El monto es demasiado grande (máx mil millones)', 'warning');
      return;
    }
    if (sena > precioAcordado * cantidad) {
      this.toast('La seña no puede superar el total', 'warning');
      return;
    }

    const datos = {
      cliente: cliente || 'Anónimo',
      perfume,
      perfumeId: perfumeIdRaw ? parseInt(perfumeIdRaw, 10) : null,
      cantidad,
      precioAcordado,
      sena,
      nota,
      fechaEstimada: estimadaStr ? new Date(estimadaStr + 'T00:00:00Z').getTime() : null
    };

    try {
      if (this._reservaEditId) {
        const previa = this.reservasData.find(x => x.id === this._reservaEditId);
        await DB.updateReserva({ ...previa, ...datos, total: precioAcordado * cantidad });
      } else {
        await DB.addReserva(datos);
      }
    } catch (e) {
      this.toast('Error al guardar el encargo', 'error');
      return;
    }

    this.cerrarReserva();
    await this.loadData();
    this.renderReservas();
    this.renderAll();
    this.toast(this._reservaEditId ? 'Encargo actualizado' : 'Encargo guardado', 'bookmark_added');
    this.haptic('success');
    this._notifyTabs();
  },

  async entregarReserva(id) {
    const r = (this.reservasData || []).find(x => x.id === id);
    if (!r) return;
    const resta = Math.max(0, (r.total || 0) - (r.sena || 0));
    const msg = resta > 0
      ? `¿Entregar el encargo? Se registra la venta por ${this.fmt(r.total)} (resta cobrar ${this.fmt(resta)}).`
      : `¿Entregar el encargo? Se registra la venta por ${this.fmt(r.total)}.`;
    if (!await this.appConfirm(msg, 'Entregar', 'check_circle')) return;

    // El costo sale del perfume del stock, si la reserva apunta a uno
    const p = r.perfumeId ? this.perfumes.find(x => x.id === r.perfumeId) : null;
    try {
      await DB.entregarReserva(id, { precioCompra: p ? (p.precioCompra || 0) : 0 });
    } catch (e) {
      this.toast('Error al entregar el encargo', 'error');
      return;
    }
    await this.loadData();
    this.renderReservas();
    this.renderAll();
    this.toast('Entregado y registrado como venta', 'check_circle');
    this.haptic('success');
    this._notifyTabs();
  },

  async cancelarReserva(id) {
    const r = (this.reservasData || []).find(x => x.id === id);
    if (!r) return;
    if (!await this.appConfirm('¿Cancelar el encargo?', 'Cancelar encargo', 'cancel')) return;
    let devolverSena = true;
    if ((r.sena || 0) > 0) {
      devolverSena = await this.appConfirm(`¿Le devolvés la seña de ${this.fmt(r.sena)}?`, 'Sí, la devuelvo', 'undo');
    }
    try {
      await DB.cancelarReserva(id, { devolverSena });
    } catch (e) {
      this.toast('Error al cancelar el encargo', 'error');
      return;
    }
    await this.loadData();
    this.renderReservas();
    this.renderAll();
    this.toast('Encargo cancelado', 'cancel');
    this._notifyTabs();
  },

  async eliminarReserva(id) {
    if (!await this.appConfirm('¿Borrar este encargo del historial?', 'Borrar', 'delete')) return;
    try {
      await DB.eliminarReserva(id);
    } catch (e) {
      this.toast('Error al borrar el encargo', 'error');
      return;
    }
    await this.loadData();
    this.renderReservas();
    this.renderAll();
    this.toast('Encargo borrado', 'delete');
    this._notifyTabs();
  },

  filterReservas(estado) {
    this._reservaFiltro = estado;
    document.querySelectorAll('#reservas-filter .seg-option').forEach(o => {
      o.classList.toggle('active', o.dataset.estado === estado);
    });
    this.renderReservas();
  },

  renderReservas() {
    const cont = document.getElementById('reservas-list');
    if (!cont) return;

    const pendientes = this._reservasPorEstado('pendiente');
    const totalSenas = pendientes.reduce((s, r) => s + (r.sena || 0), 0);
    const elCount = document.getElementById('reservas-count');
    const elSenas = document.getElementById('reservas-senas');
    if (elCount) elCount.textContent = pendientes.length;
    if (elSenas) elSenas.textContent = this.fmt(totalSenas);

    const items = this._reservasPorEstado(this._reservaFiltro);
    if (items.length === 0) {
      const msg = this._reservaFiltro === 'pendiente'
        ? 'No hay encargos pendientes. Anotá la seña cuando un cliente aparte un perfume.'
        : this._reservaFiltro === 'entregada' ? 'Todavía no entregaste ningún encargo' : 'No hay encargos cancelados';
      cont.innerHTML = `<div class="empty-state"><span class="ms">bookmark</span><span>${msg}</span></div>`;
      return;
    }

    cont.innerHTML = items.map(r => {
      const resta = Math.max(0, (r.total || 0) - (r.sena || 0));
      const p = r.perfumeId ? this.perfumes.find(x => x.id === r.perfumeId) : null;
      const stock = p ? Math.max(0, p.stock || 0) : null;
      const hayStock = stock !== null && stock >= (r.cantidad || 1);
      const waMsg = hayStock
        ? `Hola ${r.cliente}! 👋 Ya tengo tu *${r.perfume}*. Te queda por abonar ${this.fmt(resta)}. ¿Cuándo lo pasás a buscar?`
        : `Hola ${r.cliente}! 👋 Te escribo por tu encargo de *${r.perfume}*. Todavía estoy esperando la reposición, te aviso apenas llegue.`;

      const estadoTag = r.estado === 'pendiente'
        ? (stock === null
            ? '<span class="reserva-tag esperando">Sin vincular al stock</span>'
            : hayStock
              ? '<span class="reserva-tag listo"><span class="ms" aria-hidden="true">check_circle</span>Hay stock</span>'
              : '<span class="reserva-tag esperando"><span class="ms" aria-hidden="true">hourglass_top</span>Esperando stock</span>')
        : r.estado === 'entregada'
          ? '<span class="reserva-tag listo"><span class="ms" aria-hidden="true">check</span>Entregado</span>'
          : `<span class="reserva-tag cancelado">Cancelado${r.sena > 0 ? (r.senaDevuelta ? ' · seña devuelta' : ' · seña retenida') : ''}</span>`;

      const acciones = r.estado === 'pendiente'
        ? `<button class="btn-whatsapp reserva-btn" data-msg="${this.b64Encode(waMsg)}" aria-label="Avisar por WhatsApp"><span class="ms" aria-hidden="true">chat</span></button>
           <button class="reserva-btn ms" onclick="App.abrirReserva(${r.id})" aria-label="Editar encargo">edit</button>
           <button class="reserva-btn ms cancelar" onclick="App.cancelarReserva(${r.id})" aria-label="Cancelar encargo">cancel</button>
           <button class="reserva-btn entregar" onclick="App.entregarReserva(${r.id})" aria-label="Entregar encargo"><span class="ms" aria-hidden="true">check_circle</span>Entregar</button>`
        : `<button class="reserva-btn ms" onclick="App.eliminarReserva(${r.id})" aria-label="Borrar del historial">delete</button>`;

      return `<div class="reserva-card ${r.estado}">
        <div class="reserva-top">
          <div class="reserva-info">
            <div class="reserva-cliente">${this.esc(r.cliente || 'Anónimo')}</div>
            <div class="reserva-perfume">${this.esc(r.perfume)}${(r.cantidad || 1) > 1 ? ` <span class="venta-cant">×${r.cantidad}</span>` : ''}</div>
          </div>
          ${estadoTag}
        </div>
        <div class="reserva-montos">
          <div><span class="reserva-label">Seña</span><span class="reserva-valor gold">${this.fmt(r.sena || 0)}</span></div>
          <div><span class="reserva-label">Resta</span><span class="reserva-valor">${this.fmt(resta)}</span></div>
          <div><span class="reserva-label">Total</span><span class="reserva-valor">${this.fmt(r.total || 0)}</span></div>
        </div>
        ${r.fechaEstimada ? `<div class="reserva-meta">Estimado para ${this.fmtDate(r.fechaEstimada)}</div>` : ''}
        ${r.nota ? `<div class="reserva-meta">${this.esc(r.nota)}</div>` : ''}
        <div class="reserva-acciones">${acciones}</div>
      </div>`;
    }).join('');
  },

  updateReservasBadge() {
    const n = this._reservasPorEstado('pendiente').length;
    const badge = document.getElementById('mas-reservas-badge');
    if (!badge) return;
    badge.textContent = n;
    badge.style.display = n > 0 ? 'inline-flex' : 'none';
  },

  // Tras reponer stock: avisar si había gente esperando ese perfume
  _avisarEncargosPendientes(perfumeId) {
    const esperando = this._reservasPorEstado('pendiente').filter(r => r.perfumeId === perfumeId);
    if (esperando.length === 0) return;
    const nombres = esperando.slice(0, 2).map(r => r.cliente).join(', ');
    const resto = esperando.length - 2;
    setTimeout(() => {
      this.toast(`${esperando.length} encargo${esperando.length !== 1 ? 's' : ''} esperando: ${nombres}${resto > 0 ? ` y ${resto} más` : ''}`, 'bookmark');
    }, 1400);
  },
