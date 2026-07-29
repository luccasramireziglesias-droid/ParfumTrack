

  // ====== PERFIL DEL NEGOCIO ======
  // Hasta ahora lo único que se guardaba del negocio era el nombre, en
  // localStorage. Estos datos son los que el CLIENTE ve: encabezan el
  // catálogo de WhatsApp y el PDF. Por eso no es un formulario que junta
  // datos y los deja ahí — cada campo tiene un lugar donde sale.
  //
  // Van al store `config` (no en localStorage) por una razón concreta: config
  // entra en el backup y en el restore, así que el perfil sobrevive a un
  // cambio de teléfono. El nombre además se sigue escribiendo en
  // localStorage porque el header lo necesita ANTES de que abra IndexedDB.
  //
  // ⚠️ `config` es el único store que NO se cifra: tiene que ser legible
  // antes de que exista la clave. Si algún día se guarda algo realmente
  // sensible del negocio, hay que revisar esa decisión.

  _negocio: null,

  _NEGOCIO_LIMITES: {
    nombre: 30,        // igual que el header, que es donde se ve
    tipo: 40,
    pais: 6,
    telefono: 25,
    email: 60,
    direccion: 80,
    ciudad: 40,
    documento: 20,
  },

  _NEGOCIO_TIPOS: [
    'Perfumes',
    'Perfumes y cosmética',
    'Cosmética',
    'Multimarca',
    'Otros',
  ],

  // La app se usa en toda LATAM: el código de país va aparte y no asumido.
  // El primero de la lista NO es un default — arranca vacío a propósito.
  _NEGOCIO_PAISES: [
    { codigo: '+54', nombre: 'Argentina' },
    { codigo: '+591', nombre: 'Bolivia' },
    { codigo: '+56', nombre: 'Chile' },
    { codigo: '+57', nombre: 'Colombia' },
    { codigo: '+506', nombre: 'Costa Rica' },
    { codigo: '+593', nombre: 'Ecuador' },
    { codigo: '+503', nombre: 'El Salvador' },
    { codigo: '+34', nombre: 'España' },
    { codigo: '+502', nombre: 'Guatemala' },
    { codigo: '+504', nombre: 'Honduras' },
    { codigo: '+52', nombre: 'México' },
    { codigo: '+505', nombre: 'Nicaragua' },
    { codigo: '+507', nombre: 'Panamá' },
    { codigo: '+595', nombre: 'Paraguay' },
    { codigo: '+51', nombre: 'Perú' },
    { codigo: '+1', nombre: 'Rep. Dominicana / EE.UU.' },
    { codigo: '+598', nombre: 'Uruguay' },
    { codigo: '+58', nombre: 'Venezuela' },
  ],

  _negocioVacio() {
    return { nombre: '', tipo: '', pais: '', telefono: '', email: '', direccion: '', ciudad: '', documento: '', logo: '' };
  },

  // Teléfono completo listo para mostrar. Los perfiles viejos guardaban todo
  // junto en `telefono`, así que si ya trae un + se respeta tal cual.
  _telefonoCompleto(n) {
    const tel = (n.telefono || '').trim();
    if (!tel) return '';
    if (tel.startsWith('+')) return tel;
    return n.pais ? `${n.pais} ${tel}` : tel;
  },

  async loadNegocio() {
    let guardado = null;
    try {
      guardado = await DB.getConfig('negocio');
    } catch (_) { /* base no disponible: seguimos con lo que haya en localStorage */ }
    this._negocio = Object.assign(this._negocioVacio(), guardado || {});
    // El nombre viejo vivía solo en localStorage: migrarlo la primera vez
    if (!this._negocio.nombre) {
      this._negocio.nombre = (localStorage.getItem('pt_negocio') || '').trim();
    }
    this._aplicarLogo();
    return this._negocio;
  },

  // Devuelve siempre un objeto usable, aunque loadNegocio no haya corrido
  getNegocio() {
    return this._negocio || Object.assign(this._negocioVacio(), {
      nombre: (localStorage.getItem('pt_negocio') || '').trim(),
    });
  },

  _sanitizarNegocio(datos) {
    const out = this._negocioVacio();
    for (const campo of Object.keys(this._NEGOCIO_LIMITES)) {
      out[campo] = String(datos[campo] || '').trim().slice(0, this._NEGOCIO_LIMITES[campo]);
    }
    // El logo no se acota por largo: es una data URL ya redimensionada
    out.logo = typeof datos.logo === 'string' && /^data:image\//.test(datos.logo) ? datos.logo : '';
    return out;
  },

  renderNegocio() {
    const n = this.getNegocio();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('negocio-nombre', n.nombre);
    set('negocio-telefono', n.telefono);
    set('negocio-email', n.email);
    set('negocio-direccion', n.direccion);
    set('negocio-ciudad', n.ciudad);
    set('negocio-documento', n.documento);

    const sel = document.getElementById('negocio-tipo');
    if (sel) {
      sel.innerHTML = '<option value="">Sin especificar</option>' +
        this._NEGOCIO_TIPOS.map(t => `<option value="${this.esc(t)}">${this.esc(t)}</option>`).join('');
      sel.value = n.tipo || '';
    }

    const pais = document.getElementById('negocio-pais');
    if (pais) {
      pais.innerHTML = '<option value="">País…</option>' +
        this._NEGOCIO_PAISES.map(p =>
          `<option value="${this.esc(p.codigo)}">${this.esc(p.codigo)} · ${this.esc(p.nombre)}</option>`).join('');
      pais.value = n.pais || '';
    }
    this._renderLogoPreview(n.logo);
  },

  _renderLogoPreview(logo) {
    const el = document.getElementById('negocio-logo-preview');
    if (!el) return;
    if (logo) {
      el.className = 'negocio-logo';
      el.innerHTML = `<img src="${logo}" alt="Logo del negocio">
        <button class="negocio-logo-quitar" onclick="event.stopPropagation();App.quitarLogoNegocio()" aria-label="Quitar logo">
          <span class="ms">close</span></button>`;
    } else {
      el.className = 'negocio-logo vacio';
      el.innerHTML = '<span class="ms">add_photo_alternate</span><span class="negocio-logo-hint">Tocá para agregar tu logo</span>';
    }
  },

  elegirLogoNegocio() {
    const input = document.getElementById('negocio-logo-input');
    if (input) input.click();
  },

  async cargarLogoNegocio(input) {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    try {
      // Mismo pipeline que las fotos de perfume: redimensiona y comprime
      // antes de guardar, si no el backup se infla
      const dataUrl = await this._processPhoto(file);
      this._negocio = this.getNegocio();
      this._negocio.logo = dataUrl;
      this._renderLogoPreview(dataUrl);
      this.toast('Logo listo — tocá Guardar', 'image');
    } catch (_) {
      this.toast('No pudimos leer la imagen', 'error');
    }
  },

  async quitarLogoNegocio() {
    this._negocio = this.getNegocio();
    this._negocio.logo = '';
    this._renderLogoPreview('');
    this.toast('Logo quitado — tocá Guardar', 'image_not_supported');
  },

  guardarNegocio() {
    return this._once('negocio', () => this._guardarNegocioImpl(),
      document.getElementById('negocio-guardar'));
  },

  async _guardarNegocioImpl() {
    const val = (id) => (document.getElementById(id)?.value || '');
    const datos = this._sanitizarNegocio({
      nombre: val('negocio-nombre'),
      tipo: val('negocio-tipo'),
      pais: val('negocio-pais'),
      telefono: val('negocio-telefono'),
      email: val('negocio-email'),
      direccion: val('negocio-direccion'),
      ciudad: val('negocio-ciudad'),
      documento: val('negocio-documento'),
      logo: this.getNegocio().logo,
    });

    if (!datos.nombre) {
      this.toast('Poné al menos el nombre del negocio', 'warning');
      return;
    }
    if (datos.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.email)) {
      this.toast('Revisá el email', 'warning');
      return;
    }
    // Sin código de país el número no sirve para escribirle desde otro país,
    // que es justamente para lo que está en el catálogo
    if (datos.telefono && !datos.pais && !datos.telefono.startsWith('+')) {
      this.toast('Elegí el país del teléfono', 'warning');
      return;
    }

    try {
      await DB.setConfig('negocio', datos);
    } catch (_) {
      this.toast('No pudimos guardar los datos', 'error');
      return;
    }
    this._negocio = datos;
    // El header lee de localStorage en el arranque, antes de abrir la base
    this.setNombreNegocio(datos.nombre);
    this._aplicarLogo();
    this.renderNegocio();
    this.toast('Datos del negocio guardados', 'check_circle');
    this.haptic('success');
    this._notifyTabs();
  },

  // Reemplaza la gota dorada del header por el logo del usuario
  _aplicarLogo() {
    const drop = document.querySelector('#screen-inicio .logo-drop');
    if (!drop) return;
    const logo = this.getNegocio().logo;
    if (logo) {
      drop.classList.add('con-logo');
      drop.style.backgroundImage = `url("${logo}")`;
    } else {
      drop.classList.remove('con-logo');
      drop.style.backgroundImage = '';
    }
  },

  // Bloque de contacto para el catálogo de WhatsApp y el PDF. Devuelve ''
  // si el usuario no cargó nada: nunca un encabezado vacío.
  _negocioContacto({ separador = '\n' } = {}) {
    const n = this.getNegocio();
    const partes = [];
    const tel = this._telefonoCompleto(n);
    if (tel) partes.push(`📱 ${tel}`);
    if (n.email) partes.push(`✉️ ${n.email}`);
    const ubicacion = [n.direccion, n.ciudad].filter(Boolean).join(', ');
    if (ubicacion) partes.push(`📍 ${ubicacion}`);
    return partes.join(separador);
  },
