

  // ====== NAVIGATION ======

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    this.currentScreen = name;

    document.querySelectorAll('.nav-item').forEach(n => {
      const tab = n.dataset.tab;
      if (tab === name) {
        n.classList.add('active');
        n.querySelector('.ms').style.fontVariationSettings = "'FILL' 1";
        const label = n.querySelector('.nav-label');
        if (label) label.style.fontWeight = '600';
      } else {
        n.classList.remove('active');
        n.querySelector('.ms').style.fontVariationSettings = "";
        const label = n.querySelector('.nav-label');
        if (label) label.style.fontWeight = '500';
      }
    });

    if (name === 'inicio') this.renderDashboard();
    if (name === 'stock') this.renderStock();
    if (name === 'cuotas') this.renderCuotas();
    if (name === 'stats') this.renderStats();
    if (name === 'ventas-all') this.renderAllVentas();
    if (name === 'nueva-venta') this.resetVentaForm();
    if (name === 'pedidos') { this.renderPedidos(); this.updatePedidosBadge(); }
    if (name === 'nuevo-pedido') this.resetPedidoForm();
    if (name === 'caja') this.renderCaja();
    if (name === 'gastos') this.renderGastos();
    if (name === 'cuenta') this.updateCuentaScreen();
  },

  showDemoModal() {
    document.getElementById('modal-demo')?.classList.remove('hidden');
  },

  closeDemoModal() {
    document.getElementById('modal-demo')?.classList.add('hidden');
    const video = document.getElementById('modal-demo')?.querySelector('video');
    if (video) video.pause();
  },