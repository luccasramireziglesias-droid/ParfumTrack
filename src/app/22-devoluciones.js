

  // ====== DEVOLUCIONES Y CAMBIOS (F3) ======
  // Antes, cuando un cliente devolvía un perfume, la única opción era borrar
  // la venta: desaparecía del historial y no quedaba registro de que hubo una
  // devolución ni de por qué. Una devolución es un hecho del negocio, no un
  // error de carga.

  _MOTIVOS_DEVOLUCION: ['No le gustó', 'Falló', 'Se arrepintió', 'Cambio por otro'],

  _devolucionVentaId: null,
  _devolucionMotivo: '',

  // Las ventas devueltas siguen en el historial pero no cuentan para
  // ganancia, estadísticas ni totales de cliente.
  _ventasActivas() {
    return this.ventas.filter(v => !v.devuelta);
  },

  abrirDevolucion(id) {
    const v = this.ventas.find(x => x.id === id);
    if (!v) {
      this.toast('No se encontró la venta', 'error');
      return;
    }
    if (v.devuelta) {
      this.toast('Esta venta ya está devuelta', 'info');
      return;
    }
    this._devolucionVentaId = id;
    this._devolucionMotivo = '';

    const cant = Math.max(1, parseInt(v.cantidad, 10) || 1);
    document.getElementById('devolucion-perfume').textContent = v.perfume;
    document.getElementById('devolucion-cliente').textContent = v.cliente || 'Anónimo';
    document.getElementById('devolucion-monto').textContent = this.fmt(v.precioVenta);
    document.getElementById('devolucion-cantidad').textContent = `${cant} unidad${cant !== 1 ? 'es' : ''}`;

    // Solo ofrecer reponer stock si esta venta descontó algo
    const unidades = v.unidadesDescontadas !== undefined
      ? v.unidadesDescontadas
      : (v.stockDescontado !== false && v.perfumeId ? 1 : 0);
    const stockRow = document.getElementById('devolucion-stock-row');
    const stockCheck = document.getElementById('devolucion-repone-stock');
    stockCheck.checked = unidades > 0;
    stockCheck.disabled = unidades === 0;
    stockRow.classList.toggle('deshabilitado', unidades === 0);
    document.getElementById('devolucion-stock-label').textContent = unidades > 0
      ? `Devolver ${unidades} unidad${unidades !== 1 ? 'es' : ''} al stock`
      : 'Esta venta no descontó stock';

    // Aviso de cuotas: se cancelan las impagas, se conservan las cobradas
    const cuotas = this.cuotasData.filter(c => c.ventaId === id);
    const impagas = cuotas.filter(c => !c.pagado && !(c.montoPagado > 0));
    const avisoCuotas = document.getElementById('devolucion-aviso-cuotas');
    if (impagas.length > 0) {
      avisoCuotas.textContent = `Se cancelan ${impagas.length} cuota${impagas.length !== 1 ? 's' : ''} pendiente${impagas.length !== 1 ? 's' : ''}. Lo ya cobrado queda registrado.`;
      avisoCuotas.classList.remove('hidden');
    } else {
      avisoCuotas.classList.add('hidden');
    }

    document.getElementById('devolucion-nota').value = '';
    this._renderMotivosDevolucion();
    document.getElementById('modal-devolucion').classList.remove('hidden');
  },

  _renderMotivosDevolucion() {
    const cont = document.getElementById('devolucion-motivos');
    if (!cont) return;
    cont.innerHTML = this._MOTIVOS_DEVOLUCION.map(m => {
      const activo = m === this._devolucionMotivo ? ' active' : '';
      return `<button type="button" class="motivo-chip${activo}" onclick="App.elegirMotivoDevolucion(${JSON.stringify(m).replace(/"/g, '&quot;')})">${this.esc(m)}</button>`;
    }).join('');
  },

  elegirMotivoDevolucion(motivo) {
    // Volver a tocar el mismo chip lo deselecciona
    this._devolucionMotivo = this._devolucionMotivo === motivo ? '' : motivo;
    this._renderMotivosDevolucion();
    this.haptic();
  },

  cerrarDevolucion() {
    document.getElementById('modal-devolucion').classList.add('hidden');
    this._devolucionVentaId = null;
    this._devolucionMotivo = '';
  },

  confirmarDevolucion() {
    // Anti doble-tap: dos toques reponían el stock dos veces
    return this._once('devolucion', () => this._confirmarDevolucionImpl(),
      document.getElementById('devolucion-confirmar'));
  },

  async _confirmarDevolucionImpl() {
    const id = this._devolucionVentaId;
    if (!id) return;
    const motivo = this._devolucionMotivo;
    const nota = (document.getElementById('devolucion-nota').value || '').trim().slice(0, 300);
    const reponerStock = document.getElementById('devolucion-repone-stock').checked;
    const esCambio = motivo === 'Cambio por otro';
    const venta = this.ventas.find(x => x.id === id);
    const cliente = venta ? venta.cliente : '';

    try {
      await DB.devolverVenta(id, { motivo, nota, reponerStock });
    } catch (e) {
      this.toast(e.message === 'YA_DEVUELTA' ? 'Esta venta ya está devuelta' : 'Error al registrar la devolución', 'error');
      return;
    }

    this.cerrarDevolucion();
    await this.loadData();
    this.renderAll();
    this.renderAllVentas();
    this.haptic('success');
    this._notifyTabs();

    if (esCambio) {
      // Un cambio es una devolución + una venta nueva: dejamos el form listo
      this.toast('Devolución registrada — cargá el cambio', 'swap_horiz');
      setTimeout(() => {
        this.showScreen('nueva-venta');
        if (cliente && cliente !== 'Anónimo') document.getElementById('venta-cliente').value = cliente;
      }, 400);
    } else {
      this.toast('Devolución registrada', 'assignment_return');
    }
  },

  async revertirDevolucion(id) {
    const v = this.ventas.find(x => x.id === id);
    if (!v || !v.devuelta) return;
    if (!await this.appConfirm('¿Deshacer la devolución? La venta vuelve a contar y se descuenta el stock otra vez.', 'Deshacer', 'undo')) return;
    try {
      await DB.revertirDevolucion(id);
    } catch (e) {
      this.toast('Error al deshacer la devolución', 'error');
      return;
    }
    await this.loadData();
    this.renderAll();
    this.renderAllVentas();
    this.toast('Devolución deshecha', 'undo');
    this._notifyTabs();
  },
