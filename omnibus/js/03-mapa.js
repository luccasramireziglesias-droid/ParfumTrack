// ══════════════════════════════════════════════════════════════
// Mapa — capa fina sobre Leaflet.
//
// Cada pantalla que muestra un mapa pide el suyo por id y recibe siempre
// el mismo objeto. Leaflet no se lleva bien con contenedores ocultos
// (calcula 0×0 y deja el mapa en gris), así que hay que llamar a
// `refrescar()` cada vez que la pantalla se hace visible.
// ══════════════════════════════════════════════════════════════

const Mapa = (() => {
  // Centro por defecto: Ciudad de la Costa, Canelones — la zona de COETC.
  const CENTRO = [-34.8235, -55.9560];
  const ZOOM = 13;

  const CAPAS = {
    noche: {
      nombre: 'Noche',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      opts: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OpenStreetMap, &copy; CARTO' },
    },
    dia: {
      nombre: 'Día',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      opts: { maxZoom: 19, attribution: '&copy; OpenStreetMap' },
    },
  };

  L.Icon.Default.prototype.options.imagePath = 'vendor/images/';

  const _mapas = {};

  function crear(idContenedor, opciones = {}) {
    if (_mapas[idContenedor]) return _mapas[idContenedor];
    const map = L.map(idContenedor, {
      center: CENTRO,
      zoom: ZOOM,
      zoomControl: opciones.zoomControl !== false,
      attributionControl: true,
      // El pinch para zoom sigue, pero el doble tap no: manejando, un toque
      // repetido sin querer te deja mirando la cuadra en zoom 19.
      doubleClickZoom: false,
      ...opciones.leaflet,
    });
    map.attributionControl.setPrefix('');
    const capa = L.tileLayer(CAPAS.noche.url, CAPAS.noche.opts).addTo(map);
    _mapas[idContenedor] = { map, capa, tipoCapa: 'noche', capas: {} };
    return _mapas[idContenedor];
  }

  function get(id) { return _mapas[id]; }

  function refrescar(id) {
    const m = _mapas[id];
    if (m) setTimeout(() => m.map.invalidateSize(), 60);
  }

  function cambiarCapa(id, tipo) {
    const m = _mapas[id];
    if (!m || !CAPAS[tipo] || m.tipoCapa === tipo) return;
    m.map.removeLayer(m.capa);
    m.capa = L.tileLayer(CAPAS[tipo].url, CAPAS[tipo].opts).addTo(m.map);
    m.tipoCapa = tipo;
    DB.setConfig('capa', tipo).catch(() => {});
  }

  /** Quita una capa nombrada previa y guarda la nueva bajo el mismo nombre. */
  function _reemplazar(m, nombre, capa) {
    if (m.capas[nombre]) m.map.removeLayer(m.capas[nombre]);
    m.capas[nombre] = capa;
    if (capa) capa.addTo(m.map);
    return capa;
  }

  function limpiar(id, ...nombres) {
    const m = _mapas[id];
    if (!m) return;
    const objetivo = nombres.length ? nombres : Object.keys(m.capas);
    objetivo.forEach(n => { if (m.capas[n]) { m.map.removeLayer(m.capas[n]); delete m.capas[n]; } });
  }

  /**
   * Dibuja el trazado. Van dos líneas superpuestas: una gruesa oscura
   * abajo (el "casing") y la de color arriba. Sin el casing, una línea
   * clara sobre una avenida clara del mapa desaparece justo cuando más
   * la necesitás.
   */
  function dibujarRecorrido(id, puntos, { color = '#35c78a', nombre = 'recorrido', peso = 6 } = {}) {
    const m = _mapas[id];
    if (!m) return null;
    if (!puntos || puntos.length < 2) { _reemplazar(m, nombre, null); return null; }
    const grupo = L.layerGroup([
      L.polyline(puntos, { color: '#05060b', weight: peso + 5, opacity: 0.65, lineJoin: 'round' }),
      L.polyline(puntos, { color, weight: peso, opacity: 0.95, lineJoin: 'round' }),
    ]);
    return _reemplazar(m, nombre, grupo);
  }

  /** Tramo ya recorrido, apagado, para ver de un vistazo cuánto llevás. */
  function dibujarHecho(id, puntos, nombre = 'hecho') {
    const m = _mapas[id];
    if (!m) return null;
    if (!puntos || puntos.length < 2) { _reemplazar(m, nombre, null); return null; }
    return _reemplazar(m, nombre, L.polyline(puntos, { color: '#6b7280', weight: 6, opacity: 0.9, lineJoin: 'round' }));
  }

  function iconoParada(n) {
    return L.divIcon({
      className: 'mk-parada',
      html: `<span>${UI.esc(n)}</span>`,
      iconSize: [26, 26], iconAnchor: [13, 13],
    });
  }

  const FLECHA = {
    'der': '↱', 'izq': '↰', 'leve-der': '↗', 'leve-izq': '↖',
    'u-der': '⤾', 'u-izq': '⤿', 'aviso': '!', 'parada': '■',
  };

  function iconoHito(tipo) {
    return L.divIcon({
      className: `mk-hito ${tipo.startsWith('u-') || tipo === 'aviso' ? 'fuerte' : ''}`,
      html: `<span>${FLECHA[tipo] || '•'}</span>`,
      iconSize: [22, 22], iconAnchor: [11, 11],
    });
  }

  function dibujarParadas(id, paradas, { onClick, nombre = 'paradas' } = {}) {
    const m = _mapas[id];
    if (!m) return null;
    const marcas = (paradas || []).map((p, i) => {
      const mk = L.marker([p.lat, p.lng], { icon: iconoParada(i + 1), keyboard: false });
      mk.bindTooltip(p.nombre || `Parada ${i + 1}`, { direction: 'top', offset: [0, -12] });
      if (onClick) mk.on('click', () => onClick(p, i));
      return mk;
    });
    return _reemplazar(m, nombre, L.layerGroup(marcas));
  }

  function dibujarHitos(id, hitos, { onClick, nombre = 'hitos' } = {}) {
    const m = _mapas[id];
    if (!m) return null;
    const marcas = (hitos || []).map((h, i) => {
      const mk = L.marker([h.lat, h.lng], { icon: iconoHito(h.tipo), keyboard: false });
      mk.bindTooltip(h.texto || Geo.TEXTO_GIRO[h.tipo] || h.tipo, { direction: 'top', offset: [0, -10] });
      if (onClick) mk.on('click', () => onClick(h, i));
      return mk;
    });
    return _reemplazar(m, nombre, L.layerGroup(marcas));
  }

  /** Marcador de "estás acá": flecha que apunta al rumbo de marcha. */
  function ponerPosicion(id, latlng, rumbo = null, precision = null) {
    const m = _mapas[id];
    if (!m || !latlng) return;
    if (!m.capas.yo) {
      const icono = L.divIcon({ className: 'mk-yo', html: '<i></i>', iconSize: [30, 30], iconAnchor: [15, 15] });
      m.capas.yo = L.marker(latlng, { icon: icono, zIndexOffset: 1000, keyboard: false }).addTo(m.map);
    } else {
      m.capas.yo.setLatLng(latlng);
    }
    const el = m.capas.yo.getElement();
    if (el) {
      const flecha = el.querySelector('i');
      if (flecha) flecha.style.transform = rumbo == null ? 'none' : `rotate(${rumbo}deg)`;
      el.classList.toggle('sin-rumbo', rumbo == null);
    }
    if (precision != null) {
      if (!m.capas.precision) {
        m.capas.precision = L.circle(latlng, { radius: precision, color: '#4ea8de', weight: 1, fillOpacity: 0.08 }).addTo(m.map);
      } else {
        m.capas.precision.setLatLng(latlng).setRadius(precision);
      }
    }
  }

  function encuadrar(id, puntos, padding = 40) {
    const m = _mapas[id];
    if (!m || !puntos || !puntos.length) return;
    m.map.fitBounds(L.latLngBounds(puntos), { padding: [padding, padding], maxZoom: 17 });
  }

  return {
    CENTRO, ZOOM, CAPAS, crear, get, refrescar, cambiarCapa, limpiar,
    dibujarRecorrido, dibujarHecho, dibujarParadas, dibujarHitos,
    ponerPosicion, encuadrar, iconoParada, iconoHito, FLECHA,
  };
})();
