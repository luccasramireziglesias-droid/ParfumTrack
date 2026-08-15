
  async init() {
    await openDB();
  },

  _encryptedStores: new Set(['perfumes', 'ventas', 'cuotas', 'pedidos', 'gastos', 'caja', 'compras', 'reservas']),

  // Toda operación que toca stock hace leer-modificar-escribir en dos
  // transacciones distintas (get y put son transacciones separadas, y con
  // cifrado activo no se pueden unir: descifrar es async y eso cierra la
  // transacción de IndexedDB). Sin serializar, dos pestañas leían el mismo
  // stock y escribían el mismo valor: un descuento se perdía y la app
  // mostraba más inventario del que había. Con 20 ventas en paralelo desde
  // dos pestañas, el stock bajaba 13 en vez de 20.
  //
  // Web Locks es cross-tab, que es justo el caso que importa. Donde no está,
  // se cae a una cola en memoria: no cubre dos pestañas, pero sí dos
  // operaciones simultáneas en la misma.
  _colaStock: Promise.resolve(),

  async _conLockStock(fn) {
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return navigator.locks.request('pt_stock', fn);
    }
    const anterior = this._colaStock;
    let liberar;
    this._colaStock = new Promise(r => { liberar = r; });
    try {
      await anterior;
      return await fn();
    } finally {
      liberar();
    }
  },

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

  // ── Reparto de cuotas ─────────────────────────────────────────────────────────
  // 🔴 Estas dos funciones son la ÚNICA fuente de los montos de las cuotas. Antes el
  // cálculo estaba copiado en `_addVentaImpl` y en `revertirDevolucion`, y las dos copias
  // podían dar montos distintos para la misma venta.

  /**
   * Reparte `total` en `n` partes enteras lo más parejas posible.
   * La suma SIEMPRE da `total` exacto — es el invariante que verifica el fuzzer.
   *
   * ⚠️ No usar `total - base * (n - 1)` para la última, que es como estaba antes:
   * con `Math.round` y montos chicos ese cálculo da **negativo**. Ejemplo real:
   * 13 en 8 cuotas → base 2, última = 13 − 14 = −1.
   */
  _partesIguales(total, n) {
    const cant = Math.max(1, Math.floor(n) || 1);
    const monto = Number(total) || 0;
    if (cant === 1) return [monto];
    const base = Math.floor(monto / cant);
    const partes = Array.from({ length: cant }, () => base);
    // Lo que sobra se reparte de a 1 desde la primera, así ninguna cuota queda a más
    // de 1 de distancia de otra. El resto fraccionario (centavos) cae en la última,
    // que es donde menos molesta.
    let resto = monto - base * cant;
    for (let i = 0; i < cant && resto >= 1; i++) { partes[i] += 1; resto -= 1; }
    if (resto > 0) partes[cant - 1] += resto;
    return partes;
  },

  /**
   * Montos de las cuotas de una venta.
   *
   * Con pago inicial, ese pago **es la cuota 1** y lo que queda se reparte parejo entre
   * las que siguen. Antes el excedente del pago inicial se derramaba sobre la cuota
   * siguiente: cobrar $2.000 de una venta de $5.890 en 3 dejaba la cuota 2 con un
   * "pagado $37 de $1.963", y todos los recordatorios pedían $1.926 en vez de una cuota
   * entera. Decisión del dueño (31/07/2026): repartir lo que resta. Ver BUG-31.
   */
  _repartirCuotas(precioVenta, numCuotas, pagoInicial = 0) {
    const total = Math.max(0, Number(precioVenta) || 0);
    const cant = Math.max(1, Math.floor(numCuotas) || 1);
    const inicial = Math.max(0, Math.min(Number(pagoInicial) || 0, total));
    if (cant === 1) return [total];
    if (!inicial) return this._partesIguales(total, cant);
    return [inicial, ...this._partesIguales(total - inicial, cant - 1)];
  },

  async addVenta(v) {
    return this._conLockStock(() => this._addVentaImpl(v));
  },

  async _addVentaImpl(v) {
    // Resolver el stock ANTES de insertar para dejar constancia en la venta de
    // si descontó una unidad o no. Sin ese dato, borrar una venta hecha con
    // stock en 0 devolvía al inventario una unidad que nunca existió.
    const cantidad = Math.max(1, parseInt(v.cantidad, 10) || 1);
    let unidadesDescontadas = 0;
    let perfumeADescontar = null;
    if (v.perfumeId && v.perfumeId !== '') {
      const p = await this.get('perfumes', v.perfumeId);
      if (p && p.stock > 0) {
        perfumeADescontar = p;
        // Nunca dejar el stock en negativo: se descuenta lo que realmente hay
        unidadesDescontadas = Math.min(cantidad, p.stock);
      }
    }
    const id = await this.add('ventas', {
      ...v, fecha: v.fecha || Date.now(),
      stockDescontado: unidadesDescontadas > 0,
      unidadesDescontadas
    });
    if (perfumeADescontar && unidadesDescontadas > 0) {
      perfumeADescontar.stock = Math.max(0, perfumeADescontar.stock - unidadesDescontadas);
      await this.put('perfumes', perfumeADescontar);
    }
    if (v.formaPago === 'cuotas' && v.numCuotas > 1) {
      // BUG #12 FIX: Limitar número de cuotas a máximo 12
      if (v.numCuotas > 12) {
        throw new Error('Maximum 12 installments allowed');
      }

      try {
        // El pago inicial ES la cuota 1, y lo que resta se reparte parejo entre las que
        // siguen. Ver `_repartirCuotas`.
        const primeraPagada = v.primeraPagada !== false;
        const pagoInicial = !primeraPagada ? 0
          : (v.primerPago === null || v.primerPago === undefined)
            ? this._partesIguales(v.precioVenta, v.numCuotas)[0]
            : Math.max(0, Math.min(v.primerPago, v.precioVenta));
        const montos = this._repartirCuotas(v.precioVenta, v.numCuotas, primeraPagada ? pagoInicial : 0);
        for (let i = 0; i < v.numCuotas; i++) {
          // BUG #10 FIX: Usar fecha segura para suma de meses (evita problemas fin de mes)
          const vence = new Date();
          const targetMonth = vence.getMonth() + i;
          const targetYear = vence.getFullYear() + Math.floor(targetMonth / 12);
          vence.setFullYear(targetYear, targetMonth % 12, 1);
          vence.setDate(Math.min(new Date(targetYear, targetMonth % 12 + 1, 0).getDate(), new Date().getDate()));
          const monto = montos[i];
          // Solo la primera queda cobrada al vender; el resto arranca en cero. Antes el
          // excedente se derramaba sobre la siguiente y dejaba cobros a medias.
          const pago = (i === 0 && primeraPagada) ? monto : 0;
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
    return this._conLockStock(() => this._updateVentaImpl(v));
  },

  async _updateVentaImpl(v) {
    const prev = await this.get('ventas', v.id);
    const norm = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
    const cantidad = Math.max(1, parseInt(v.cantidad, 10) || 1);
    const prevCantidad = prev ? Math.max(1, parseInt(prev.cantidad, 10) || 1) : 0;
    const prevPerfumeId = prev ? norm(prev.perfumeId) : null;
    const nuevoPerfumeId = norm(v.perfumeId);

    // Solo tocar el inventario si cambió el perfume o la cantidad: si el usuario
    // edita el cliente o la nota, el stock no se mueve.
    let unidadesDescontadas = prev
      ? (prev.unidadesDescontadas !== undefined ? prev.unidadesDescontadas : (prev.stockDescontado !== false ? 1 : 0))
      : 0;
    const cambioStock = !prev || prevPerfumeId !== nuevoPerfumeId || prevCantidad !== cantidad;

    if (cambioStock) {
      // Devolver lo que había descontado la versión anterior…
      if (prevPerfumeId && unidadesDescontadas > 0) {
        const p = await this.get('perfumes', prevPerfumeId);
        if (p) {
          p.stock = (p.stock || 0) + unidadesDescontadas;
          await this.put('perfumes', p);
        }
      }
      // …y descontar lo que pide la versión nueva (sin dejar stock negativo)
      unidadesDescontadas = 0;
      if (nuevoPerfumeId) {
        const p = await this.get('perfumes', nuevoPerfumeId);
        if (p && p.stock > 0) {
          unidadesDescontadas = Math.min(cantidad, p.stock);
          p.stock = Math.max(0, p.stock - unidadesDescontadas);
          await this.put('perfumes', p);
        }
      }
    }

    return this.put('ventas', {
      ...v,
      stockDescontado: unidadesDescontadas > 0,
      unidadesDescontadas
    });
  },

  async deleteVenta(id) {
    return this._conLockStock(() => this._deleteVentaImpl(id));
  },

  async _deleteVentaImpl(id) {
    const v = await this.get('ventas', id);
    if (v) {
      // Solo devolver stock si esta venta lo descontó. Las ventas viejas (sin
      // el flag) mantienen el comportamiento previo para no cambiar su historial.
      // Devolver exactamente las unidades que esta venta descontó
      const aDevolver = v.unidadesDescontadas !== undefined
        ? v.unidadesDescontadas
        : (v.stockDescontado !== false ? 1 : 0);
      if (v.perfumeId && v.perfumeId !== '' && aDevolver > 0) {
        const p = await this.get('perfumes', v.perfumeId);
        if (p) {
          p.stock = (p.stock || 0) + aDevolver;
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

  // F3: la venta se marca como devuelta en vez de borrarse. Queda en el
  // historial (con motivo y fecha) pero deja de contar para la ganancia.
  async devolverVenta(id, opciones = {}) {
    return this._conLockStock(() => this._devolverVentaImpl(id, opciones));
  },

  async _devolverVentaImpl(id, { motivo = '', nota = '', reponerStock = true } = {}) {
    const v = await this.get('ventas', id);
    if (!v) throw new Error('VENTA_NO_ENCONTRADA');
    if (v.devuelta) throw new Error('YA_DEVUELTA');

    const unidades = v.unidadesDescontadas !== undefined
      ? v.unidadesDescontadas
      : (v.stockDescontado !== false && v.perfumeId ? 1 : 0);
    let repuestas = 0;
    if (reponerStock && unidades > 0 && v.perfumeId && v.perfumeId !== '') {
      const p = await this.get('perfumes', v.perfumeId);
      if (p) {
        p.stock = (p.stock || 0) + unidades;
        await this.put('perfumes', p);
        repuestas = unidades;
      }
    }

    // Las cuotas que nunca se cobraron dejan de ser deuda; las que tienen
    // plata puesta se conservan porque ese cobro sí ocurrió.
    let cobrado = 0;
    let canceladas = 0;
    if (v.formaPago === 'cuotas') {
      for (const c of await this.getAll('cuotas')) {
        if (c.ventaId !== id) continue;
        const pagado = c.pagado ? (c.montoPagado || c.monto || 0) : (c.montoPagado || 0);
        if (pagado > 0) {
          cobrado += pagado;
        } else {
          await this.delete('cuotas', c.id);
          canceladas++;
        }
      }
    } else {
      cobrado = v.precioVenta || 0;
    }

    return this.put('ventas', {
      ...v,
      devuelta: true,
      fechaDevolucion: Date.now(),
      motivoDevolucion: motivo,
      notaDevolucion: nota,
      unidadesRepuestas: repuestas,
      cuotasCanceladas: canceladas,
      montoADevolver: cobrado
    });
  },

  // Deshacer una devolución cargada por error: vuelve a descontar el stock que
  // se había repuesto y recrea las cuotas que la devolución canceló. Lo
  // segundo no estaba y lo encontró el fuzzer: la venta volvía a contar para
  // la ganancia pero la deuda del cliente desaparecía.
  async revertirDevolucion(id) {
    return this._conLockStock(() => this._revertirDevolucionImpl(id));
  },

  async _revertirDevolucionImpl(id) {
    const v = await this.get('ventas', id);
    if (!v) throw new Error('VENTA_NO_ENCONTRADA');
    if (!v.devuelta) return v;

    const repuestas = v.unidadesRepuestas || 0;
    let descontadas = v.unidadesDescontadas !== undefined ? v.unidadesDescontadas : 0;
    if (repuestas > 0 && v.perfumeId && v.perfumeId !== '') {
      const p = await this.get('perfumes', v.perfumeId);
      if (p) {
        const aDescontar = Math.min(repuestas, p.stock || 0);
        p.stock = Math.max(0, (p.stock || 0) - aDescontar);
        await this.put('perfumes', p);
        descontadas = aDescontar;
      }
    }

    // Recrear las cuotas que la devolución canceló. Sin esto la venta volvía
    // a contar para la ganancia pero la deuda del cliente desaparecía: una
    // venta de 3000 en 3 cuotas con una paga quedaba con 0 por cobrar en vez
    // de 2000. Las ya cobradas se dejan como están.
    if (v.formaPago === 'cuotas' && v.numCuotas > 1) {
      const existentes = (await this.getAll('cuotas')).filter(c => c.ventaId === id);
      const numeros = new Set(existentes.map(c => c.numero));
      // Mismo reparto que al crear la venta: si acá se calculara distinto, deshacer una
      // devolución dejaría cuotas con montos que no coinciden con los originales.
      const montos = this._repartirCuotas(v.precioVenta, v.numCuotas,
        v.primeraPagada === false ? 0 : v.primerPago);
      for (let i = 1; i <= v.numCuotas; i++) {
        if (numeros.has(i)) continue;
        const vence = new Date();
        vence.setMonth(vence.getMonth() + (i - 1));
        await this.add('cuotas', {
          ventaId: id,
          perfume: v.perfume,
          cliente: v.cliente,
          numero: i,
          total: v.numCuotas,
          monto: montos[i - 1],
          montoTotal: v.precioVenta,
          pagado: false,
          montoPagado: 0,
          pagos: [],
          vence: vence.getTime(),
        });
      }
    }

    const limpia = { ...v, unidadesDescontadas: descontadas, stockDescontado: descontadas > 0 };
    delete limpia.devuelta;
    delete limpia.fechaDevolucion;
    delete limpia.motivoDevolucion;
    delete limpia.notaDevolucion;
    delete limpia.unidadesRepuestas;
    delete limpia.cuotasCanceladas;
    delete limpia.montoADevolver;
    return this.put('ventas', limpia);
  },

  // F4: reposición de stock comprándole al proveedor. Deja registro del
  // costo real de cada tanda, que es lo que después explica la ganancia.
  async registrarCompra(opciones = {}) {
    return this._conLockStock(() => this._registrarCompraImpl(opciones));
  },

  async _registrarCompraImpl({ perfumeId, cantidad, precioUnitario, proveedor = '', fecha, nota = '', actualizarCosto = true } = {}) {
    const cant = Math.max(1, parseInt(cantidad, 10) || 0);
    if (!cant) throw new Error('CANTIDAD_INVALIDA');
    const precio = Number(precioUnitario);
    if (!Number.isFinite(precio) || precio < 0) throw new Error('PRECIO_INVALIDO');

    const p = perfumeId ? await this.get('perfumes', perfumeId) : null;
    if (!p) throw new Error('PERFUME_NO_ENCONTRADO');

    p.stock = (p.stock || 0) + cant;
    // El costo de la última tanda pasa a ser el costo de referencia
    if (actualizarCosto && precio > 0) p.precioCompra = precio;
    await this.put('perfumes', p);

    const id = await this.add('compras', {
      perfumeId,
      perfume: p.nombre,
      cantidad: cant,
      precioUnitario: precio,
      total: precio * cant,
      proveedor,
      nota,
      costoActualizado: !!(actualizarCosto && precio > 0),
      fecha: fecha || Date.now()
    });
    return this.get('compras', id);
  },

  // Deshacer una compra cargada por error: descuenta lo que había sumado,
  // sin dejar el stock en negativo (puede haberse vendido parte).
  async eliminarCompra(id) {
    return this._conLockStock(() => this._eliminarCompraImpl(id));
  },

  async _eliminarCompraImpl(id) {
    const c = await this.get('compras', id);
    if (c && c.perfumeId) {
      const p = await this.get('perfumes', c.perfumeId);
      if (p) {
        p.stock = Math.max(0, (p.stock || 0) - (c.cantidad || 0));
        await this.put('perfumes', p);
      }
    }
    return this.delete('compras', id);
  },

  async getCompras() {
    const compras = await this.getAll('compras');
    return compras.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  },

  // F5: señas y encargos. Una reserva puede existir sin stock (lista de
  // espera) — por eso NO descuenta inventario hasta que se entrega.
  async getReservas() {
    const r = await this.getAll('reservas');
    return r.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  },

  async addReserva(r) {
    const cantidad = Math.max(1, parseInt(r.cantidad, 10) || 1);
    const precio = Number(r.precioAcordado);
    if (!Number.isFinite(precio) || precio <= 0) throw new Error('PRECIO_INVALIDO');
    const total = precio * cantidad;
    // La seña nunca puede superar lo que se va a cobrar
    const sena = Math.max(0, Math.min(Number(r.sena) || 0, total));
    const id = await this.add('reservas', {
      ...r,
      cantidad,
      precioAcordado: precio,
      total,
      sena,
      estado: 'pendiente',
      fecha: r.fecha || Date.now()
    });
    return this.get('reservas', id);
  },

  async updateReserva(r) {
    return this.put('reservas', r);
  },

  // Entregar = la reserva se convierte en venta. La seña ya cobrada no se
  // suma de nuevo: es parte del precio acordado, no un extra.
  async entregarReserva(id, { precioCompra = 0 } = {}) {
    const r = await this.get('reservas', id);
    if (!r) throw new Error('RESERVA_NO_ENCONTRADA');
    if (r.estado !== 'pendiente') throw new Error('RESERVA_NO_PENDIENTE');

    const cantidad = Math.max(1, parseInt(r.cantidad, 10) || 1);
    const costoUnit = Number(precioCompra) || 0;
    const ventaId = await this.addVenta({
      perfume: r.perfume,
      perfumeId: r.perfumeId || null,
      cantidad,
      precioVenta: r.total,
      precioOriginal: r.total,
      precioCompra: costoUnit * cantidad,
      precioUnitario: r.precioAcordado,
      precioCompraUnitario: costoUnit,
      cliente: r.cliente || 'Anónimo',
      vendedor: r.vendedor || 'Anónimo',
      proveedor: r.proveedor || '',
      descuento: 0,
      nota: r.sena > 0 ? `Seña de ${r.sena} ya cobrada` : '',
      fecha: Date.now(),
      formaPago: 'contado',
      numCuotas: 1,
      reservaId: id
    });

    await this.put('reservas', { ...r, estado: 'entregada', fechaEntrega: Date.now(), ventaId });
    return ventaId;
  },

  // Cancelar deja constancia de si la seña se devolvió o se retuvo.
  async cancelarReserva(id, { devolverSena = true, motivo = '' } = {}) {
    const r = await this.get('reservas', id);
    if (!r) throw new Error('RESERVA_NO_ENCONTRADA');
    if (r.estado === 'entregada') throw new Error('RESERVA_YA_ENTREGADA');
    return this.put('reservas', {
      ...r,
      estado: 'cancelada',
      fechaCancelacion: Date.now(),
      senaDevuelta: !!devolverSena,
      motivoCancelacion: motivo
    });
  },

  async eliminarReserva(id) {
    return this.delete('reservas', id);
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
    // Sembrar SOLO la primera vez en la vida de la instalación. Sin este flag,
    // borrar los datos (o quedarse sin perfumes) hacía que al reabrir la app
    // reaparecieran 8 perfumes y 13 ventas de demo mezcladas con las reales.
    if (localStorage.getItem('pt_demo_seeded') === '1') return;

    const perfumes = await this.getPerfumes();
    const ventas = await this.getAll('ventas');
    if (perfumes.length > 0 || ventas.length > 0) {
      // Ya hay datos del usuario: marcar como sembrado y no tocar nada nunca más
      localStorage.setItem('pt_demo_seeded', '1');
      return;
    }
    localStorage.setItem('pt_demo_seeded', '1');

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

