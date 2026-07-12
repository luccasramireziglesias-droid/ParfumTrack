
  async init() {
    await openDB();
  },

  _encryptedStores: new Set(['perfumes', 'ventas', 'cuotas', 'pedidos', 'gastos', 'caja']),

  _shouldEncrypt(store) {
    return this._encryptedStores.has(store) && localStorage.getItem('pt_license_code');
  },

  async _encryptBeforeStore(store, data) {
    if (!this._shouldEncrypt(store)) return data;
    try {
      const encrypted = await ENCRYPTION.encryptDataWithVersion(data);
      // CRÍTICO: conservar la clave (id) fuera del payload — sin esto, put()
      // no encuentra el registro existente y lo INSERTA duplicado
      const wrapper = { _encrypted: encrypted, _v: 1 };
      if (data && data.id !== undefined) wrapper.id = data.id;
      return wrapper;
    } catch (e) {
      console.warn('Encryption failed, storing plaintext:', e.message);
      return data;
    }
  },

  async _decryptAfterRetrieve(store, data) {
    if (!this._shouldEncrypt(store) || !data) return data;
    if (Array.isArray(data)) {
      return Promise.all(data.map(item => this._decryptAfterRetrieve(store, item)));
    }
    if (data._encrypted && data._v) {
      try {
        const obj = await ENCRYPTION.decryptDataWithVersion(data._encrypted);
        // La clave real del store es la autoridad: sana payloads guardados
        // sin id (add pre-fix) o con id viejo (duplicados por put pre-fix)
        if (obj && typeof obj === 'object' && data.id !== undefined) obj.id = data.id;
        return obj;
      } catch (e) {
        console.warn('Decryption failed, returning as-is:', e.message);
        return data;
      }
    }
    return data;
  },

  // Sana duplicados creados por el bug de put()+encriptación: registros cuyo
  // payload interno apunta a otro id (el original). Se queda con la escritura
  // más reciente (outer id más alto), la reescribe bajo el id original y
  // borra las copias. Idempotente — corre en cada init.
  async dedupEncryptedRecords() {
    if (!localStorage.getItem('pt_license_code')) return 0;
    let curados = 0;
    for (const store of this._encryptedStores) {
      let raw;
      try { await openDB(); raw = await reqP(tx(store).getAll()); } catch { continue; }
      const grupos = {};
      for (const r of raw) {
        if (!r || !r._encrypted || r.id === undefined) continue;
        let payload;
        try { payload = await ENCRYPTION.decryptDataWithVersion(r._encrypted); } catch { continue; }
        if (!payload || payload.id === undefined || payload.id === r.id) continue;
        if (!grupos[payload.id]) grupos[payload.id] = [];
        grupos[payload.id].push({ outer: r.id, payload });
      }
      for (const innerId of Object.keys(grupos)) {
        const dups = grupos[innerId].sort((a, b) => b.outer - a.outer);
        const ganador = dups[0].payload; // la escritura más reciente
        try {
          await this.put(store, ganador); // tras el fix escribe bajo su id original
          for (const d of dups) await this.delete(store, d.outer);
          curados += dups.length;
        } catch (e) { console.warn('dedup', store, e.message); }
      }
    }
    return curados;
  },

  async getAll(store) {
    await openDB();
    const data = await reqP(tx(store).getAll());
    return this._decryptAfterRetrieve(store, data);
  },

  async get(store, id) {
    await openDB();
    const data = await reqP(tx(store).get(id));
    return this._decryptAfterRetrieve(store, data);
  },

  async add(store, data) {
    await openDB();
    const encrypted = await this._encryptBeforeStore(store, data);
    return reqP(tx(store, 'readwrite').add(encrypted));
  },

  async put(store, data) {
    await openDB();
    const encrypted = await this._encryptBeforeStore(store, data);
    return reqP(tx(store, 'readwrite').put(encrypted));
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
      // BUG #12 FIX: Limitar número de cuotas a máximo 12
      if (v.numCuotas > 12) {
        throw new Error('Maximum 12 installments allowed');
      }

      try {
        const montoCuota = Math.round(v.precioVenta / v.numCuotas);
        const lastCuota = v.precioVenta - montoCuota * (v.numCuotas - 1);
        // primeraPagada !== false: por defecto la primera cuota se cobra al vender.
        // primerPago (opcional): monto arbitrario cobrado al vender — se aplica
        // sobre las cuotas en orden (cubre la 1ª, el excedente pasa a la 2ª, etc.)
        const primeraPagada = v.primeraPagada !== false;
        let inicialRestante = 0;
        if (primeraPagada) {
          inicialRestante = (v.primerPago === null || v.primerPago === undefined)
            ? montoCuota
            : Math.max(0, Math.min(v.primerPago, v.precioVenta));
        }
        for (let i = 0; i < v.numCuotas; i++) {
          // BUG #10 FIX: Usar fecha segura para suma de meses (evita problemas fin de mes)
          const vence = new Date();
          const targetMonth = vence.getMonth() + i;
          const targetYear = vence.getFullYear() + Math.floor(targetMonth / 12);
          vence.setFullYear(targetYear, targetMonth % 12, 1);
          vence.setDate(Math.min(new Date(targetYear, targetMonth % 12 + 1, 0).getDate(), new Date().getDate()));
          const isLast = i === v.numCuotas - 1;
          const monto = isLast ? lastCuota : montoCuota;
          const pago = Math.min(monto, inicialRestante);
          inicialRestante -= pago;
          await this.add('cuotas', {
            ventaId: id,
            perfume: v.perfume,
            cliente: v.cliente,
            numero: i + 1,
            total: v.numCuotas,
            monto,
            montoTotal: v.precioVenta,
            pagado: pago >= monto,
            montoPagado: pago,
            pagos: pago > 0 ? [{ monto: pago, fecha: Date.now() }] : [],
            vence: vence.getTime()
          });
        }
      } catch (e) {
        // BUG #14 FIX: Si falla creación de cuotas, loguear y propagar error
        console.error('Failed to create installments:', e.message);
        throw new Error('Failed to create installments: ' + e.message);
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

      // BUG #4 FIX: Validar que no se pague más que el monto de la cuota
      if (totalPagado > c.monto) {
        const exceso = totalPagado - c.monto;
        throw new Error(`Sobrepago de ${exceso.toFixed(2)}: solo resta ${(c.monto - prevPagado).toFixed(2)} para esta cuota`);
      }

      c.montoPagado = totalPagado;
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

  async getVentasByPerfume(perfumeId) {
    await openDB();
    const index = tx('ventas', 'readonly').index('perfumeId');
    return reqP(index.getAll(perfumeId));
  },

  async getVentasByCliente(cliente) {
    await openDB();
    const index = tx('ventas', 'readonly').index('cliente');
    return reqP(index.getAll(cliente));
  },

  async getCuotasSinPagar() {
    await openDB();
    const index = tx('cuotas', 'readonly').index('pagado');
    return reqP(index.getAll(false));
  },

  async getCuotasPorVencer(diasAdelante = 30) {
    await openDB();
    const ahora = Date.now();
    const fecha = ahora + (diasAdelante * 86400000);
    const cuotas = await this.getAll('cuotas');
    return cuotas.filter(c => c.vence && c.vence <= fecha && !c.pagado);
  },

  async getCajaByTipo(tipo) {
    await openDB();
    const index = tx('caja', 'readonly').index('tipo');
    return reqP(index.getAll(tipo));
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
      { perfume: 'Yara EDT', precioVenta: 4400, precioCompra: 3200, cliente: 'Susana', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 10, perfumeId: '' },
      { perfume: 'The Kingdom', precioVenta: 2600, precioCompra: 1800, cliente: 'Susana', vendedor: 'Mi negocio', formaPago: 'cuotas', numCuotas: 2, nota: '', fecha: now - day * 15, perfumeId: '' },
      { perfume: 'Haramain Gold', precioVenta: 3900, precioCompra: 2700, cliente: 'Pedro', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 5, perfumeId: '' },
      { perfume: 'Bharara King', precioVenta: 3900, precioCompra: 2700, cliente: 'María', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 3, perfumeId: '' },
      { perfume: 'Yara Rosa', precioVenta: 2500, precioCompra: 1700, cliente: 'Ana', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 2, perfumeId: '' },
      { perfume: 'Lattafa Pride', precioVenta: 3200, precioCompra: 2200, cliente: 'Carlos', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 1, perfumeId: '' },
      { perfume: 'Afnan 9PM', precioVenta: 3600, precioCompra: 2500, cliente: 'Laura', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 8, perfumeId: '' },
      { perfume: 'Haramain Gold', precioVenta: 3900, precioCompra: 2700, cliente: 'Jorge', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 12, perfumeId: '' },
      { perfume: 'Asad Negro', precioVenta: 2600, precioCompra: 1800, cliente: 'Lucía', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 7, perfumeId: '' },
      { perfume: 'Yara EDT', precioVenta: 4400, precioCompra: 3200, cliente: 'Roberto', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 4, perfumeId: '' },
      { perfume: 'Bharara King', precioVenta: 3900, precioCompra: 2700, cliente: 'Sofía', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 6, perfumeId: '' },
      { perfume: 'Afnan 9PM', precioVenta: 3600, precioCompra: 2500, cliente: 'Diego', vendedor: 'Mi negocio', formaPago: 'contado', nota: '', fecha: now - day * 9, perfumeId: '' },
      { perfume: 'Yara EDT', precioVenta: 4400, precioCompra: 3200, cliente: 'Martín', vendedor: 'Mi negocio', formaPago: 'contado', nota: 'Entrega el viernes', fecha: now, perfumeId: '' },
    ];

    for (const v of demoVentas) {
      await this.addVenta(v);
    }
  }

