

  // ====== CUOTAS ======

  _pagoCuotaId: null,

  abrirPagoCuota(id) {
    // Tolerante a ids string vs numérico (backups importados viejos)
    const cuota = this.cuotasData.find(c => c.id === id || String(c.id) === String(id));
    if (!cuota) {
      this.toast('No se encontró la cuota', 'error');
      return;
    }
    this._pagoCuotaId = cuota.id; // el id real almacenado, no el que vino del atributo
    const restante = cuota.monto - (cuota.montoPagado || 0);
    document.getElementById('pago-cuota-perfume').textContent = cuota.perfume;
    document.getElementById('pago-cuota-cliente').textContent = cuota.cliente;
    document.getElementById('pago-cuota-numero').textContent = `${cuota.numero} de ${cuota.total}`;
    document.getElementById('pago-cuota-monto').textContent = this.fmt(restante);
    const input = document.getElementById('pago-cuota-input');
    input.value = restante;
    input.max = restante;
    document.getElementById('modal-pago-cuota').classList.remove('hidden');
    setTimeout(() => input.select(), 100);
  },

  cerrarPagoCuota() {
    document.getElementById('modal-pago-cuota').classList.add('hidden');
    this._pagoCuotaId = null;
  },

  async confirmarPagoCuota() {
    const id = this._pagoCuotaId;
    if (!id) return;
    const input = document.getElementById('pago-cuota-input');
    const monto = this.parseMonto(input.value);
    if (!monto || monto <= 0) {
      this.toast('Ingresá un monto válido', 'error');
      return;
    }
    const cuota = this.cuotasData.find(c => c.id === id);
    const restante = cuota ? cuota.monto - (cuota.montoPagado || 0) : 0;
    if (monto > restante + 0.01) {
      this.toast('El monto supera lo que resta', 'error');
      return;
    }
    try {
      await DB.pagarCuota(id, monto);
    } catch (e) {
      this.toast('Error al registrar el pago', 'error');
      return;
    }
    this.cerrarPagoCuota();
    await this.loadData();
    this.renderCuotas();
    this.renderDashboard();
    this.updateNavBadge();
    const paid = monto >= restante - 0.01;
    this.toast(paid ? 'Cuota pagada completa' : 'Pago parcial registrado', 'check_circle');
    this.haptic('success');
    this._notifyTabs();
  },

  async marcarPagada(id) {
    this.abrirPagoCuota(id);
  },

  cobrarWhatsApp(msg) {
    const branded = msg + '\n\n_Enviado desde Parfum Track_';
    const encoded = encodeURIComponent(branded);
    window.open('https://wa.me/?text=' + encoded, '_blank');
  },