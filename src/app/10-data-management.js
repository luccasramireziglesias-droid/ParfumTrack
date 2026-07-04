

  // ====== DATA MANAGEMENT ======

  async exportData() {
    const config = await DB.getAll('config');
    const data = {
      perfumes: this.perfumes,
      ventas: this.ventas,
      cuotas: this.cuotasData,
      pedidos: this.pedidosData,
      caja: this.cajaData,
      gastos: this.gastosData,
      config,
      // BUG #18 FIX: No incluir datos sensibles (PIN) en export
      settings: {
        moneda: localStorage.getItem('pt_moneda'),
        negocio: localStorage.getItem('pt_negocio'),
        // pin: omitido intencionalmente por seguridad
      },
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'parfum-track-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Datos exportados', 'download');
  },

  importData() {
    document.getElementById('import-file-input').click();
  },

  _parseDate(v, fallback) {
    if (!v) return fallback;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      if (/^\d+$/.test(v)) return Number(v);
      // DD/MM/YYYY or DD-MM-YYYY
      const dmy = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (dmy) {
        const ms = new Date(+dmy[3], +dmy[2] - 1, +dmy[1], 12).getTime();
        return isNaN(ms) ? fallback : ms;
      }
      const ms = new Date(v).getTime();
      return isNaN(ms) ? fallback : ms;
    }
    return fallback;
  },

  _normalizeBackupData(raw) {
    let data = raw;
    if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
      const inner = data.data;
      if (inner.perfumes || inner.ventas || inner.cuotas || inner.pedidos || inner.caja || inner.gastos) {
        data = inner;
      }
    }
    const stores = ['perfumes', 'ventas', 'cuotas', 'pedidos', 'caja', 'gastos', 'config'];
    for (const s of stores) {
      if (data[s] && !Array.isArray(data[s])) {
        data[s] = Object.values(data[s]);
      }
    }
    if (!Array.isArray(data.cuotas)) data.cuotas = [];
    if (Array.isArray(data.ventas)) {
      data.ventas = data.ventas.map(v => {
        const venta = {
          ...v,
          precioVenta: Number(v.precioVenta) || 0,
          precioCompra: Number(v.precioCompra) || 0,
          fecha: this._parseDate(v.fecha, Date.now()),
        };
        if (Array.isArray(venta.cuotasPagos)) {
          venta.cuotasPagos = venta.cuotasPagos.map(cp => ({
            ...cp,
            fecha: this._parseDate(cp.fecha, venta.fecha),
          }));
        }
        // Map esCuotas format to internal formaPago format
        if (venta.esCuotas && !venta.formaPago) {
          const numCuotas = Number(venta.cuotasTotal) || 1;
          venta.formaPago = numCuotas > 1 ? 'cuotas' : 'contado';
          venta.numCuotas = numCuotas;
          if (numCuotas > 1 && venta.id) {
            const existingCuotas = data.cuotas.filter(c => c.ventaId === venta.id);
            if (existingCuotas.length === 0) {
              const pagos = Array.isArray(venta.cuotasPagos) ? venta.cuotasPagos : [];
              const montoCuota = Math.round(venta.precioVenta / numCuotas);
              const lastCuota = venta.precioVenta - montoCuota * (numCuotas - 1);
              for (let i = 0; i < numCuotas; i++) {
                const isLast = i === numCuotas - 1;
                const monto = isLast ? lastCuota : montoCuota;
                const pago = pagos.find(p => p.numCuota === i);
                const vence = new Date(venta.fecha);
                vence.setMonth(vence.getMonth() + i);
                data.cuotas.push({
                  ventaId: venta.id,
                  perfume: venta.perfume || '',
                  cliente: venta.cliente || '',
                  numero: i + 1,
                  total: numCuotas,
                  monto,
                  montoTotal: venta.precioVenta,
                  pagado: !!pago,
                  montoPagado: pago ? Number(pago.monto) || 0 : 0,
                  vence: vence.getTime(),
                });
              }
            }
          }
        }
        return venta;
      });
    }
    if (Array.isArray(data.cuotas)) {
      data.cuotas = data.cuotas.map(c => ({
        ...c,
        monto: Number(c.monto) || 0,
        montoTotal: Number(c.montoTotal) || 0,
        vence: this._parseDate(c.vence, 0),
      }));
    }
    if (Array.isArray(data.perfumes)) {
      data.perfumes = data.perfumes.map(p => ({
        ...p,
        precioCompra: Number(p.precioCompra) || 0,
        precioVenta: Number(p.precioVenta) || 0,
        stock: Number(p.stock) || 0,
      }));
    }
    const validCats = ['transporte', 'embalaje', 'publicidad', 'otro'];
    if (Array.isArray(data.gastos)) {
      data.gastos = data.gastos.map(g => ({
        ...g,
        monto: Number(g.monto) || 0,
        fecha: this._parseDate(g.fecha, Date.now()),
        categoria: validCats.includes(g.categoria) ? g.categoria : 'otro',
        descripcion: g.descripcion || g.nota || '',
      }));
    }
    if (Array.isArray(data.caja)) {
      data.caja = data.caja.map(c => ({
        ...c,
        monto: Number(c.monto) || 0,
        fecha: this._parseDate(c.fecha, Date.now()),
      }));
    }
    return data;
  },

  async _restoreData(data) {
    const stores = ['perfumes', 'ventas', 'cuotas', 'pedidos', 'caja', 'gastos', 'config'];
    let total = 0, skipped = 0;
    for (const store of stores) {
      await DB.clear(store);
    }
    for (const store of stores) {
      if (!Array.isArray(data[store])) continue;
      for (const item of data[store]) {
        try { await DB.put(store, item); total++; } catch { skipped++; }
      }
    }
    if (data.settings) {
      if (data.settings.moneda) localStorage.setItem('pt_moneda', data.settings.moneda);
      if (data.settings.negocio) localStorage.setItem('pt_negocio', data.settings.negocio);
      if (data.settings.pin) localStorage.setItem('pt_pin', data.settings.pin);
    }
    await this.loadData();
    this.loadMoneda();
    this.loadNombreNegocio();
    this.renderAll();
    return { total, skipped };
  },

  async _handleImportFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    if (!await this.appConfirm('¿Importar datos desde archivo? Esto reemplazará tus datos actuales.', 'Importar', 'upload_file')) return;

    this.toast('Leyendo archivo…', 'hourglass_top');
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const data = this._normalizeBackupData(raw);

      const stores = ['perfumes', 'ventas', 'cuotas', 'pedidos', 'caja', 'gastos', 'config'];
      const hasData = stores.some(s => Array.isArray(data[s]) && data[s].length > 0) || data.settings;
      if (!hasData) {
        this.toast('No se encontraron datos válidos en el archivo', 'error');
        return;
      }

      const { total, skipped } = await this._restoreData(data);
      this.toast(`${total} registros importados${skipped ? ` (${skipped} omitidos)` : ''}`, 'check_circle');
      this.haptic('success');
      this._notifyTabs();
    } catch (e) {
      this.toast('Error al leer el archivo', 'error');
    }
  },

  async _loadScript(url) {
    if (document.querySelector(`script[src="${url}"]`)) return;
    const SRI_HASHES = {
      'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js':
        'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk',
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js':
        'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
    };
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      if (SRI_HASHES[url]) {
        s.integrity = SRI_HASHES[url];
        s.crossOrigin = 'anonymous';
      }
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar: ' + url));
      document.head.appendChild(s);
    });
  },

  async exportPDF() {
    this.toast('Generando PDF…', 'hourglass_top');
    try {
      await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    } catch {
      this.toast('Error al cargar jsPDF', 'error');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const now = new Date();
    const fecha = now.toLocaleDateString('es-AR');

    doc.setFontSize(18);
    doc.text('Parfum Track — Reporte', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generado: ${fecha}`, 14, 28);

    let y = 38;
    const addSection = (title) => {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(13);
      doc.text(title, 14, y);
      y += 8;
      doc.setFontSize(9);
    };

    addSection('Resumen');
    const totalVentas = this.ventas.reduce((s, v) => s + v.precioVenta, 0);
    const totalGanancia = this.ventas.reduce((s, v) => s + (v.precioVenta - v.precioCompra), 0);
    doc.text(`Ventas: ${this.ventas.length} | Total: ${this.fmt(totalVentas)} | Ganancia: ${this.fmt(totalGanancia)}`, 14, y); y += 6;
    doc.text(`Perfumes en stock: ${this.perfumes.length} | Cuotas pendientes: ${this.cuotasData.filter(c=>!c.pagado).length}`, 14, y); y += 10;

    addSection('Ventas');
    this.ventas.slice(0, 30).forEach(v => {
      if (y > 275) { doc.addPage(); y = 20; }
      const f = new Date(v.fecha).toLocaleDateString('es-AR');
      doc.text(`${f} — ${v.perfume} — ${this.fmt(v.precioVenta)} (ganancia: ${this.fmt(v.precioVenta - v.precioCompra)})${v.cliente ? ' — ' + v.cliente : ''}`, 14, y);
      y += 5;
    });

    y += 5;
    addSection('Stock');
    this.perfumes.forEach(p => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(`${p.nombre} — Stock: ${p.stock} — Compra: ${this.fmt(p.precioCompra)} — Venta: ${this.fmt(p.precioVenta)}`, 14, y);
      y += 5;
    });

    doc.save(`parfum-track-reporte-${fecha.replace(/\//g, '-')}.pdf`);
    this.toast('PDF descargado', 'check_circle');
  },

  async exportExcel() {
    this.toast('Generando Excel…', 'hourglass_top');
    try {
      await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    } catch {
      this.toast('Error al cargar XLSX', 'error');
      return;
    }

    const wb = XLSX.utils.book_new();

    const ventasRows = this.ventas.map(v => ({
      Fecha: new Date(v.fecha).toLocaleDateString('es-AR'),
      Perfume: v.perfume,
      Cliente: v.cliente || '',
      'Precio Compra': v.precioCompra,
      'Precio Venta': v.precioVenta,
      Ganancia: v.precioVenta - v.precioCompra,
      Pago: v.formaPago || 'contado',
      Cuotas: v.numCuotas || 1
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ventasRows), 'Ventas');

    const stockRows = this.perfumes.map(p => ({
      Nombre: p.nombre,
      Stock: p.stock,
      'Precio Compra': p.precioCompra,
      'Precio Venta': p.precioVenta,
      Ganancia: p.precioVenta - p.precioCompra
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockRows), 'Stock');

    const cuotasRows = this.cuotasData.map(c => ({
      Venta: c.ventaId,
      Perfume: c.perfume || '',
      Cliente: c.cliente || '',
      'Cuota N°': c.numero,
      Monto: c.monto,
      'Monto pagado': c.montoPagado || 0,
      Resta: c.monto - (c.montoPagado || 0),
      Vencimiento: new Date(c.vence).toLocaleDateString('es-AR'),
      Pagado: c.pagado ? 'Sí' : (c.montoPagado ? 'Parcial' : 'No'),
      'Cant. pagos': (c.pagos || []).length
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cuotasRows), 'Cuotas');

    if (this.cajaData.length > 0) {
      const cajaRows = this.cajaData.map(c => ({
        Fecha: new Date(c.fecha).toLocaleDateString('es-AR'),
        Tipo: c.tipo,
        Concepto: c.descripcion || '',
        Monto: c.monto
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cajaRows), 'Caja');
    }

    if (this.gastosData.length > 0) {
      const gastosRows = this.gastosData.map(g => ({
        Fecha: new Date(g.fecha).toLocaleDateString('es-AR'),
        Categoría: g.categoria,
        Concepto: g.descripcion || '',
        Monto: g.monto
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastosRows), 'Gastos');
    }

    const fecha = new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
    XLSX.writeFile(wb, `parfum-track-${fecha}.xlsx`);
    this.toast('Excel descargado', 'check_circle');
  },

  _catalogoSelected: new Set(),
  _catalogoImages: [],

  compartirCatalogo() {
    const disponibles = this.perfumes.filter(p => p.stock > 0).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    if (disponibles.length === 0) {
      this.toast('No hay perfumes en stock', 'warning');
      return;
    }
    this._catalogoSelected = new Set(disponibles.map(p => p.id));
    this._catalogoImages = [];
    this.showScreen('catalogo');
    this._renderCatalogoList(disponibles);
  },

  _renderCatalogoList(perfumes) {
    const list = document.getElementById('catalogo-list');
    list.innerHTML = perfumes.map(p => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;">
        <input type="checkbox" data-cat-id="${p.id}" ${this._catalogoSelected.has(p.id) ? 'checked' : ''} onchange="App._toggleCatalogoItem('${p.id}', this.checked)" style="width:20px;height:20px;accent-color:var(--gold);flex-shrink:0;">
        ${p.foto && /^data:image\//.test(p.foto)
          ? `<img src="${this.esc(p.foto)}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;">`
          : `<div style="width:40px;height:40px;border-radius:8px;background:var(--card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span class="ms" style="font-size:20px;color:var(--text4);">photo_camera</span></div>`
        }
        <div style="flex:1;min-width:0;">
          <div style="color:var(--text);font:500 14px 'DM Sans';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.esc(p.nombre)}</div>
          <div style="color:var(--text4);font-size:11px;">Stock: ${p.stock}</div>
        </div>
        <span style="color:var(--green);font:600 14px 'DM Sans';flex-shrink:0;">${this.fmt(p.precioVenta)}</span>
      </label>
    `).join('');
    this._updateCatalogoCount();
    document.getElementById('catalogo-preview').classList.add('hidden');
    document.getElementById('btn-catalogo-send').style.display = 'none';
    document.getElementById('btn-catalogo-preview').style.display = '';
  },

  _toggleCatalogoItem(id, checked) {
    const numId = Number(id);
    if (checked) this._catalogoSelected.add(numId);
    else this._catalogoSelected.delete(numId);
    this._updateCatalogoCount();
  },

  toggleSelectAllCatalogo() {
    const disponibles = this.perfumes.filter(p => p.stock > 0);
    const allSelected = disponibles.every(p => this._catalogoSelected.has(p.id));
    if (allSelected) {
      this._catalogoSelected.clear();
    } else {
      disponibles.forEach(p => this._catalogoSelected.add(p.id));
    }
    document.querySelectorAll('[data-cat-id]').forEach(cb => {
      cb.checked = this._catalogoSelected.has(Number(cb.dataset.catId));
    });
    this._updateCatalogoCount();
  },

  _updateCatalogoCount() {
    document.getElementById('catalogo-count').textContent = this._catalogoSelected.size;
  },

  async previewCatalogo() {
    if (this._catalogoSelected.size === 0) {
      this.toast('Seleccioná al menos un perfume', 'warning');
      return;
    }
    const selected = this.perfumes
      .filter(p => this._catalogoSelected.has(p.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    this.toast('Generando vista previa…', 'hourglass_top');

    const PER_PAGE = 12;
    const pages = [];
    for (let i = 0; i < selected.length; i += PER_PAGE) {
      pages.push(selected.slice(i, i + PER_PAGE));
    }

    this._catalogoImages = [];
    for (let pi = 0; pi < pages.length; pi++) {
      const img = await this._renderCatalogoPage(pages[pi], pi + 1, pages.length);
      this._catalogoImages.push(img);
    }

    const container = document.getElementById('catalogo-preview-imgs');
    container.innerHTML = this._catalogoImages.map((src, i) =>
      `<img src="${src}" alt="Página ${i + 1}" style="width:100%;border-radius:12px;border:1px solid var(--border);">`
    ).join('');
    document.getElementById('catalogo-preview').classList.remove('hidden');
    document.getElementById('btn-catalogo-send').style.display = '';
    document.getElementById('btn-catalogo-preview').style.display = 'none';
    this.toast('Vista previa lista', 'check_circle');
  },

  async enviarCatalogo() {
    if (this._catalogoImages.length === 0) return;

    if (navigator.share && navigator.canShare) {
      try {
        const files = await Promise.all(this._catalogoImages.map(async (dataUrl, i) => {
          const res = await fetch(dataUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          return new File([blob], `catalogo-${i + 1}.png`, { type: 'image/png' });
        }));
        const shareData = { files };
        if (navigator.canShare(shareData)) {
          navigator.share(shareData).catch(() => {});
          this.toast('Catálogo enviado', 'share');
          return;
        }
      } catch {
        this.toast('Error al preparar el catálogo', 'error');
        return;
      }
    }

    this._catalogoImages.forEach((dataUrl, i) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `catalogo-${i + 1}.png`;
      a.click();
    });
    this.toast(`${this._catalogoImages.length} imagen${this._catalogoImages.length > 1 ? 'es' : ''} descargada${this._catalogoImages.length > 1 ? 's' : ''}`, 'download');
  },

  enviarCatalogoTexto() {
    const selected = this.perfumes
      .filter(p => this._catalogoSelected.has(p.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    if (selected.length === 0) {
      this.toast('Seleccioná al menos un perfume', 'warning');
      return;
    }
    const negocio = localStorage.getItem('pt_negocio') || 'Parfum Track';
    const lines = selected.map(p => {
      const stock = p.stock > 0 ? `(${p.stock} disponible${p.stock > 1 ? 's' : ''})` : '(agotado)';
      return `• ${p.nombre} — ${this.fmt(p.precioVenta)} ${stock}`;
    });
    const msg = `*${negocio} — Catálogo actualizado*\n\n${lines.join('\n')}\n\n_${selected.length} perfumes · ${new Date().toLocaleDateString('es-AR')}_`;
    this.cobrarWhatsApp(msg);
  },

  _renderCatalogoPage(items, pageNum, totalPages) {
    return new Promise(resolve => {
      const W = 1080, HEADER = 160, ROW_H = 80, FOOTER = 60, PAD = 40;
      const rows = items.length;
      const H = HEADER + rows * ROW_H + FOOTER + PAD;

      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');

      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#0f0f1a');
      grad.addColorStop(1, '#1a1a2e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#c9a84c';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🍶 CATÁLOGO DE PERFUMES', W / 2, 70);

      ctx.fillStyle = '#b8b5d0';
      ctx.font = '24px sans-serif';
      ctx.fillText(`Página ${pageNum} de ${totalPages} · ${items.length} perfumes`, W / 2, 115);

      ctx.strokeStyle = 'rgba(201,168,76,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, 140);
      ctx.lineTo(W - PAD, 140);
      ctx.stroke();

      items.forEach((p, i) => {
        const y = HEADER + i * ROW_H;

        if (i % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          ctx.fillRect(PAD, y, W - PAD * 2, ROW_H);
        }

        const num = String(i + 1 + (pageNum - 1) * 12).padStart(2, '0');
        ctx.fillStyle = '#c9a84c';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(num, PAD + 16, y + 48);

        ctx.fillStyle = '#f0ece4';
        ctx.font = '28px sans-serif';
        ctx.fillText(p.nombre, PAD + 80, y + 48);

        ctx.fillStyle = '#70c9a0';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(this.fmt(p.precioVenta), W - PAD - 16, y + 48);
        ctx.textAlign = 'left';

        if (p.stock <= 3) {
          ctx.fillStyle = '#e0b060';
          ctx.font = '20px sans-serif';
          ctx.fillText(`⚡ ${p.stock} uds`, W - PAD - 200, y + 48);
        }
      });

      const fy = HEADER + rows * ROW_H + 20;
      ctx.strokeStyle = 'rgba(201,168,76,0.3)';
      ctx.beginPath();
      ctx.moveTo(PAD, fy);
      ctx.lineTo(W - PAD, fy);
      ctx.stroke();

      ctx.fillStyle = '#9a97c0';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Parfum Track · parfumtrack@gmail.com', W / 2, fy + 35);

      resolve(c.toDataURL('image/png'));
    });
  },

  _getAuthToken() {
    return this._account?.licenseData?.token || '';
  },

  async backupToCloud() {
    const code = this._account?.license;
    const token = this._getAuthToken();
    if (!code || !token) {
      this.toast('Activá una licencia primero', 'warning');
      return;
    }

    // F-34: Verify encryption is unlocked if PIN protection enabled
    if (localStorage.getItem('pt_master_key_encrypted')) {
      if (!await this._ensureEncryptionUnlocked()) {
        return;
      }
    }

    if (!await this.appConfirm('¿Subir backup a la nube? Esto reemplazará tu backup anterior.', 'Subir', 'cloud_upload')) return;
    this.toast('Subiendo backup…', 'cloud_upload');

    const config = await DB.getAll('config');
    const data = {
      perfumes: this.perfumes,
      ventas: this.ventas,
      cuotas: this.cuotasData,
      pedidos: this.pedidosData,
      caja: this.cajaData,
      gastos: this.gastosData,
      config,
      settings: {
        moneda: localStorage.getItem('pt_moneda'),
        negocio: localStorage.getItem('pt_negocio'),
        pin: localStorage.getItem('pt_pin'),
      }
    };

    try {
      // F-32: Encrypt backup before uploading (client-side)
      const encryptedData = await ENCRYPTION.encryptData(JSON.stringify(data), code);

      const res = await fetch('/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, token, encryptedData })
      });
      const result = await res.json();
      if (result.ok) {
        this.toast('Backup guardado en la nube', 'check_circle');
        this.haptic('success');
      } else {
        this.toast(result.error || 'Error al guardar', 'error');
      }
    } catch {
      this.toast('Error de conexión', 'cloud_off');
    }
  },

  async restoreFromCloud() {
    const code = this._account?.license;
    const token = this._getAuthToken();
    if (!code || !token) {
      this.toast('Activá una licencia primero', 'warning');
      return;
    }

    // F-34: Verify encryption is unlocked if PIN protection enabled
    if (localStorage.getItem('pt_master_key_encrypted')) {
      if (!await this._ensureEncryptionUnlocked()) {
        return;
      }
    }

    if (!await this.appConfirm('¿Restaurar datos desde la nube? Esto reemplazará tus datos actuales.', 'Restaurar', 'cloud_download')) return;

    this.toast('Descargando backup…', 'cloud_download');
    try {
      const res = await fetch('/backup', {
        headers: { 'X-PT-Code': code, 'X-PT-Token': token }
      });
      const result = await res.json();
      if (!result.ok) {
        this.toast(result.error || 'No se encontró backup', 'error');
        return;
      }

      // F-32: Decrypt backup after downloading (client-side)
      let data = result.encryptedData ? await ENCRYPTION.decryptData(result.encryptedData, code) : (result.data || result);
      data = this._normalizeBackupData(data);
      const { total, skipped } = await this._restoreData(data);
      // BUG FIX: Reload data in memory and re-render dashboard
      await this.loadData();
      this.renderAll();
      this.toast(`${total} registros restaurados${skipped ? ` (${skipped} omitidos)` : ''}`, 'check_circle');
      this.haptic('success');
      this._notifyTabs();
    } catch {
      this.toast('Error de conexión', 'cloud_off');
    }
  },

  async clearData() {
    if (!await this.appConfirm('¿Borrar TODOS los datos? Esta acción no se puede deshacer.', 'Borrar todo', 'delete_forever')) return;
    const stores = ['perfumes', 'ventas', 'cuotas', 'config', 'pedidos', 'caja', 'gastos'];
    for (const store of stores) {
      await DB.clear(store);
    }
    await this.loadData();
    this.renderAll();
    this.toast('Datos borrados', 'delete_forever');
    this._notifyTabs();
  },