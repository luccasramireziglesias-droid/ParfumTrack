

  // ====== RECORDATORIOS DE COBRO (F2) ======
  // El problema real del revendedor no es anotar la cuota: es acordarse de
  // cobrarla. Esto pone arriba del dashboard lo que hay que cobrar hoy, lo
  // que ya venció y lo que vence en los próximos días, con el WhatsApp
  // listo para mandar.

  _RECORDATORIO_HORIZONTE: 3,   // días hacia adelante que se consideran "próximas"
  _RECORDATORIO_MAX_FILAS: 4,   // el resto se ve en la pantalla de Cuotas

  _hoyTs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  },

  // Días de diferencia entre una fecha y hoy, ambos a medianoche local.
  // Negativo = ya venció.
  _diasHasta(ts) {
    const d = new Date(ts || 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - this._hoyTs()) / 86400000);
  },

  // Clasifica las cuotas impagas por urgencia. Devuelve siempre las tres
  // listas (aunque estén vacías) para que quien la use no tenga que chequear.
  _cobrosPendientes() {
    const out = { vencidas: [], hoy: [], proximas: [] };
    for (const c of this.cuotasData) {
      if (c.pagado) continue;
      const resta = (c.monto || 0) - (c.montoPagado || 0);
      // Una cuota con saldo 0 pero sin marcar como pagada no es un cobro
      if (resta <= 0) continue;
      if (!c.vence) continue;
      const dias = this._diasHasta(c.vence);
      const item = { cuota: c, resta, dias };
      if (dias < 0) out.vencidas.push(item);
      else if (dias === 0) out.hoy.push(item);
      else if (dias <= this._RECORDATORIO_HORIZONTE) out.proximas.push(item);
    }
    const porFecha = (a, b) => (a.cuota.vence || 0) - (b.cuota.vence || 0);
    out.vencidas.sort(porFecha);
    out.hoy.sort(porFecha);
    out.proximas.sort(porFecha);
    return out;
  },

  _textoVencimiento(dias) {
    if (dias < 0) return dias === -1 ? 'Venció ayer' : `Venció hace ${Math.abs(dias)} días`;
    if (dias === 0) return 'Vence hoy';
    if (dias === 1) return 'Vence mañana';
    return `Vence en ${dias} días`;
  },

  _mensajeRecordatorio({ cuota, resta, dias }) {
    const nombre = (cuota.cliente || '').trim() || 'Hola';
    const perfume = cuota.perfume || 'tu pedido';
    const cuando = dias < 0
      ? `venció el ${this.fmtDate(cuota.vence)}`
      : dias === 0 ? 'vence hoy' : `vence el ${this.fmtDate(cuota.vence)}`;
    return `Hola ${nombre}! 👋 Te recuerdo la cuota ${cuota.numero}/${cuota.total} de *${perfume}* por *${this.fmt(resta)}* que ${cuando}. ¿Cuándo la podés pasar?`;
  },

  renderRecordatorios() {
    const section = document.getElementById('dashboard-recordatorios');
    const list = document.getElementById('dashboard-recordatorios-list');
    if (!section || !list) return;

    const { vencidas, hoy, proximas } = this._cobrosPendientes();
    const urgentes = vencidas.length + hoy.length;
    this._actualizarBadgeCuotas(urgentes);

    const items = [...vencidas, ...hoy, ...proximas];
    if (items.length === 0) {
      section.classList.add('hidden');
      list.innerHTML = '';
      return;
    }

    const total = items.reduce((s, i) => s + i.resta, 0);
    const titulo = document.getElementById('recordatorios-titulo');
    if (titulo) {
      titulo.textContent = urgentes > 0
        ? `${urgentes} cobro${urgentes !== 1 ? 's' : ''} para hoy`
        : 'Cobros de esta semana';
    }
    const resumen = document.getElementById('recordatorios-resumen');
    if (resumen) resumen.textContent = `${items.length} cuota${items.length !== 1 ? 's' : ''} · ${this.fmt(total)}`;

    section.classList.remove('hidden');
    section.classList.toggle('urgente', urgentes > 0);

    const visibles = items.slice(0, this._RECORDATORIO_MAX_FILAS);
    let html = visibles.map((item) => {
      const { cuota, resta, dias } = item;
      const estado = dias < 0 ? 'vencida' : dias === 0 ? 'hoy' : 'proxima';
      const cuotaIdAttr = encodeURIComponent(JSON.stringify(cuota.id));
      return `<div class="recordatorio-row">
        <div class="recordatorio-info">
          <div class="recordatorio-cliente">${this.esc(cuota.cliente || 'Sin nombre')}</div>
          <div class="recordatorio-meta">${this.esc(cuota.perfume || '—')} · cuota ${cuota.numero}/${cuota.total}</div>
          <div class="recordatorio-estado ${estado}">${this._textoVencimiento(dias)}</div>
        </div>
        <div class="recordatorio-right">
          <span class="recordatorio-monto">${this.fmt(resta)}</span>
          <div class="recordatorio-acciones">
            <button class="btn-whatsapp recordatorio-btn" data-msg="${this.b64Encode(this._mensajeRecordatorio(item))}" aria-label="Recordar a ${this.escAttr(cuota.cliente || 'cliente')} por WhatsApp"><span class="ms" aria-hidden="true">chat</span></button>
            <button class="btn-pay recordatorio-btn" data-cuota-id="${cuotaIdAttr}" aria-label="Registrar pago de la cuota"><span class="ms" aria-hidden="true">payments</span></button>
          </div>
        </div>
      </div>`;
    }).join('');

    if (items.length > visibles.length) {
      const resto = items.length - visibles.length;
      html += `<button class="recordatorio-vermas" onclick="App.showScreen('cuotas')">Ver ${resto} cobro${resto !== 1 ? 's' : ''} más</button>`;
    }

    list.innerHTML = html;
  },

  _actualizarBadgeCuotas(urgentes) {
    const badge = document.getElementById('nav-cuotas-badge');
    if (!badge) return;
    const pendientes = this.cuotasData.filter(c => !c.pagado).length;
    badge.textContent = pendientes;
    badge.style.display = pendientes > 0 ? 'flex' : 'none';
    // Rojo cuando hay algo vencido o venciendo hoy; dorado si es a futuro
    badge.classList.toggle('urgente', (urgentes || 0) > 0);
  },

  // Aviso al abrir la app, como mucho una vez por día: si no, el revendedor
  // que entra 10 veces por día termina ignorándolo.
  _avisoCobrosDelDia() {
    const hoyClave = new Date(this._hoyTs()).toISOString().split('T')[0];
    if (localStorage.getItem('pt_recordatorio_visto') === hoyClave) return;
    const { vencidas, hoy } = this._cobrosPendientes();
    const urgentes = vencidas.length + hoy.length;
    if (urgentes === 0) return;
    localStorage.setItem('pt_recordatorio_visto', hoyClave);
    const monto = [...vencidas, ...hoy].reduce((s, i) => s + i.resta, 0);
    setTimeout(() => {
      this.toast(`Tenés ${urgentes} cobro${urgentes !== 1 ? 's' : ''} pendiente${urgentes !== 1 ? 's' : ''} por ${this.fmt(monto)}`, 'notifications_active');
    }, 1800);
  },
