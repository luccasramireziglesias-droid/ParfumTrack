

  // ====== STOCK ======

  filterStock() {
    this.renderStock();
  },

  filterStockBy(filter) {
    this.stockFilter = filter;
    document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
    if (filter === 'todos') document.querySelectorAll('.filter-chips .chip')[0]?.classList.add('active');
    this.renderStock();
  },

  async adjustStock(id, delta) {
    const p = this.perfumes.find(x => x.id === id);
    if (!p) return;
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

  changeStockPhoto(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = async () => {
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
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  },

  _pendingPerfumePhoto: '',

  openAddPerfume() {
    document.getElementById('modal-add-perfume').classList.remove('hidden');
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

  closeAddPerfume() {
    document.getElementById('modal-add-perfume').classList.add('hidden');
  },

  handlePerfumePhoto(input) {
    const file = input.files?.[0];
    if (!file) return;
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
        this._pendingPerfumePhoto = dataUrl;
        const preview = document.getElementById('add-perfume-photo-preview');
        preview.className = '';
        preview.innerHTML = `<img class="photo-preview-img" src="${dataUrl}" alt=""><div class="photo-preview-change">Tocar para cambiar</div>`;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  },

  async savePerfume() {
    const nombre = document.getElementById('add-perfume-nombre').value.trim();
    const precioCompra = parseFloat(document.getElementById('add-perfume-compra').value) || 0;
    const precioVenta = parseFloat(document.getElementById('add-perfume-venta').value) || 0;
    const stock = parseInt(document.getElementById('add-perfume-stock').value) || 0;

    if (!nombre) {
      this.toast('Ingresá el nombre', 'warning');
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