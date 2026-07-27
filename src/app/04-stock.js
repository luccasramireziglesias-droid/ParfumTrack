

  // ====== STOCK ======

  // UX-2: vender directo desde la card de stock — abre Nueva Venta con el
  // perfume y sus precios prefillados
  venderDesdeStock(id) {
    const p = this.perfumes.find(x => x.id === id);
    if (!p) return;
    this.showScreen('nueva-venta');
    document.getElementById('venta-perfume-id').value = p.id;
    document.getElementById('venta-perfume-nombre').value = p.nombre;
    document.getElementById('venta-perfume-display').textContent = p.nombre;
    document.getElementById('venta-precio').value = p.precioVenta || '';
    document.getElementById('venta-compra').value = p.precioCompra || '';
    this.calcLiveProfit();
    this.toast('Perfume cargado — completá el cliente', 'sell');
    setTimeout(() => document.getElementById('venta-cliente').focus(), 150);
  },

  filterStock() {
    // Debounce: sin esto cada tecla disparaba un re-render completo de la
    // grilla (con muchos perfumes, la escritura se sentía trabada)
    this.debounce('buscar-stock', () => this.renderStock(), 150);
  },

  filterStockBy(filter) {
    this.stockFilter = filter;
    // Marcar el chip activo sea cual sea (antes solo 'todos' quedaba marcado:
    // al filtrar por "Sin stock" o "Bajo" no se veía cuál estaba aplicado)
    const chips = document.querySelectorAll('#screen-stock .filter-chips .chip');
    const orden = { todos: 0, sin: 1, bajo: 2 };
    chips.forEach((c, i) => c.classList.toggle('active', i === (orden[filter] ?? 0)));
    this.renderStock();
  },

  async adjustStock(id, delta) {
    const p = this.perfumes.find(x => x.id === id);
    if (!p) return;
    // BUG #16 FIX: Validar delta razonable para ajustes de stock
    if (Math.abs(delta) > 1000) {
      this.toast('Ajuste demasiado grande (máx ±1000)', 'warning');
      return;
    }
    p.stock = Math.max(0, p.stock + delta);
    try {
      await DB.updatePerfume(p);
    } catch (e) {
      this.toast('Error al actualizar stock', 'error');
      return;
    }
    await this.loadData();
    this.renderStock();
    if (p.stock === 0 && delta < 0) this.haptic('warning');
  },

  _processPhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 400;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          let dataUrl = c.toDataURL('image/webp', 0.7);
          if (dataUrl.startsWith('data:image/png')) {
            dataUrl = c.toDataURL('image/jpeg', 0.7);
          }
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  changeStockPhoto(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const dataUrl = await this._processPhoto(file);
      const p = this.perfumes.find(x => x.id === id);
      if (p) {
        p.foto = dataUrl;
        try {
          await DB.updatePerfume(p);
        } catch (e) {
          App.toast('Error al guardar la foto', 'error');
          return;
        }
        await this.loadData();
        this.renderStock();
        this.toast('Foto actualizada', 'check_circle');
      }
    };
    input.click();
  },

  _pendingPerfumePhoto: '',

  _editingPerfumeId: null,

  openAddPerfume() {
    this._editingPerfumeId = null;
    document.getElementById('modal-add-perfume').classList.remove('hidden');
    document.getElementById('add-perfume-title').textContent = 'Agregar perfume';
    document.getElementById('add-perfume-stock-label').textContent = 'STOCK INICIAL';
    document.getElementById('add-perfume-save-btn').innerHTML = '<span class="ms">save</span>Guardar perfume';
    document.getElementById('add-perfume-delete-btn').classList.add('hidden');
    document.getElementById('add-perfume-nombre').value = '';
    document.getElementById('add-perfume-compra').value = '';
    document.getElementById('add-perfume-venta').value = '';
    document.getElementById('add-perfume-stock').value = '1';
    document.getElementById('add-perfume-foto-input').value = '';
    this._pendingPerfumePhoto = '';
    document.getElementById('add-perfume-photo-preview').innerHTML =
      '<span class="ms" style="font-size:32px;">add_a_photo</span><span>Tocar para agregar foto</span>';
    document.getElementById('add-perfume-photo-preview').className = 'photo-preview-empty';
  },

  // Editar todos los datos del perfume (nombre, precios, stock, foto) y
  // eliminarlo del stock — reutiliza el modal de alta
  openEditPerfume(id) {
    const p = this.perfumes.find(x => x.id === id);
    if (!p) return;
    this.openAddPerfume(); // resetea el modal
    this._editingPerfumeId = id;
    document.getElementById('add-perfume-title').textContent = 'Editar perfume';
    document.getElementById('add-perfume-stock-label').textContent = 'STOCK';
    document.getElementById('add-perfume-save-btn').innerHTML = '<span class="ms">save</span>Guardar cambios';
    document.getElementById('add-perfume-delete-btn').classList.remove('hidden');
    document.getElementById('add-perfume-nombre').value = p.nombre || '';
    document.getElementById('add-perfume-compra').value = p.precioCompra || '';
    document.getElementById('add-perfume-venta').value = p.precioVenta || '';
    document.getElementById('add-perfume-stock').value = p.stock ?? 0;
    if (p.foto && /^data:image\//.test(p.foto)) {
      const preview = document.getElementById('add-perfume-photo-preview');
      preview.className = '';
      preview.innerHTML = `<img class="photo-preview-img" src="${p.foto}" alt=""><div class="photo-preview-change">Tocar para cambiar</div>`;
    }
  },

  async deletePerfumeDesdeModal() {
    const id = this._editingPerfumeId;
    if (id === null) return;
    const p = this.perfumes.find(x => x.id === id);
    const ok = await this.appConfirm(
      `¿Eliminar «${p ? p.nombre : 'este perfume'}» del stock? Las ventas ya registradas no se tocan.`,
      'Eliminar',
      'delete'
    );
    if (!ok) return;
    try {
      await DB.deletePerfume(id);
    } catch (e) {
      this.toast('Error al eliminar el perfume', 'error');
      return;
    }
    this._editingPerfumeId = null;
    await this.loadData();
    this.closeAddPerfume();
    this.renderStock();
    this.toast('Perfume eliminado del stock', 'delete');
    this._notifyTabs();
  },

  closeAddPerfume() {
    document.getElementById('modal-add-perfume').classList.add('hidden');
  },

  async handlePerfumePhoto(input) {
    const file = input.files?.[0];
    if (!file) return;
    const dataUrl = await this._processPhoto(file);
    this._pendingPerfumePhoto = dataUrl;
    const preview = document.getElementById('add-perfume-photo-preview');
    preview.className = '';
    preview.innerHTML = `<img class="photo-preview-img" src="${dataUrl}" alt=""><div class="photo-preview-change">Tocar para cambiar</div>`;
  },

  savePerfume() {
    return this._once('perfume', () => this._savePerfumeImpl(), document.getElementById('add-perfume-save-btn'));
  },

  async _savePerfumeImpl() {
    const nombre = document.getElementById('add-perfume-nombre').value.trim();
    const precioCompra = this.parseMonto(document.getElementById('add-perfume-compra').value) || 0;
    const precioVenta = this.parseMonto(document.getElementById('add-perfume-venta').value) || 0;
    const stock = parseInt(document.getElementById('add-perfume-stock').value) || 0;

    if (!nombre) {
      this.toast('Ingresá el nombre', 'warning');
      return;
    }

    // Modo edición: actualizar el existente (sin límite de plan)
    if (this._editingPerfumeId !== null) {
      const p = this.perfumes.find(x => x.id === this._editingPerfumeId);
      if (!p) { this.toast('No se encontró el perfume', 'error'); return; }
      p.nombre = nombre;
      p.precioCompra = precioCompra;
      p.precioVenta = precioVenta;
      p.stock = stock;
      if (this._pendingPerfumePhoto) p.foto = this._pendingPerfumePhoto;
      try {
        await DB.updatePerfume(p);
      } catch (e) {
        this.toast('Error al guardar los cambios', 'error');
        return;
      }
      this._editingPerfumeId = null;
      this._pendingPerfumePhoto = '';
      await this.loadData();
      this.closeAddPerfume();
      this.renderStock();
      this.toast('Perfume actualizado', 'check_circle');
      this._notifyTabs();
      return;
    }

    // Plan limit check: Free = max 30 perfumes
    if (!this.isPro() && this.perfumes.length >= 30) {
      this.appConfirm(
        'Plan Free: máx 30 perfumes en stock. Actualizá a Básico Pro para agregar más.',
        'Actualizar plan',
        'workspace_premium'
      ).then(result => {
        if (result) this.showScreen('cuenta');
      });
      return;
    }

    try {
      await DB.addPerfume({ nombre, precioCompra, precioVenta, stock, foto: this._pendingPerfumePhoto || '' });
    } catch (e) {
      this.toast('Error al guardar perfume', 'error');
      return;
    }
    this._pendingPerfumePhoto = '';
    await this.loadData();
    this.closeAddPerfume();
    this.renderStock();
    this.toast('Perfume agregado', 'check_circle');
  },