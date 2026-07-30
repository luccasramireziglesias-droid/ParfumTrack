

  // ====== CLIENTES (Ciclo 2 Omega) ======
  // Los clientes son entidad derivada de las ventas + cuotas (no hay store
  // propio: se agregan al vuelo, así siempre quedan consistentes con las ventas).

  _clienteActual: null,

  // Clave de agrupación: nombre normalizado (sin espacios ni mayúsculas) para
  // que "Ana", " ana " y "ANA" sean el mismo cliente
  _clienteKey(nombre) {
    return (nombre || '').trim().toLowerCase();
  },

  _agregarClientes() {
    const mapa = {};
    for (const v of this._ventasActivas()) {
      const key = this._clienteKey(v.cliente);
      if (!key || key === 'anónimo') continue;
      if (!mapa[key]) mapa[key] = { nombre: (v.cliente || '').trim(), totalComprado: 0, numVentas: 0, ultimaCompra: 0, saldo: 0 };
      mapa[key].totalComprado += v.precioVenta || 0;
      mapa[key].numVentas++;
      if ((v.fecha || 0) > mapa[key].ultimaCompra) mapa[key].ultimaCompra = v.fecha || 0;
    }
    // Saldo pendiente por cliente (cuotas no pagadas)
    for (const c of this.cuotasData) {
      if (c.pagado) continue;
      const key = this._clienteKey(c.cliente);
      if (!mapa[key]) continue;
      mapa[key].saldo += (c.monto || 0) - (c.montoPagado || 0);
    }
    return Object.entries(mapa).map(([key, d]) => ({ key, ...d }));
  },

  renderClientes() {
    const search = (document.getElementById('clientes-search')?.value || '').trim().toLowerCase();
    let clientes = this._agregarClientes();

    // Header: totales
    const totalClientes = clientes.length;
    const totalSaldo = clientes.reduce((s, c) => s + c.saldo, 0);
    const elCount = document.getElementById('clientes-count');
    const elSaldo = document.getElementById('clientes-saldo');
    if (elCount) elCount.textContent = totalClientes;
    if (elSaldo) elSaldo.textContent = this.fmt(totalSaldo);

    if (search) clientes = clientes.filter(c => c.nombre.toLowerCase().includes(search));
    // Orden: primero los que deben (saldo desc), luego por compra más reciente
    clientes.sort((a, b) => (b.saldo - a.saldo) || (b.ultimaCompra - a.ultimaCompra));

    const container = document.getElementById('clientes-list');
    if (!container) return;
    if (clientes.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="ms">group</span><span>' +
        (search ? 'Sin resultados' : 'Todavía no hay clientes. Registrá una venta con nombre de cliente.') + '</span></div>';
      return;
    }

    container.innerHTML = clientes.map(c => {
      const inicial = this.esc((c.nombre[0] || '?').toUpperCase());
      const saldoTag = c.saldo > 0
        ? `<span class="cliente-saldo debe">Debe ${this.fmt(c.saldo)}</span>`
        : `<span class="cliente-saldo ok">Al día</span>`;
      return `<div class="cliente-card" role="button" tabindex="0" aria-label="Ver cliente ${this.escAttr(c.nombre)}" onclick="App.abrirClienteDetalle(decodeURIComponent('${encodeURIComponent(c.key).replace(/'/g, '%27')}'))">
        <div class="cliente-avatar">${inicial}</div>
        <div class="cliente-info">
          <div class="cliente-nombre">${this.esc(c.nombre)}</div>
          <div class="cliente-meta">${c.numVentas} compra${c.numVentas !== 1 ? 's' : ''} · ${this.fmt(c.totalComprado)} · última ${this.fmtDate(c.ultimaCompra)}</div>
        </div>
        <div class="cliente-right">${saldoTag}<span class="ms muted chevron">chevron_right</span></div>
      </div>`;
    }).join('');
  },

  filterClientes() {
    // Debounce: evita recalcular la agregación de clientes en cada tecla
    this.debounce('buscar-clientes', () => this.renderClientes(), 150);
  },

  abrirClienteDetalle(key) {
    this._clienteActual = key;
    this.showScreen('cliente-detalle');
  },

  renderClienteDetalle() {
    const key = this._clienteActual;
    const cliente = this._agregarClientes().find(c => c.key === key);
    const cont = document.getElementById('cliente-detalle-content');
    if (!cont) return;
    if (!cliente) {
      cont.innerHTML = '<div class="empty-state"><span class="ms">person_off</span><span>Cliente no encontrado</span></div>';
      return;
    }

    document.getElementById('cliente-detalle-titulo').textContent = cliente.nombre;

    const ventasCliente = this.ventas
      .filter(v => this._clienteKey(v.cliente) === key)
      .sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
    const cuotasPend = this.cuotasData
      .filter(c => !c.pagado && this._clienteKey(c.cliente) === key)
      .sort((a, b) => (a.vence || 0) - (b.vence || 0));

    const waMsg = cliente.saldo > 0
      ? `Hola ${cliente.nombre}! 👋 Te recuerdo que tenés un saldo pendiente de *${this.fmt(cliente.saldo)}*. Avisame cuando puedas pagar!`
      : `Hola ${cliente.nombre}! 👋 ¿Querés hacer un nuevo pedido? Tengo novedades.`;

    let html = `
      <div class="hero-card" style="padding:16px 18px;margin-bottom:14px;">
        <div style="display:flex;gap:14px;">
          <div><div class="hero-label">Total comprado</div><div style="font:700 22px 'DM Sans';color:var(--text);">${this.fmt(cliente.totalComprado)}</div></div>
          <div style="border-left:1px solid var(--border);padding-left:14px;"><div class="hero-label">Saldo pendiente</div><div style="font:700 22px 'DM Sans';color:${cliente.saldo > 0 ? 'var(--red)' : 'var(--green)'};">${this.fmt(cliente.saldo)}</div></div>
        </div>
        <div style="font:500 12px 'DM Sans';color:var(--text3);margin-top:10px;">${cliente.numVentas} compra${cliente.numVentas !== 1 ? 's' : ''} · última ${this.fmtDate(cliente.ultimaCompra)}</div>
      </div>
      <button class="btn-whatsapp btn-full" style="margin-bottom:16px;" data-msg="${this.b64Encode(waMsg)}" aria-label="Contactar por WhatsApp"><span class="ms" aria-hidden="true">chat</span>Contactar por WhatsApp</button>`;

    if (cuotasPend.length > 0) {
      html += `<div class="section-header"><span class="section-title">Cuotas pendientes</span></div>`;
      html += cuotasPend.map(c => {
        const resta = (c.monto || 0) - (c.montoPagado || 0);
        return `<div class="cliente-cuota-row">
          <div><div style="font:600 13px 'DM Sans';color:var(--text);">${this.esc(c.perfume || '—')}</div>
          <div style="font:500 11px 'DM Sans';color:var(--text3);">Cuota ${c.numero}/${c.total} · vence ${this.fmtDate(c.vence)}</div></div>
          <span class="danger bold">${this.fmt(resta)}</span>
        </div>`;
      }).join('');
    }

    html += `<div class="section-header" style="margin-top:16px;"><span class="section-title">Historial de compras</span></div>`;
    html += ventasCliente.map(v => this._renderVentaCard(v, { style: 'margin-bottom:8px;' })).join('');

    cont.innerHTML = html;
  },
