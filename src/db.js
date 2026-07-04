
  async init() {
    await openDB();
  },

  async getAll(store) {
    await openDB();
    return reqP(tx(store).getAll());
  },

  async get(store, id) {
    await openDB();
    return reqP(tx(store).get(id));
  },

  async add(store, data) {
    await openDB();
    return reqP(tx(store, 'readwrite').add(data));
  },

  async put(store, data) {
    await openDB();
    return reqP(tx(store, 'readwrite').put(data));
  },

  async delete(store, id) {
    await openDB();
    return reqP(tx(store, 'readwrite').delete(id));
  },

  async clear(store) {
    await openDB();
    return reqP(tx(store, 'readwrite').clear());
  },

  async getPerfumes() {
    return this.getAll('perfumes');
  },

  async addPerfume(p) {
    return this.add('perfumes', { ...p, creado: Date.now() });
  },

  async updatePerfume(p) {
    return this.put('perfumes', p);
  },

  async deletePerfume(id) {
    return this.delete('perfumes', id);
  },

  async getVentas() {
    const ventas = await this.getAll('ventas');
    return ventas.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  },

  async addVenta(v) {
    const id = await this.add('ventas', { ...v, fecha: v.fecha || Date.now() });
    if (v.perfumeId && v.perfumeId !== '') {
      const p = await this.get('perfumes', v.perfumeId);
      if (p && p.stock > 0) {
        p.stock = Math.max(0, p.stock - 1);
        await this.put('perfumes', p);
      }
    }
    if (v.formaPago === 'cuotas' && v.numCuotas > 1) {
      const montoCuota = Math.round(v.precioVenta / v.numCuotas);
      const lastCuota = v.precioVenta - montoCuota * (v.numCuotas - 1);
      for (let i = 0; i < v.numCuotas; i++) {
        const vence = new Date();
        vence.setMonth(vence.getMonth() + i);
        const isLast = i === v.numCuotas - 1;
        const monto = isLast ? lastCuota : montoCuota;
        await this.add('cuotas', {
          ventaId: id,
          perfume: v.perfume,
          cliente: v.cliente,
          numero: i + 1,
          total: v.numCuotas,
          monto,
          montoTotal: v.precioVenta,
          pagado: i === 0,
          montoPagado: i === 0 ? monto : 0,
          vence: vence.getTime()
        });
      }
    }
    return id;
  },

  async updateVenta(v) {
    return this.put('ventas', v);
  },

  async deleteVenta(id) {
    const v = await this.get('ventas', id);
    if (v) {
      if (v.perfumeId && v.perfumeId !== '') {
        const p = await this.get('perfumes', v.perfumeId);
        if (p) {
          p.stock = (p.stock || 0) + 1;
          await this.put('perfumes', p);
        }
      }
      if (v.formaPago === 'cuotas') {
        const allCuotas = await this.getAll('cuotas');
        for (const c of allCuotas) {
          if (c.ventaId === id) await this.delete('cuotas', c.id);
        }
      }
    }
    return this.delete('ventas', id);
  },

  async getCuotas() {
    return this.getAll('cuotas');
  },

  async pagarCuota(id, montoPagado) {
    const c = await this.get('cuotas', id);
    if (c) {
      const prevPagado = c.montoPagado || 0;
      const totalPagado = prevPagado + montoPagado;
      c.montoPagado = Math.min(totalPagado, c.monto);
      c.pagado = c.montoPagado >= c.monto;
      c.fechaPago = Date.now();
      if (!c.pagos) c.pagos = [];
      c.pagos.push({ monto: montoPagado, fecha: Date.now() });
      await this.put('cuotas', c);
    }
    return c;
  },

  async getConfig(key) {
    const c = await this.get('config', key);
    return c ? c.value : null;
  },

  async setConfig(key, value) {
    return this.put('config', { key, value });
  },

  async getPedidos() {
    const pedidos = await this.getAll('pedidos');
    return pedidos.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  },

  async addPedido(p) {
    return this.add('pedidos', { ...p, fecha: Date.now(), estado: 'pendiente' });
  },

  async updatePedido(p) {
    return this.put('pedidos', p);
  },

  async deletePedido(id) {
    return this.delete('pedidos', id);
  },

  async marcarEnviado(id) {
    const p = await this.get('pedidos', id);
    if (p) {
      p.estado = 'enviado';
      p.fechaEnvio = Date.now();
      await this.put('pedidos', p);
    }
    return p;
  },

  async marcarPendiente(id) {
    const p = await this.get('pedidos', id);
    if (p) {
      p.estado = 'pendiente';
      p.fechaEnvio = null;
      await this.put('pedidos', p);
    }
    return p;
  },

  async getCaja() {
    const items = await this.getAll('caja');
    return items.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  },

  async addCaja(item) {
    return this.add('caja', { ...item, fecha: Date.now() });
  },

  async deleteCaja(id) {
    return this.delete('caja', id);
  },

  async getGastos() {
    const items = await this.getAll('gastos');
    return items.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  },

  async addGasto(item) {
    return this.add('gastos', { ...item, fecha: Date.now() });
  },

  async deleteGasto(id) {
    return this.delete('gastos', id);
  },

  async seedDemo() {
    const perfumes = await this.getPerfumes();
    if (perfumes.length > 0) return;

    const demoPerf = [
      { nombre: 'Haramain Gold', precioCompra: 2700, precioVenta: 3900, stock: 8, foto: '' },
      { nombre: 'Bharara King', precioCompra: 2700, precioVenta: 3900, stock: 2, foto: '' },
      { nombre: 'Yara Rosa', precioCompra: 1700, precioVenta: 2500, stock: 5, foto: '' },
      { nombre: 'Asad Negro', precioCompra: 1800, precioVenta: 2600, stock: 0, foto: '' },
      { nombre: 'Yara EDT', precioCompra: 3200, precioVenta: 4400, stock: 3, foto: '' },
      { nombre: 'The Kingdom', precioCompra: 1800, precioVenta: 2600, stock: 1, foto: '' },
      { nombre: 'Lattafa Pride', precioCompra: 2200, precioVenta: 3200, stock: 4, foto: '' },
      { nombre: 'Afnan 9PM', precioCompra: 2500, precioVenta: 3600, stock: 6, foto: '' },
    ];

    for (const p of demoPerf) {
      await this.addPerfume(p);
    }

    const now = Date.now();
    const day = 86400000;
    const demoVentas = [
      { perfume: 'Yara EDT', precioVenta: 4400, precioCompra: 3200, cliente: 'Susana', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 10, perfumeId: '' },
      { perfume: 'The Kingdom', precioVenta: 2600, precioCompra: 1800, cliente: 'Susana', vendedor: 'Luccas', formaPago: 'cuotas', numCuotas: 2, nota: '', fecha: now - day * 15, perfumeId: '' },
      { perfume: 'Haramain Gold', precioVenta: 3900, precioCompra: 2700, cliente: 'Pedro', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 5, perfumeId: '' },
      { perfume: 'Bharara King', precioVenta: 3900, precioCompra: 2700, cliente: 'María', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 3, perfumeId: '' },
      { perfume: 'Yara Rosa', precioVenta: 2500, precioCompra: 1700, cliente: 'Ana', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 2, perfumeId: '' },
      { perfume: 'Lattafa Pride', precioVenta: 3200, precioCompra: 2200, cliente: 'Carlos', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 1, perfumeId: '' },
      { perfume: 'Afnan 9PM', precioVenta: 3600, precioCompra: 2500, cliente: 'Laura', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 8, perfumeId: '' },
      { perfume: 'Haramain Gold', precioVenta: 3900, precioCompra: 2700, cliente: 'Jorge', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 12, perfumeId: '' },
      { perfume: 'Asad Negro', precioVenta: 2600, precioCompra: 1800, cliente: 'Lucía', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 7, perfumeId: '' },
      { perfume: 'Yara EDT', precioVenta: 4400, precioCompra: 3200, cliente: 'Roberto', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 4, perfumeId: '' },
      { perfume: 'Bharara King', precioVenta: 3900, precioCompra: 2700, cliente: 'Sofía', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 6, perfumeId: '' },
      { perfume: 'Afnan 9PM', precioVenta: 3600, precioCompra: 2500, cliente: 'Diego', vendedor: 'Luccas', formaPago: 'contado', nota: '', fecha: now - day * 9, perfumeId: '' },
      { perfume: 'Yara EDT', precioVenta: 4400, precioCompra: 3200, cliente: 'Martín', vendedor: 'Luccas', formaPago: 'contado', nota: 'Entrega el viernes', fecha: now, perfumeId: '' },
    ];

    for (const v of demoVentas) {
      await this.addVenta(v);
    }
  }

