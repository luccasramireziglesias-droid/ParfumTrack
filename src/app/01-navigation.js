

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
    const modal = document.getElementById('modal-demo');
    const content = document.getElementById('modal-demo-content');
    const video = document.getElementById('demo-video');
    const expandBtn = document.getElementById('demo-expand-btn');

    // Reset to normal size if expanded
    if (content && content.classList.contains('expanded')) {
      content.classList.remove('expanded');
      content.style.maxWidth = '540px';
      content.style.width = 'auto';
      content.style.maxHeight = 'auto';
      if (video) video.style.maxHeight = '85vh';
      if (expandBtn) expandBtn.innerHTML = '<span class="ms" style="font-size:16px;">fullscreen</span><span>Pantalla completa</span>';
    }

    modal?.classList.add('hidden');
    if (video) video.pause();
  },

  expandDemoVideo() {
    const modal = document.getElementById('modal-demo');
    const content = document.getElementById('modal-demo-content');
    const video = document.getElementById('demo-video');
    const controls = document.getElementById('demo-controls');
    const expandBtn = document.getElementById('demo-expand-btn');

    if (!modal || !content || !video) return;

    // Toggle expansion state
    if (content.classList.contains('expanded')) {
      // Return to normal size
      content.classList.remove('expanded');
      content.style.maxWidth = '540px';
      content.style.width = 'auto';
      content.style.maxHeight = 'auto';
      video.style.maxHeight = '85vh';
      expandBtn.innerHTML = '<span class="ms" style="font-size:16px;">fullscreen</span><span>Pantalla completa</span>';
    } else {
      // Expand to fullscreen
      content.classList.add('expanded');
      content.style.maxWidth = '100vw';
      content.style.width = '100%';
      content.style.maxHeight = '100vh';
      video.style.maxHeight = 'calc(100vh - 60px)';
      expandBtn.innerHTML = '<span class="ms" style="font-size:16px;">fullscreen_exit</span><span>Salir</span>';
    }
  },