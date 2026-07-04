

  // ====== VENTAS EDIT/DELETE ======

  _editingVentaId: null,

  editVenta(id) {
    const v = this.ventas.find(x => x.id === id);
    if (!v) return;
    this.showScreen('nueva-venta');
    this._editingVentaId = id;

    document.getElementById('venta-perfume-display').textContent = v.perfume;
    document.getElementById('venta-perfume-nombre').value = v.perfume;
    document.getElementById('venta-perfume-id').value = v.perfumeId || '';
    document.getElementById('venta-precio').value = v.precioOriginal || v.precioVenta;
    document.getElementById('venta-compra').value = v.precioCompra;
    document.getElementById('venta-cliente').value = v.cliente || '';
    document.getElementById('venta-vendedor').value = v.vendedor || '';
    document.getElementById('venta-proveedor').value = v.proveedor || '';
    document.getElementById('venta-descuento').value = v.descuento || 0;
    document.getElementById('venta-nota').value = v.nota || '';
    if (v.fecha) {
      const d = new Date(v.fecha);
      if (!isNaN(d.getTime())) document.getElementById('venta-fecha').value = d.toISOString().split('T')[0];
    }

    this.setFormaPago(v.formaPago || 'contado');
    if (v.numCuotas > 1) {
      document.getElementById('venta-num-cuotas').value = v.numCuotas;
    }

    const saveBtn = document.querySelector('#screen-nueva-venta .btn-primary');
    if (saveBtn) {
      saveBtn.innerHTML = '<span class="ms">save</span>Actualizar venta';
      saveBtn.setAttribute('onclick', 'App.updateVenta()');
    }
    const title = document.querySelector('#screen-nueva-venta .sub-title');
    if (title) title.textContent = 'Editar venta';

    this.calcLiveProfit();
  },

  async updateVenta() {
    const id = this._editingVentaId;
    if (!id) return;

    const perfume = document.getElementById('venta-perfume-nombre').value || document.getElementById('venta-perfume-display').textContent;
    const precioVenta = parseFloat(document.getElementById('venta-precio').value) || 0;
    const precioCompra = parseFloat(document.getElementById('venta-compra').value) || 0;
    const cliente = document.getElementById('venta-cliente').value;
    const vendedor = document.getElementById('venta-vendedor').value;
    const proveedor = document.getElementById('venta-proveedor').value;
    const descuento = parseFloat(document.getElementById('venta-descuento').value) || 0;
    const fechaStr = document.getElementById('venta-fecha').value;
    // BUG #5 FIX: Usar 'Z' para UTC en lugar de hora local
    const fecha = fechaStr ? new Date(fechaStr + 'T00:00:00Z').getTime() : Date.now();
    const nota = document.getElementById('venta-nota').value;
    const perfumeId = document.getElementById('venta-perfume-id').value;
    const pvFinal = descuento > 0 ? Math.round(precioVenta * (1 - descuento / 100)) : precioVenta;

    if (!perfume || perfume === 'Elegir perfume…') {
      this.toast('Elegí un perfume', 'warning');
      return;
    }

    const numCuotas = parseInt(document.getElementById('venta-num-cuotas').value) || 2;
    const newFormaPago = this.formaPago;

    const v = this.ventas.find(x => x.id === id);
    if (v) {
      const oldFormaPago = v.formaPago || 'contado';
      Object.assign(v, {
        perfume, precioVenta: pvFinal, precioOriginal: precioVenta, precioCompra,
        cliente: cliente || 'Anónimo', vendedor: vendedor || 'Anónimo',
        proveedor: proveedor || '', descuento, nota, fecha,
        perfumeId: perfumeId ? parseInt(perfumeId) : '',
        formaPago: newFormaPago,
        numCuotas: newFormaPago === 'cuotas' ? numCuotas : 1,
      });
      try {
        await DB.updateVenta(v);
      } catch (e) {
        this.toast('Error al actualizar la venta', 'error');
        return;
      }

      // Si cambió de contado a cuotas, generar cuotas
      if (oldFormaPago !== 'cuotas' && newFormaPago === 'cuotas' && numCuotas > 1) {
        const montoCuota = Math.round(pvFinal / numCuotas);
        const lastCuota = pvFinal - montoCuota * (numCuotas - 1);
        for (let i = 0; i < numCuotas; i++) {
          const vence = new Date(fecha);
          vence.setMonth(vence.getMonth() + i);
          const isLast = i === numCuotas - 1;
          const monto = isLast ? lastCuota : montoCuota;
          try {
            await DB.add('cuotas', {
              ventaId: id,
              perfume,
              cliente: cliente || 'Anónimo',
              numero: i + 1,
              total: numCuotas,
              monto,
              montoTotal: pvFinal,
              pagado: i === 0,
              montoPagado: i === 0 ? monto : 0,
              vence: vence.getTime(),
            });
          } catch { /* skip */ }
        }
      }
      // Si cambió de cuotas a contado, borrar cuotas existentes
      if (oldFormaPago === 'cuotas' && newFormaPago !== 'cuotas') {
        const allCuotas = await DB.getAll('cuotas');
        for (const c of allCuotas) {
          if (c.ventaId === id) {
            try { await DB.delete('cuotas', c.id); } catch { /* skip */ }
          }
        }
      }
    }

    this._editingVentaId = null;
    await this.loadData();
    this.toast('Venta actualizada', 'check_circle');
    this.haptic('success');
    this.showScreen('inicio');
  },

  async deleteVenta(id) {
    if (!await this.appConfirm('¿Eliminar esta venta?', 'Eliminar', 'delete')) return;
    try {
      await DB.deleteVenta(id);
    } catch (e) {
      this.toast('Error al eliminar la venta', 'error');
      return;
    }
    await this.loadData();
    this.renderAll();
    this.renderAllVentas();
    this.toast('Venta eliminada', 'delete');
    this._notifyTabs();
  },