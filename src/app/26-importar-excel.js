

  // ====== IMPORTAR DESDE EXCEL ======
  // El import de JSON sirve para restaurar un backup propio: reemplaza todo.
  // Esto es lo contrario — el que viene de una planilla quiere SUMAR lo que ya
  // tenía a lo que carga en la app, sin perder nada.
  //
  // Se lee .xlsx y no .csv como formato principal porque en LATAM el CSV trae
  // tres problemas: Excel lo guarda con `;` (la coma es el decimal), en
  // Windows-1252 (se rompen las tildes) y con los números como texto
  // ambiguo. En xlsx los números vienen tipados y el encoding es interno.

  _impDestinos: {
    perfumes: {
      titulo: 'Perfumes (stock)',
      campos: [
        { id: 'nombre', label: 'Nombre del perfume', obligatorio: true, tipo: 'texto',
          alias: ['nombre', 'perfume', 'producto', 'articulo', 'descripcion', 'detalle', 'item'] },
        { id: 'stock', label: 'Stock', tipo: 'entero',
          alias: ['stock', 'cantidad', 'unidades', 'existencia', 'disponible'] },
        { id: 'precioCompra', label: 'Precio de compra', tipo: 'monto',
          alias: ['preciocompra', 'compra', 'costo', 'preciocosto', 'costounitario'] },
        { id: 'precioVenta', label: 'Precio de venta', obligatorio: true, tipo: 'monto',
          alias: ['precioventa', 'venta', 'precio', 'preciolista', 'pvp', 'valor'] },
      ],
    },
    ventas: {
      titulo: 'Ventas',
      campos: [
        { id: 'perfume', label: 'Perfume vendido', obligatorio: true, tipo: 'texto',
          alias: ['perfume', 'producto', 'articulo', 'nombre', 'descripcion', 'detalle', 'item'] },
        { id: 'cantidad', label: 'Cantidad', tipo: 'entero',
          alias: ['cantidad', 'unidades', 'cant', 'qty'] },
        { id: 'precioVenta', label: 'Precio de venta', obligatorio: true, tipo: 'monto',
          alias: ['precioventa', 'venta', 'precio', 'total', 'importe', 'monto', 'valor'] },
        { id: 'precioCompra', label: 'Precio de compra', tipo: 'monto',
          alias: ['preciocompra', 'compra', 'costo', 'preciocosto'] },
        // "1/3" = tres cuotas de las que ya pagó una. "0/2" = dos, ninguna
        // paga. "1/1" o "1" = pago directo.
        { id: 'cuotas', label: 'Cuotas', tipo: 'cuotas',
          alias: ['cuotas', 'cuota', 'plan', 'planes'] },
        { id: 'pago', label: 'Ya cobrado', tipo: 'monto',
          alias: ['pago', 'pagado', 'cobrado', 'entrega', 'sena', 'adelanto'] },
        { id: 'cliente', label: 'Cliente', tipo: 'texto',
          alias: ['cliente', 'comprador', 'nombrecliente', 'apellido'] },
        { id: 'vendedor', label: 'Vendedor', tipo: 'texto',
          alias: ['vendedor', 'vendio', 'responsable'] },
        { id: 'proveedor', label: 'Proveedor', tipo: 'texto',
          alias: ['proveedor', 'distribuidor', 'mayorista'] },
        { id: 'fecha', label: 'Fecha', tipo: 'fecha',
          alias: ['fecha', 'dia', 'date', 'fechaventa'] },
      ],
    },
  },

  _imp: null,

  abrirImportarExcel() {
    document.getElementById('import-excel-input').click();
  },

  // Quita tildes y separadores para comparar cabeceras: "Precio Venta",
  // "precio_venta" y "PRECIO DE VENTA" tienen que caer en la misma clave
  _impNormalizar(txt) {
    return String(txt || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\bde\b|\bdel\b|\bpor\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  },

  _impAutoMapear(cabeceras, destino) {
    const mapeo = {};
    const usadas = new Set();
    for (const campo of this._impDestinos[destino].campos) {
      // Primero exacto, después "contiene": así "precio" no le gana a
      // "precio de venta" cuando están las dos columnas
      let idx = cabeceras.findIndex((c, i) =>
        !usadas.has(i) && campo.alias.includes(this._impNormalizar(c)));
      if (idx === -1) {
        idx = cabeceras.findIndex((c, i) => {
          if (usadas.has(i)) return false;
          const n = this._impNormalizar(c);
          return n && campo.alias.some(a => n.includes(a));
        });
      }
      if (idx !== -1) {
        mapeo[campo.id] = idx;
        usadas.add(idx);
      }
    }
    return mapeo;
  },

  async _leerArchivoExcel(input) {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    this.toast('Leyendo la planilla…', 'hourglass_top');
    try {
      await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    } catch {
      this.toast('No se pudo cargar el lector de Excel. Revisá tu conexión.', 'error');
      return;
    }

    try {
      const buf = await file.arrayBuffer();
      // cellDates: las fechas llegan como Date y no como número de serie
      const libro = XLSX.read(buf, { type: 'array', cellDates: true });
      if (!libro.SheetNames.length) throw new Error('El archivo no tiene hojas');

      this._imp = {
        libro,
        hojas: libro.SheetNames,
        hoja: libro.SheetNames[0],
        destino: 'perfumes',
        mapeo: {},
        archivo: file.name,
      };
      this._impCargarHoja();
      document.getElementById('modal-importar').classList.remove('hidden');
    } catch (e) {
      this.toast('No pudimos leer el archivo. ¿Es un Excel válido?', 'error');
    }
  },

  // Las planillas suelen arrancar con un título fusionado ("VIP PARFUMS
  // JUNIO") ocupando la primera fila. Tomar la fila 0 como cabecera dejaba
  // todo sin mapear, así que se busca la fila que más parece una cabecera:
  // la que tiene más celdas con texto (no números) entre las primeras.
  _impDetectarCabecera(filas) {
    let mejor = 0, mejorPuntaje = -1;
    for (let i = 0; i < Math.min(filas.length, 10); i++) {
      const fila = filas[i] || [];
      let texto = 0, numeros = 0;
      for (const celda of fila) {
        const v = String(celda ?? '').trim();
        if (!v) continue;
        if (celda instanceof Date || /^[$\s]*-?[\d.,]+\s*$/.test(v)) numeros++;
        else texto++;
      }
      // Una fila de datos tiene números; una de título, una sola celda
      const puntaje = texto - numeros * 2;
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = i; }
    }
    return mejor;
  },

  // Las fechas escritas a mano son ambiguas: "7/2/2026" puede ser el 7 de
  // febrero o el 2 de julio. Se mira TODA la columna: si en algún renglón el
  // primer número pasa de 12 es día/mes; si el que pasa de 12 es el segundo,
  // la planilla está en mes/día (lo que hace Excel en inglés). Sin ninguna
  // pista se asume día/mes, que es como se escribe acá.
  _impDetectarFormatoFecha(filas, idx) {
    if (idx === undefined) return 'dmy';
    let primero = 0, segundo = 0;
    for (const fila of filas) {
      const v = fila[idx];
      if (v instanceof Date) continue;               // ya viene sin ambigüedad
      const m = String(v ?? '').trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (!m) continue;
      if (+m[1] > 12) primero++;
      if (+m[2] > 12) segundo++;
    }
    if (segundo > primero) return 'mdy';
    return 'dmy';
  },

  _impCargarHoja() {
    const s = this._imp;
    const hoja = s.libro.Sheets[s.hoja];
    // header:1 devuelve arrays por fila, que es lo que necesitamos para
    // mostrar las cabeceras tal cual vinieron
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, defval: '' });
    const iCab = this._impDetectarCabecera(filas);
    s.filaCabecera = iCab;
    s.cabeceras = (filas[iCab] || []).map(c => String(c || '').trim());
    s.filas = filas.slice(iCab + 1).filter(f => f.some(c => String(c ?? '').trim() !== ''));
    s.mapeo = this._impAutoMapear(s.cabeceras, s.destino);
    this._impActualizarFormatoFecha();
    this._renderImportador();
  },

  // El formato depende de qué columna se eligió como fecha
  _impActualizarFormatoFecha() {
    const s = this._imp;
    const campoFecha = this._impDestinos[s.destino].campos.find(c => c.tipo === 'fecha');
    s.formatoFecha = campoFecha
      ? this._impDetectarFormatoFecha(s.filas || [], s.mapeo[campoFecha.id])
      : 'dmy';
  },

  cambiarHojaImport(nombre) {
    if (!this._imp) return;
    this._imp.hoja = nombre;
    this._impCargarHoja();
  },

  cambiarDestinoImport(destino) {
    if (!this._imp) return;
    this._imp.destino = destino;
    this._imp.mapeo = this._impAutoMapear(this._imp.cabeceras, destino);
    this._impActualizarFormatoFecha();
    this._renderImportador();
  },

  setMapeoImport(campoId, valor) {
    if (!this._imp) return;
    if (valor === '') delete this._imp.mapeo[campoId];
    else this._imp.mapeo[campoId] = parseInt(valor, 10);
    this._impActualizarFormatoFecha();
    this._renderImportador();
  },

  _impValor(fila, campo) {
    const s = this._imp;
    const idx = s.mapeo[campo.id];
    if (idx === undefined) return campo.tipo === 'texto' ? '' : null;
    const bruto = fila[idx];
    if (bruto === undefined || bruto === null || String(bruto).trim() === '') {
      return campo.tipo === 'texto' ? '' : null;
    }
    if (campo.tipo === 'monto') return this.parseMonto(bruto);
    if (campo.tipo === 'entero') {
      const n = parseInt(String(bruto).replace(/[^\d-]/g, ''), 10);
      return Number.isFinite(n) ? Math.max(0, n) : null;
    }
    if (campo.tipo === 'cuotas') {
      // El numerador es cuántas cuotas YA PAGÓ, no cuál va: "1/3" son tres
      // cuotas con una paga, "0/2" son dos sin pagar y "2/2" está saldada.
      const m = String(bruto).match(/(\d+)\s*\/\s*(\d+)/);
      if (m) {
        const total = Math.min(Math.max(parseInt(m[2], 10) || 1, 1), 12);
        const pagadas = Math.min(Math.max(parseInt(m[1], 10) || 0, 0), total);
        return { total, pagadas };
      }
      // Un número suelto ("1") es un pago directo, no un plan de cuotas
      const n = parseInt(String(bruto).replace(/[^\d]/g, ''), 10);
      return Number.isFinite(n) && n >= 1 ? { total: Math.min(n, 12), pagadas: 0 } : null;
    }
    if (campo.tipo === 'fecha') {
      if (bruto instanceof Date && !isNaN(bruto.getTime())) return bruto.getTime();
      const m = String(bruto).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (m) {
        const [d, mes] = s.formatoFecha === 'mdy' ? [+m[2], +m[1]] : [+m[1], +m[2]];
        const anio = +m[3] < 100 ? 2000 + +m[3] : +m[3];
        // Mediodía: evita que un cambio de huso corra la fecha un día
        const ts = new Date(anio, mes - 1, d, 12).getTime();
        // Un mes fuera de rango daría un salto de año en silencio
        if (!isNaN(ts) && mes >= 1 && mes <= 12 && d >= 1 && d <= 31) return ts;
        return null;
      }
      return this._parseDate(bruto, null);
    }
    return String(bruto).trim().slice(0, 120);
  },

  // Convierte las filas a registros y separa las que no sirven, para poder
  // decir cuántas se van a omitir ANTES de tocar la base
  _impProcesar() {
    const s = this._imp;
    const def = this._impDestinos[s.destino];
    const obligatorios = def.campos.filter(c => c.obligatorio);
    const validos = [];
    let omitidas = 0, relleno = 0;

    for (const fila of (s.filas || [])) {
      const reg = {};
      let faltan = 0;
      for (const campo of def.campos) {
        const v = this._impValor(fila, campo);
        if (campo.obligatorio && (v === null || v === '' || (campo.tipo === 'monto' && !(v > 0)))) {
          faltan++;
        }
        reg[campo.id] = v;
      }
      if (faltan === 0) validos.push(reg);
      // Sin NINGÚN dato obligatorio es una fila de relleno: las planillas
      // vienen con filas prenumeradas al final y con la fila de totales.
      // Contarlas como "omitidas" asustaba sin motivo.
      else if (faltan === obligatorios.length) relleno++;
      else omitidas++;
    }
    return { validos, omitidas, relleno };
  },

  _renderImportador() {
    const s = this._imp;
    if (!s) return;
    const def = this._impDestinos[s.destino];
    const { validos, omitidas, relleno } = this._impProcesar();

    // Selector de hoja: solo si el libro tiene más de una
    const selHoja = document.getElementById('imp-hoja-wrap');
    if (selHoja) {
      selHoja.classList.toggle('hidden', s.hojas.length < 2);
      if (s.hojas.length > 1) {
        document.getElementById('imp-hoja').innerHTML = s.hojas.map(h =>
          `<option value="${this.esc(h)}"${h === s.hoja ? ' selected' : ''}>${this.esc(h)}</option>`).join('');
      }
    }

    document.getElementById('imp-archivo').textContent = s.archivo;
    const utiles = s.filas.length - relleno;
    document.getElementById('imp-filas').textContent =
      `${utiles} fila${utiles !== 1 ? 's' : ''} con datos · ${s.cabeceras.length} columnas`
      + (s.filaCabecera > 0 ? ` · títulos en la fila ${s.filaCabecera + 1}` : '');

    document.querySelectorAll('#imp-destino .seg-option').forEach(o => {
      o.classList.toggle('active', o.dataset.destino === s.destino);
    });

    // Mapeo: un select por campo destino con las columnas de la planilla
    const opciones = (sel) => ['<option value="">— sin usar —</option>']
      .concat(s.cabeceras.map((c, i) =>
        `<option value="${i}"${sel === i ? ' selected' : ''}>${this.esc(c || `Columna ${i + 1}`)}</option>`))
      .join('');

    document.getElementById('imp-mapeo').innerHTML = def.campos.map(campo => `
      <div class="imp-fila-mapeo">
        <label class="imp-label" for="imp-map-${campo.id}">${this.esc(campo.label)}${campo.obligatorio ? ' <span class="imp-req">*</span>' : ''}</label>
        <select class="form-input imp-select" id="imp-map-${campo.id}" onchange="App.setMapeoImport('${campo.id}', this.value)">
          ${opciones(s.mapeo[campo.id])}
        </select>
      </div>`).join('');

    // Vista previa: qué se va a crear exactamente, antes de confirmar
    const prev = document.getElementById('imp-preview');
    if (validos.length === 0) {
      prev.innerHTML = `<div class="imp-vacio">Ninguna fila tiene los datos obligatorios (marcados con <span class="imp-req">*</span>). Revisá el mapeo de columnas.</div>`;
    } else {
      prev.innerHTML = validos.slice(0, 3).map(r => s.destino === 'perfumes'
        ? `<div class="imp-prev-row">
             <span class="imp-prev-nombre">${this.esc(r.nombre)}</span>
             <span class="imp-prev-meta">${r.stock ?? 0} en stock · compra ${this.fmt(r.precioCompra || 0)} · venta ${this.fmt(r.precioVenta)}</span>
           </div>`
        : `<div class="imp-prev-row">
             <span class="imp-prev-nombre">${this.esc(r.perfume)}${(r.cantidad || 1) > 1 ? ` ×${r.cantidad}` : ''}</span>
             <span class="imp-prev-meta">${this.fmt(r.precioVenta)}${(r.cuotas?.total || 1) > 1 ? ` en ${r.cuotas.total} cuotas (${r.cuotas.pagadas} paga${r.cuotas.pagadas !== 1 ? 's' : ''})` : ''}${r.cliente ? ` · ${this.esc(r.cliente)}` : ''}${r.fecha ? ` · ${this.fmtDate(r.fecha)}` : ''}</span>
           </div>`).join('');
    }

    const resumen = document.getElementById('imp-resumen');
    resumen.textContent = omitidas > 0
      ? `Se van a agregar ${validos.length} · ${omitidas} sin datos obligatorios se omiten`
      : `Se van a agregar ${validos.length} registro${validos.length !== 1 ? 's' : ''}`;
    resumen.classList.toggle('con-omitidas', omitidas > 0);

    const btn = document.getElementById('imp-confirmar');
    btn.disabled = validos.length === 0;
    btn.innerHTML = `<span class="ms">playlist_add</span> Agregar ${validos.length} ${s.destino === 'perfumes' ? 'perfume' : 'venta'}${validos.length !== 1 ? 's' : ''}`;
  },

  cerrarImportador() {
    document.getElementById('modal-importar').classList.add('hidden');
    this._imp = null;
  },

  confirmarImportExcel() {
    // Anti doble-tap: dos toques duplicaban toda la planilla
    return this._once('import-excel', () => this._confirmarImportExcelImpl(),
      document.getElementById('imp-confirmar'));
  },

  // Una fila ya está cargada si coincide en lo que la identifica de verdad.
  // Para una venta: mismo cliente, mismo perfume, mismo monto y el mismo DÍA
  // (no el mismo timestamp — la planilla trae fechas sin hora).
  _impClaveFila(r, destino) {
    const norm = (s) => (s || '')
      .toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
    if (destino === 'perfumes') return norm(r.nombre);
    const dia = r.fecha ? new Date(r.fecha).toDateString() : '';
    return [norm(r.cliente), norm(r.perfume), Math.round(r.precioVenta || 0), dia].join('|');
  },

  _impYaImportados(filas, destino) {
    const existentes = new Set(
      (destino === 'perfumes' ? this.perfumes : this.ventas)
        .map(x => this._impClaveFila(
          destino === 'perfumes' ? x : { ...x, perfume: x.perfume },
          destino,
        )),
    );
    return filas.filter(r => existentes.has(this._impClaveFila(r, destino)));
  },

  async _confirmarImportExcelImpl() {
    const s = this._imp;
    if (!s) return;
    const { validos } = this._impProcesar();
    if (validos.length === 0) return;

    const destino = s.destino;

    // Importar dos veces la misma planilla duplicaba todo en silencio: es el
    // error más fácil de cometer, porque no hay ninguna señal de que ya se
    // hizo. Se avisa y se deja elegir; nunca se borra nada.
    const repetidos = this._impYaImportados(validos, destino);
    let aCargar = validos;
    if (repetidos.length) {
      const nuevos = validos.filter(r => !repetidos.includes(r));
      const soloRepes = nuevos.length === 0;
      const opcion = await this.appConfirm(
        soloRepes
          ? `Las ${repetidos.length} filas ya están cargadas. Si seguís, van a quedar duplicadas.`
          : `${repetidos.length} de ${validos.length} filas ya están cargadas. ` +
            `¿Agrego solo las ${nuevos.length} nuevas?`,
        soloRepes ? 'Agregar igual' : `Agregar solo las ${nuevos.length} nuevas`,
        'content_copy',
      );
      if (!opcion) return;
      if (!soloRepes) aCargar = nuevos;
    }

    if (!await this.appConfirm(
      `Se van a AGREGAR ${aCargar.length} ${destino === 'perfumes' ? 'perfumes' : 'ventas'} a lo que ya tenés. No se borra nada.`,
      'Agregar', 'playlist_add')) return;

    let creados = 0, fallidos = 0;
    for (const r of aCargar) {
      try {
        if (destino === 'perfumes') {
          await DB.addPerfume({
            nombre: r.nombre,
            stock: r.stock ?? 0,
            precioCompra: r.precioCompra || 0,
            precioVenta: r.precioVenta,
          });
        } else {
          // Sin perfumeId a propósito: son ventas que YA ocurrieron, y el
          // stock actual de la planilla ya las tiene descontadas. Vincularlas
          // haría que addVenta las descuente de nuevo.
          const cantidad = Math.max(1, r.cantidad || 1);
          const plan = r.cuotas || { total: 1, pagadas: 0 };
          const numCuotas = Math.max(1, Math.min(plan.total || 1, 12));
          const enCuotas = numCuotas > 1;
          // Cuánto entró ya. La columna de pagos es más precisa (puede haber
          // un pago parcial), así que gana; si está vacía se deduce del
          // numerador: "1/2" de una venta de 2900 son 1450 cobrados.
          const cobrado = (r.pago || 0) > 0
            ? r.pago
            : Math.round((r.precioVenta / numCuotas) * (plan.pagadas || 0));
          await DB.addVenta({
            perfume: r.perfume,
            perfumeId: null,
            cantidad,
            precioVenta: r.precioVenta,
            precioOriginal: r.precioVenta,
            precioCompra: r.precioCompra || 0,
            precioUnitario: Math.round(r.precioVenta / cantidad),
            precioCompraUnitario: Math.round((r.precioCompra || 0) / cantidad),
            cliente: r.cliente || 'Anónimo',
            vendedor: r.vendedor || this._defaultVendedor(),
            proveedor: r.proveedor || '',
            descuento: 0,
            nota: 'Importado de planilla',
            fecha: r.fecha || Date.now(),
            formaPago: enCuotas ? 'cuotas' : 'contado',
            numCuotas: enCuotas ? numCuotas : 1,
            // Lo que ya cobró se aplica sobre las cuotas en orden; el resto
            // queda como deuda pendiente, que es lo que se quiere ver
            primeraPagada: enCuotas ? cobrado > 0 : undefined,
            primerPago: enCuotas ? (cobrado > 0 ? cobrado : null) : undefined,
          });
        }
        creados++;
      } catch {
        fallidos++;
      }
    }

    this.cerrarImportador();
    await this.loadData();
    this.renderAll();
    this.renderAllVentas();
    this.toast(`${creados} ${destino === 'perfumes' ? 'perfumes' : 'ventas'} importados${fallidos ? ` · ${fallidos} con error` : ''}`, 'check_circle');
    this.haptic('success');
    this._notifyTabs();
  },
