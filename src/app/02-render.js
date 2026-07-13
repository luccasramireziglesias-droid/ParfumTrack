

  // ====== RENDER ======

  _debounceTimers: {},
  _dashboardMonth: null,
  _dashboardYear: null,

  debounce(key, fn, ms = 100) {
    clearTimeout(this._debounceTimers[key]);
    this._debounceTimers[key] = setTimeout(fn, ms);
  },

  renderAll() {
    this.debounce('renderAll', () => {
      this.renderDashboard();
      this.renderStock();
      this.renderCuotas();
      this.renderStats();
      this.updateNavBadge();
      this.updatePedidosBadge();
    });
  },

  changeDashboardMonth(offset) {
    const now = new Date();
    if (!this._dashboardMonth) this._dashboardMonth = now.getMonth();
    if (!this._dashboardYear) this._dashboardYear = now.getFullYear();

    this._dashboardMonth += offset;
    if (this._dashboardMonth > 11) {
      this._dashboardMonth = 0;
      this._dashboardYear += 1;
    } else if (this._dashboardMonth < 0) {
      this._dashboardMonth = 11;
      this._dashboardYear -= 1;
    }

    this.renderDashboard();
  },

  resetDashboardMonth() {
    this._dashboardMonth = null;
    this._dashboardYear = null;
    this.renderDashboard();
  },

  renderDashboard() {
    const now = new Date();
    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const el = (id) => document.getElementById(id);

    // Usar mes seleccionado o mes actual
    const displayMonth = this._dashboardMonth ?? now.getMonth();
    const displayYear = this._dashboardYear ?? now.getFullYear();

    el('hero-month').textContent = monthNames[displayMonth] + ' ' + displayYear;

    const thisMonth = this.ventas.filter(v => {
      const d = new Date(v.fecha);
      return d.getMonth() === displayMonth && d.getFullYear() === displayYear;
    });

    // Ganancia REAL = lo cobrado (precioVenta, ya con descuento) menos el costo
    const ganancia = thisMonth.reduce((s, v) => s + (v.precioVenta - v.precioCompra), 0);
    const totalVentas = thisMonth.length;
    const totalVenta = thisMonth.reduce((s, v) => s + v.precioVenta, 0);

    el('hero-ganancia').textContent = this.fmt(ganancia);
    el('hero-ventas-count').textContent = totalVentas + ' ventas registradas';
    el('stat-ventas').textContent = totalVentas;

    const prevMonthNum = displayMonth === 0 ? 11 : displayMonth - 1;
    const prevMonthYear = displayMonth === 0 ? displayYear - 1 : displayYear;
    const prevMonth = new Date(prevMonthYear, prevMonthNum, 1);
    const prevVentas = this.ventas.filter(v => {
      const d = new Date(v.fecha);
      return d.getMonth() === prevMonth.getMonth() && d.getFullYear() === prevMonth.getFullYear();
    });
    const prevGanancia = prevVentas.reduce((s, v) => s + (v.precioVenta - v.precioCompra), 0);

    const badge = el('hero-trend');
    if (prevGanancia > 0) {
      const pct = Math.round(((ganancia - prevGanancia) / prevGanancia) * 100);
      badge.innerHTML = `<span class="ms">${pct >= 0 ? 'trending_up' : 'trending_down'}</span>${pct >= 0 ? '+' : ''}${pct}%`;
      badge.className = pct >= 0 ? 'hero-badge' : 'hero-badge negative';
    } else {
      badge.innerHTML = '<span class="ms">trending_up</span>—';
      badge.className = 'hero-badge';
    }

    const compareEl = el('month-compare');
    if (compareEl) {
      if (prevVentas.length > 0 || thisMonth.length > 0) {
        const prevTotal = prevVentas.reduce((s, v) => s + v.precioVenta, 0);
        const prevMonthName = monthNames[prevMonth.getMonth()];
        const diff = ganancia - prevGanancia;
        const diffColor = diff >= 0 ? 'var(--green)' : 'var(--red)';
        const diffIcon = diff >= 0 ? 'arrow_upward' : 'arrow_downward';
        compareEl.classList.remove('hidden');
        compareEl.innerHTML = `
          <div style="font:600 12px 'DM Sans';color:var(--text3);margin-bottom:10px;display:flex;align-items:center;gap:6px;">
            <span class="ms" style="font-size:16px;color:var(--gold);">compare_arrows</span>Este mes vs ${prevMonthName}
          </div>
          <div style="display:flex;gap:8px;">
            <div style="flex:1;text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:10px;">
              <div style="font:500 10px 'DM Sans';color:var(--text4);text-transform:uppercase;margin-bottom:4px;">Ganancia</div>
              <div style="font:700 15px 'DM Sans';color:var(--text);">${this.fmt(ganancia)}</div>
              <div style="font:500 10px 'DM Sans';color:var(--text4);">vs ${this.fmt(prevGanancia)}</div>
            </div>
            <div style="flex:1;text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:10px;">
              <div style="font:500 10px 'DM Sans';color:var(--text4);text-transform:uppercase;margin-bottom:4px;">Ventas</div>
              <div style="font:700 15px 'DM Sans';color:var(--text);">${totalVentas}</div>
              <div style="font:500 10px 'DM Sans';color:var(--text4);">vs ${prevVentas.length}</div>
            </div>
            <div style="flex:1;text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:10px;">
              <div style="font:500 10px 'DM Sans';color:var(--text4);text-transform:uppercase;margin-bottom:4px;">Diferencia</div>
              <div style="font:700 15px 'DM Sans';color:${diffColor};display:flex;align-items:center;justify-content:center;gap:2px;"><span class="ms" style="font-size:16px;">${diffIcon}</span>${this.fmt(Math.abs(diff))}</div>
              <div style="font:500 10px 'DM Sans';color:${diffColor};">${diff >= 0 ? '+' : ''}${prevGanancia > 0 ? Math.round((diff / prevGanancia) * 100) : 0}%</div>
            </div>
          </div>`;
      } else {
        compareEl.classList.add('hidden');
      }
    }

    const pendientes = this.cuotasData.filter(c => !c.pagado);
    const totalCobrar = pendientes.reduce((s, c) => s + c.monto - (c.montoPagado || 0), 0);
    el('stat-cobrar').textContent = this.fmt(totalCobrar);
    const deudasUnicas = new Set(pendientes.map(c => c.ventaId)).size;
    el('stat-deudas').textContent = deudasUnicas + ' deuda' + (deudasUnicas !== 1 ? 's' : '') + ' activa' + (deudasUnicas !== 1 ? 's' : '');

    const vendedores = {};
    thisMonth.forEach(v => {
      const key = v.vendedor || 'Anónimo';
      vendedores[key] = (vendedores[key] || 0) + (v.precioVenta - v.precioCompra);
    });
    const mejorV = Object.entries(vendedores).sort((a, b) => b[1] - a[1])[0];
    el('stat-mejor').innerHTML = mejorV ? `${this.esc(mejorV[0])} <span class="green">${this.fmt(mejorV[1])}</span>` : '—';

    const ticket = totalVentas > 0 ? Math.round(totalVenta / totalVentas) : 0;
    el('stat-ticket').textContent = this.fmt(ticket);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayVentas = this.ventas.filter(v => { const d = new Date(v.fecha); return d >= today && d < tomorrow; });
    const todayGan = todayVentas.reduce((s, v) => s + (v.precioVenta - v.precioCompra), 0);
    el('today-amount').textContent = this.fmt(todayGan);
    el('today-count').textContent = todayVentas.length;

    const container = document.getElementById('ventas-recientes');
    const recientes = this.ventas.slice(0, 3);
    if (recientes.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="ms">receipt_long</span><span>No hay ventas registradas</span></div>';
      this._renderDashboardDeudores();
      return;
    }

    container.innerHTML = recientes.map((v, i) =>
      i > 0
        ? this._renderVentaCard(v, { compact: true, className: ' faded', style: 'margin-top:8px;' })
        : this._renderVentaCard(v)
    ).join('');

    this._renderDashboardDeudores();
  },

  _renderVentaCard(v, { compact = false, className = '', style = '' } = {}) {
    const num = this.ventas.length - this.ventas.indexOf(v);
    const fecha = this.fmtDate(v.fecha);
    const cls = `venta-card${className}`;
    const styleAttr = style ? ` style="${style}"` : '';

    if (compact) {
      return `<div class="${cls}"${styleAttr}>
          <div class="venta-top">
            <div>
              <div style="display:flex;align-items:center;gap:7px;">
                <span class="venta-num">#${num}</span>
                <span class="venta-nombre">${this.esc(v.perfume)}</span>
              </div>
            </div>
            <span class="venta-date">${fecha}</span>
          </div>
        </div>`;
    }

    // Ganancia REAL = lo cobrado (precioVenta, ya con descuento) menos el costo
    const gan = v.precioVenta - v.precioCompra;
    const esCuotas = v.formaPago === 'cuotas';
    return `<div class="${cls}"${styleAttr}>
        <div class="venta-top">
          <div>
            <div style="display:flex;align-items:center;gap:7px;">
              <span class="venta-num">#${num}</span>
              <span class="venta-nombre">${this.esc(v.perfume)}</span>
            </div>
            <div class="venta-tags">
              <span class="tag">${this.esc(v.vendedor || '—')}</span>
              ${v.proveedor ? `<span class="tag">${this.esc(v.proveedor)}</span>` : ''}
              ${v.descuento ? `<span class="tag" style="color:var(--gold2);">-${Math.round(v.descuento || 0)}%</span>` : ''}
              ${esCuotas
                ? `<span class="tag-cuotas">En cuotas</span>`
                : `<span class="tag-ok"><span class="ms">check_circle</span>Completada</span>`
              }
            </div>
          </div>
          <span class="venta-date">${fecha}</span>
        </div>
        <div class="venta-divider"></div>
        <div class="venta-bottom">
          <div>
            <div class="venta-precio-label">Precio venta</div>
            <div class="venta-precio-value">${this.fmt(v.precioVenta)}</div>
          </div>
          <div style="text-align:right;">
            <div class="venta-precio-label">Ganancia</div>
            <div class="venta-ganancia-value">${this.fmtSigned(gan)}</div>
          </div>
          <div class="venta-actions">
            <button class="venta-action-btn ms" onclick="App.repetirVenta(${v.id})" aria-label="Vender de nuevo">repeat</button>
            <button class="venta-action-btn ms" onclick="App.editVenta(${v.id})">edit</button>
            <button class="venta-action-btn ms" onclick="App.deleteVenta(${v.id})">delete</button>
          </div>
        </div>
      </div>`;
  },

  _renderDashboardDeudores() {
    const section = document.getElementById('dashboard-deudores');
    const list = document.getElementById('dashboard-deudores-list');
    if (!section || !list) return;

    const pendientes = this.cuotasData.filter(c => !c.pagado);
    if (pendientes.length === 0) {
      section.classList.add('hidden');
      list.innerHTML = '';
      return;
    }

    const byClient = {};
    pendientes.forEach(c => {
      const name = (c.cliente || 'Sin nombre').trim();
      if (!byClient[name]) byClient[name] = 0;
      byClient[name] += c.monto - (c.montoPagado || 0);
    });

    const sorted = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 3);
    section.classList.remove('hidden');
    list.innerHTML = sorted.map(([name, total]) => {
      const waMsg = `Hola ${name}! Te recuerdo que tenés un saldo pendiente de *${this.fmt(total)}*. Avisame cuando puedas pagar!`;
      // BUG #2 FIX: Usar data attribute en lugar de onclick inline
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
          <span class="ms" style="color:var(--gold);font-size:18px;">person</span>
          <span style="font:500 13px 'DM Sans';color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.esc(name)}</span>
        </div>
        <span style="font:700 14px 'DM Sans';color:var(--red);margin:0 10px;white-space:nowrap;">${this.fmt(total)}</span>
        <button class="btn-whatsapp" style="padding:8px 12px;border-radius:8px;font-size:12px;" data-msg="${this.b64Encode(waMsg)}"><span class="ms" style="font-size:16px;">chat</span></button>
      </div>`;
    }).join('');
  },

  renderAllVentas() {
    const container = document.getElementById('ventas-all-list');
    if (this.ventas.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="ms">receipt_long</span><span>No hay ventas registradas</span></div>';
      return;
    }

    container.innerHTML = this.ventas.map((v) =>
      this._renderVentaCard(v, { style: 'margin-bottom:8px;' })
    ).join('');
  },

  renderStock() {
    const grid = document.getElementById('stock-grid');
    const search = (document.getElementById('stock-search')?.value || '').toLowerCase();

    let items = this.perfumes;
    if (search) items = items.filter(p => p.nombre.toLowerCase().includes(search));
    if (this.stockFilter === 'sin') items = items.filter(p => p.stock === 0);
    if (this.stockFilter === 'bajo') items = items.filter(p => p.stock > 0 && p.stock <= 3);

    const sinStock = this.perfumes.filter(p => p.stock === 0).length;
    const bajoStock = this.perfumes.filter(p => p.stock > 0 && p.stock <= 3).length;
    const chipSin = document.getElementById('chip-sin');
    const chipBajo = document.getElementById('chip-bajo');
    if (chipSin) chipSin.textContent = sinStock;
    if (chipBajo) chipBajo.textContent = bajoStock;

    this._renderStockAlerts();

    if (items.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><span class="ms">inventory_2</span><span>No hay perfumes</span></div>';
      return;
    }

    grid.innerHTML = items.map(p => {
      const badgeClass = p.stock === 0 ? 'zero' : p.stock <= 3 ? 'low' : 'high';
      const hasFoto = p.foto && /^data:image\//.test(p.foto);
      return `<div class="stock-card">
        <div class="stock-photo" ${hasFoto ? `data-photo-id="${p.id}"` : ''} onclick="App.changeStockPhoto(${p.id})" style="cursor:pointer" title="Tocar para ${p.foto ? 'cambiar' : 'agregar'} foto">
          <span class="ms stock-photo-label" style="font-size:28px;">photo_camera</span>
          <span class="stock-badge ${badgeClass}">${p.stock}</span>
        </div>
        <div class="stock-info">
          <div class="stock-name">${this.esc(p.nombre)}</div>
          <div class="stock-row">
            <span class="stock-price">${this.fmt(p.precioVenta)}</span>
            <div class="stock-controls">
              <button class="stock-btn sell ms" onclick="App.venderDesdeStock(${p.id})" aria-label="Vender">sell</button>
              <button class="stock-btn edit ms" onclick="App.openEditPerfume(${p.id})" aria-label="Editar">edit</button>
              <button class="stock-btn minus ms" onclick="App.adjustStock(${p.id}, -1)">remove</button>
              <button class="stock-btn plus ms" onclick="App.adjustStock(${p.id}, 1)">add</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
    this._lazyLoadStockPhotos();
  },

  _lazyLoadStockPhotos() {
    if (this._stockPhotoObserver) this._stockPhotoObserver.disconnect();
    const targets = document.querySelectorAll('.stock-photo[data-photo-id]');
    if (!targets.length) return;
    this._stockPhotoObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const id = Number(el.dataset.photoId);
        const p = this.perfumes.find(x => x.id === id);
        if (p && p.foto && /^data:image\//.test(p.foto)) {
          const img = document.createElement('img');
          img.alt = '';
          img.src = p.foto;
          el.querySelector('.stock-photo-label')?.remove();
          el.insertBefore(img, el.firstChild);
        }
        el.removeAttribute('data-photo-id');
        obs.unobserve(el);
      });
    }, { rootMargin: '200px' });
    targets.forEach(el => this._stockPhotoObserver.observe(el));
  },

  _renderStockAlerts() {
    const container = document.getElementById('stock-alerts');
    if (!container) return;

    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const salesLast30 = this.ventas.filter(v => now - v.fecha < thirtyDays);

    const salesByPerfume = {};
    salesLast30.forEach(v => {
      const name = (v.perfume || '').trim();
      if (name) salesByPerfume[name] = (salesByPerfume[name] || 0) + 1;
    });

    const alerts = [];
    this.perfumes.forEach(p => {
      const sold = salesByPerfume[p.nombre] || 0;
      if (sold <= 0) return;
      const monthsLeft = p.stock > 0 ? p.stock / sold : 0;
      if (p.stock === 0) {
        alerts.push({ perfume: p.nombre, stock: 0, sold, monthsLeft: 0, critical: true });
      } else if (monthsLeft <= 1) {
        alerts.push({ perfume: p.nombre, stock: p.stock, sold, monthsLeft, critical: false });
      }
    });

    if (alerts.length === 0) {
      container.classList.add('hidden');
      return;
    }

    alerts.sort((a, b) => a.monthsLeft - b.monthsLeft);
    container.classList.remove('hidden');
    container.innerHTML = alerts.map(a => {
      const cls = a.critical ? 'critical' : '';
      const icon = a.critical ? 'error' : 'trending_down';
      const msg = a.critical
        ? `<strong>${this.esc(a.perfume)}</strong> sin stock — vendés ${a.sold}/mes`
        : `<strong>${this.esc(a.perfume)}</strong> quedan ${a.stock} — vendés ${a.sold}/mes`;
      return `<div class="stock-alert-card ${cls}">
        <div class="stock-alert-left">
          <span class="ms">${icon}</span>
          <span class="stock-alert-text">${msg}</span>
        </div>
        <span class="stock-alert-velocity">${a.critical ? 'Reponer' : `~${Math.round(a.monthsLeft * 30)}d`}</span>
      </div>`;
    }).join('');
  },

  renderCuotas() {
    const pendientes = this.cuotasData.filter(c => !c.pagado);
    const totalAdeudado = pendientes.reduce((s, c) => s + c.monto - (c.montoPagado || 0), 0);
    document.getElementById('cuotas-total').textContent = this.fmt(totalAdeudado);

    const badge = document.getElementById('nav-cuotas-badge');
    if (badge) {
      badge.textContent = pendientes.length;
      badge.style.display = pendientes.length > 0 ? 'flex' : 'none';
    }

    const container = document.getElementById('cuotas-list');
    if (pendientes.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="ms">check_circle</span><span>No hay cuotas pendientes</span></div>';
      return;
    }

    const grouped = {};
    this.cuotasData.forEach(c => {
      if (!grouped[c.ventaId]) grouped[c.ventaId] = [];
      grouped[c.ventaId].push(c);
    });

    container.innerHTML = Object.entries(grouped).map(([ventaId, cuotas]) => {
      const pendientesGrupo = cuotas.filter(c => !c.pagado);
      if (pendientesGrupo.length === 0) return '';

      const proxima = pendientesGrupo[0];
      const pagadas = cuotas.filter(c => c.pagado).length;
      const totalPagado = cuotas.reduce((s, c) => s + (c.pagado ? c.monto : (c.montoPagado || 0)), 0);
      const montoTotal = proxima.montoTotal;
      const pctPagado = montoTotal > 0 ? Math.round((totalPagado / montoTotal) * 100) : 0;
      const venceDate = this.fmtDate(proxima.vence);
      const resta = montoTotal - totalPagado;
      const parcialProxima = proxima.montoPagado || 0;
      const restaProxima = proxima.monto - parcialProxima;

      const waMsg = `Hola ${this.esc(proxima.cliente)}! 👋 Te recuerdo tu cuota pendiente de *${this.esc(proxima.perfume)}*:\n\n📅 Cuota ${proxima.numero} de ${proxima.total}\n💰 Monto: ${this.fmt(restaProxima)}\n📊 Total: ${this.fmt(montoTotal)}`;

      return `<div class="cuota-card" style="margin-bottom:12px;">
        <div class="cuota-top">
          <div>
            <div class="cuota-perfume">${this.esc(proxima.perfume)}</div>
            <div class="cuota-cliente"><span class="ms">person</span><span>${this.esc(proxima.cliente)}</span></div>
          </div>
          <span class="cuota-badge">Cuota ${proxima.numero} de ${proxima.total}</span>
        </div>
        <div>
          <div class="progress-header">
            <span style="color:var(--text3)">Pagado <span class="green">${this.fmt(totalPagado)}</span></span>
            <span style="color:var(--text3)">Total ${this.fmt(montoTotal)}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pctPagado}%"></div></div>
        </div>
        <div class="cuota-due"><span class="ms">event</span>Vence el ${venceDate} · resta <span class="danger bold">${this.fmt(resta)}</span>${parcialProxima > 0 ? `<span class="cuota-partial-badge">Pagó ${this.fmt(parcialProxima)} de ${this.fmt(proxima.monto)}</span>` : ''}</div>
        <div class="cuota-actions">
          <button class="btn-whatsapp" data-msg="${this.b64Encode(waMsg)}" data-type="whatsapp"><span class="ms">chat</span>Cobrar por WhatsApp</button>
          <button class="btn-pay" data-cuota-id="${encodeURIComponent(JSON.stringify(proxima.id))}"><span class="ms">add_card</span></button>
        </div>
        <div class="wa-preview-label">VISTA PREVIA DEL MENSAJE</div>
        <div class="wa-bubble">
          <div class="wa-text">${this.esc(waMsg).replace(/\n/g, '<br>').replace(/\*(.*?)\*/g, (_, m) => '<b>' + m + '</b>')}</div>
          <div class="wa-meta">${new Date().getHours()}:${String(new Date().getMinutes()).padStart(2,'0')} <span class="ms">done_all</span></div>
        </div>
      </div>`;
    }).join('');
  },

  _cuotasView: 'cuotas',

  switchCuotasView(view) {
    this._cuotasView = view;
    const tabCuotas = document.getElementById('tab-cuotas');
    const tabDeudores = document.getElementById('tab-deudores');
    const listCuotas = document.getElementById('cuotas-list');
    const listDeudores = document.getElementById('deudores-list');

    if (view === 'cuotas') {
      tabCuotas.classList.add('active');
      tabDeudores.classList.remove('active');
      listCuotas.classList.remove('hidden');
      listDeudores.classList.add('hidden');
      this.renderCuotas();
    } else {
      tabCuotas.classList.remove('active');
      tabDeudores.classList.add('active');
      listCuotas.classList.add('hidden');
      listDeudores.classList.remove('hidden');
      this.renderDeudores();
    }
  },

  renderDeudores() {
    const pendientes = this.cuotasData.filter(c => !c.pagado);
    const container = document.getElementById('deudores-list');

    if (pendientes.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="ms">check_circle</span><span>No hay deudores</span></div>';
      return;
    }

    const byClient = {};
    pendientes.forEach(c => {
      const name = (c.cliente || 'Sin nombre').trim();
      if (!byClient[name]) byClient[name] = { cuotas: [], total: 0, oldestDue: Infinity };
      const resta = c.monto - (c.montoPagado || 0);
      byClient[name].cuotas.push(c);
      byClient[name].total += resta;
      if (c.vence < byClient[name].oldestDue) byClient[name].oldestDue = c.vence;
    });

    const sorted = Object.entries(byClient).sort((a, b) => b[1].total - a[1].total);
    const now = Date.now();

    container.innerHTML = sorted.map(([name, data]) => {
      const overdue = data.cuotas.filter(c => c.vence < now);
      const items = data.cuotas.map(c => {
        const resta = c.monto - (c.montoPagado || 0);
        return `<div class="deudor-item">
          <span class="deudor-item-name">${this.esc(c.perfume)} · Cuota ${c.numero}/${c.total}</span>
          <span class="deudor-item-amount">${this.fmt(resta)}</span>
        </div>`;
      }).join('');

      const cuotasList = data.cuotas.map(c => {
        const r = c.monto - (c.montoPagado || 0);
        return `${this.esc(c.perfume)} cuota ${c.numero}: ${this.fmt(r)}`;
      }).join('\n');
      const waMsg = `Hola ${this.esc(name)}! Te paso el resumen de tus cuotas pendientes:\n\n${cuotasList}\n\n*Total: ${this.fmt(data.total)}*\n\nGracias!`;

      return `<div class="deudor-card">
        <div class="deudor-header">
          <div class="deudor-name"><span class="ms">person</span>${this.esc(name)}</div>
          <div class="deudor-amount">${this.fmt(data.total)}</div>
        </div>
        <div class="deudor-meta">
          <span class="deudor-chip"><span class="ms">receipt_long</span>${data.cuotas.length} cuota${data.cuotas.length > 1 ? 's' : ''}</span>
          ${overdue.length > 0 ? `<span class="deudor-chip overdue"><span class="ms">warning</span>${overdue.length} vencida${overdue.length > 1 ? 's' : ''}</span>` : ''}
          <span class="deudor-chip"><span class="ms">event</span>${this.fmtDate(data.oldestDue)}</span>
        </div>
        <div class="deudor-items">${items}</div>
        <div class="deudor-actions">
          <button class="btn-whatsapp" data-msg="${this.b64Encode(waMsg)}"><span class="ms">chat</span>Cobrar todo por WhatsApp</button>
        </div>
      </div>`;
    }).join('');
  },

  renderStats() {
    const now = new Date();
    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    document.getElementById('stats-month-label').innerHTML = `${monthNames[now.getMonth()]} ${now.getFullYear()} <span class="ms">expand_more</span>`;

    const thisMonth = this.ventas.filter(v => {
      const d = new Date(v.fecha);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    // Ganancia REAL = lo cobrado (precioVenta, ya con descuento) menos el costo
    const ganancia = thisMonth.reduce((s, v) => s + (v.precioVenta - v.precioCompra), 0);
    const gastos = thisMonth.reduce((s, v) => s + v.precioCompra, 0);
    const totalVenta = thisMonth.reduce((s, v) => s + v.precioVenta, 0);

    // Show charts only if Pro; hide bars for Free
    const isPro = this.isPro();
    const barGanancia = document.getElementById('bar-ganancia');
    const barGastos = document.getElementById('bar-gastos');
    if (barGanancia && barGastos) {
      if (isPro) {
        const maxVal = Math.max(ganancia, gastos, totalVenta, 1000);
        const gPct = Math.min(95, Math.max(5, Math.round((ganancia / maxVal) * 90)));
        const xPct = Math.min(95, Math.max(3, Math.round((gastos / maxVal) * 90)));
        barGanancia.style.height = gPct + '%';
        barGastos.style.height = Math.max(3, xPct) + '%';
      } else {
        barGanancia.style.display = 'none';
        barGastos.style.display = 'none';
      }
    }

    const barLabel = document.getElementById('bar-label-g');
    if (barLabel) barLabel.textContent = monthNames[now.getMonth()];

    if (isPro) {
      const steps = [Math.max(ganancia, gastos, totalVenta, 1000), Math.max(ganancia, gastos, totalVenta, 1000) * 0.8, Math.max(ganancia, gastos, totalVenta, 1000) * 0.6, Math.max(ganancia, gastos, totalVenta, 1000) * 0.4, Math.max(ganancia, gastos, totalVenta, 1000) * 0.2, 0];
      const yLabels = ['cy5','cy4','cy3','cy2','cy1'];
      yLabels.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) {
          const v = steps[i];
          el.textContent = v >= 1000 ? this._moneda + Math.round(v / 1000) + 'k' : this._moneda + Math.round(v);
        }
      });
    }

    const ticket = thisMonth.length > 0 ? Math.round(totalVenta / thisMonth.length) : 0;
    document.getElementById('m-ticket').textContent = this.fmt(ticket);

    const margen = totalVenta > 0 ? ((ganancia / totalVenta) * 100).toFixed(1) : 0;
    document.getElementById('m-margen').textContent = margen + '%';

    const enCuotas = thisMonth.filter(v => v.formaPago === 'cuotas').length;
    document.getElementById('m-cuotas').textContent = enCuotas;
    document.getElementById('m-cuotas-pct').textContent = thisMonth.length > 0 ? Math.round((enCuotas / thisMonth.length) * 100) + '% del total' : '0% del total';

    const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const diasCount = [0,0,0,0,0,0,0];
    thisMonth.forEach(v => diasCount[new Date(v.fecha).getDay()]++);
    const mejorDia = diasCount.indexOf(Math.max(...diasCount));
    document.getElementById('m-mejor-dia').textContent = diasCount[mejorDia] > 0 ? dias[mejorDia] : '—';

    this.renderRankings(thisMonth);
  },

  renderRankings(ventas) {
    // Rankings only in Pro plan
    const rankPerfumesEl = document.getElementById('ranking-perfumes');
    const rankVendedoresEl = document.getElementById('ranking-vendedores');

    if (!this.isPro()) {
      if (rankPerfumesEl) rankPerfumesEl.innerHTML = '<div style="color:var(--text4);font-size:12px;padding:12px;text-align:center;"><span class="ms" style="font-size:16px;">lock</span><br>Solo en Básico Pro</div>';
      if (rankVendedoresEl) rankVendedoresEl.innerHTML = '<div style="color:var(--text4);font-size:12px;padding:12px;text-align:center;"><span class="ms" style="font-size:16px;">lock</span><br>Solo en Básico Pro</div>';
      return;
    }

    const perfumeCounts = {};
    const vendedorCounts = {};
    ventas.forEach(v => {
      const p = v.perfume || 'Sin nombre';
      perfumeCounts[p] = (perfumeCounts[p] || { count: 0, amount: 0 });
      perfumeCounts[p].count++;
      perfumeCounts[p].amount += v.precioVenta;

      const vd = v.vendedor || 'Anónimo';
      vendedorCounts[vd] = (vendedorCounts[vd] || { count: 0, amount: 0 });
      vendedorCounts[vd].count++;
      vendedorCounts[vd].amount += v.precioVenta;
    });

    const topPerfumes = Object.entries(perfumeCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    const topVendedores = Object.entries(vendedorCounts)
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 5);

    const medalEmojis = ['🥇', '🥈', '🥉'];

    if (rankPerfumesEl) {
      rankPerfumesEl.innerHTML = topPerfumes.length === 0
        ? '<div style="color:var(--text4);font-size:12px;padding:12px;">Sin datos este mes</div>'
        : topPerfumes.map(([name, data], i) =>
          `<div class="ranking-item">
            <span class="ranking-pos">${medalEmojis[i] || (i + 1)}</span>
            <span class="ranking-name">${this.esc(name)}</span>
            <span class="ranking-count">${data.count} ventas</span>
            <span class="ranking-amount">${this.fmt(data.amount)}</span>
          </div>`).join('');
    }

    if (rankVendedoresEl) {
      rankVendedoresEl.innerHTML = topVendedores.length === 0
        ? '<div style="color:var(--text4);font-size:12px;padding:12px;">Sin datos este mes</div>'
        : topVendedores.map(([name, data], i) =>
          `<div class="ranking-item">
            <span class="ranking-pos">${medalEmojis[i] || (i + 1)}</span>
            <span class="ranking-name">${this.esc(name)}</span>
            <span class="ranking-count">${data.count} ventas</span>
            <span class="ranking-amount">${this.fmt(data.amount)}</span>
          </div>`).join('');
    }
  },

  updateNavBadge() {
    const pendientes = this.cuotasData.filter(c => !c.pagado);
    const badge = document.getElementById('nav-cuotas-badge');
    if (badge) {
      badge.textContent = pendientes.length;
      badge.style.display = pendientes.length > 0 ? 'flex' : 'none';
    }
  },