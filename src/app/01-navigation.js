

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
    if (name === 'clientes') this.renderClientes();
    if (name === 'cliente-detalle') this.renderClienteDetalle();
    if (name === 'cuenta') this.updateCuentaScreen();
  },

  showDemoModal() {
    document.getElementById('modal-demo')?.classList.remove('hidden');
  },

  closeDemoModal() {
    const modal = document.getElementById('modal-demo');
    const content = document.getElementById('modal-demo-content');
    const video = document.getElementById('demo-video');
    const controls = document.getElementById('demo-controls');

    // Reset to normal size if expanded
    if (content && content.classList.contains('expanded')) {
      content.classList.remove('expanded');
      content.style.maxWidth = '540px';
      content.style.width = 'auto';
      content.style.maxHeight = 'auto';
      content.style.height = 'auto';
      content.style.padding = '0';
      content.style.gap = '0';
      content.style.display = 'block';
      content.style.justifyContent = '';
      content.style.alignItems = '';
      if (video) {
        video.style.maxHeight = '85vh';
        video.style.height = 'auto';
        video.style.width = '100%';
        video.style.flex = 'none';
        video.style.borderRadius = '12px';
        video.style.margin = '0';
      }
      if (controls) {
        controls.style.visibility = 'visible';
        controls.style.display = 'flex';
        controls.style.height = 'auto';
        controls.style.overflow = 'visible';
      }
    }

    modal?.classList.add('hidden');
    if (video) video.pause();
  },

  expandDemoVideo() {
    const modal = document.getElementById('modal-demo');
    const content = document.getElementById('modal-demo-content');
    const video = document.getElementById('demo-video');
    const controls = document.getElementById('demo-controls');

    if (!modal || !content || !video) return;

    // Toggle expansion state
    if (content.classList.contains('expanded')) {
      // Return to normal size
      content.classList.remove('expanded');
      content.style.maxWidth = '540px';
      content.style.width = 'auto';
      content.style.maxHeight = 'auto';
      content.style.height = 'auto';
      content.style.padding = '0';
      content.style.gap = '0';
      content.style.display = 'block';
      video.style.maxHeight = '85vh';
      video.style.height = 'auto';
      video.style.flex = 'none';
      video.style.margin = '0';
      video.style.borderRadius = '12px';
      if (controls) {
        controls.style.visibility = 'visible';
        controls.style.display = 'flex';
        controls.style.marginBottom = '8px';
      }
    } else {
      // Expand to fullscreen - video covers entire screen
      content.classList.add('expanded');
      content.style.maxWidth = 'none';
      content.style.width = '100vw';
      content.style.maxHeight = 'none';
      content.style.height = '100vh';
      content.style.padding = '0';
      content.style.gap = '0';
      content.style.display = 'flex';
      content.style.flexDirection = 'column';
      content.style.justifyContent = 'center';
      content.style.alignItems = 'stretch';
      video.style.maxHeight = 'none';
      video.style.height = '100%';
      video.style.width = '100%';
      video.style.flex = '1';
      video.style.borderRadius = '0';
      video.style.margin = '0';
      if (controls) {
        controls.style.visibility = 'hidden';
        controls.style.display = 'none';
        controls.style.height = '0';
        controls.style.overflow = 'hidden';
      }
    }
  },