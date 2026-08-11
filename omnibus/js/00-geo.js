// ══════════════════════════════════════════════════════════════
// Geo — matemática de recorridos
//
// Todo lo que sigue trabaja sobre una proyección plana local
// (equirectangular escalada por cos(lat)). A la escala de una ciudad el
// error contra la fórmula esférica real es de centímetros, y a cambio
// las cuentas son sumas y multiplicaciones: `proyectar()` corre para
// cada punto del recorrido en cada fix del GPS (1 por segundo), así que
// meter trigonometría adentro del bucle se nota en la batería.
// ══════════════════════════════════════════════════════════════

const Geo = (() => {
  const R = 6371008.8;          // radio medio terrestre, metros
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;

  /** Metros por grado de longitud a esta latitud. */
  function mLon(lat) { return 111320 * Math.cos(lat * RAD); }
  const M_LAT = 110574;         // metros por grado de latitud

  /** Distancia real entre dos puntos, en metros. */
  function distancia(a, b) {
    const dLat = (b[0] - a[0]) * RAD;
    const dLon = (b[1] - a[1]) * RAD;
    const la1 = a[0] * RAD, la2 = b[0] * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Rumbo de a hacia b en grados (0 = norte, 90 = este). */
  function rumbo(a, b) {
    const la1 = a[0] * RAD, la2 = b[0] * RAD;
    const dLon = (b[1] - a[1]) * RAD;
    const y = Math.sin(dLon) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
    return (Math.atan2(y, x) * DEG + 360) % 360;
  }

  /** Diferencia de rumbos con signo, en (-180, 180]. Positivo = giro a la derecha. */
  function deltaRumbo(desde, hasta) {
    let d = (hasta - desde + 540) % 360 - 180;
    return d === -180 ? 180 : d;
  }

  /** Largo total de una polilínea, en metros. */
  function largo(puntos) {
    let t = 0;
    for (let i = 1; i < puntos.length; i++) t += distancia(puntos[i - 1], puntos[i]);
    return t;
  }

  /**
   * Distancias acumuladas desde el inicio, una por punto.
   * Se calcula una vez al cargar el recorrido y se reusa en cada fix:
   * es lo que permite responder "cuánto falta" sin recorrer el array.
   */
  function acumuladas(puntos) {
    const acc = new Float64Array(puntos.length);
    for (let i = 1; i < puntos.length; i++) acc[i] = acc[i - 1] + distancia(puntos[i - 1], puntos[i]);
    return acc;
  }

  /**
   * Proyecta un punto sobre el segmento a→b.
   * Devuelve { t, dist, punto } donde t ∈ [0,1] es la posición sobre el
   * segmento y dist la separación perpendicular en metros.
   */
  function proyectarEnSegmento(p, a, b) {
    const kx = mLon((a[0] + b[0]) / 2);
    const ax = a[1] * kx, ay = a[0] * M_LAT;
    const bx = b[1] * kx, by = b[0] * M_LAT;
    const px = p[1] * kx, py = p[0] * M_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx, cy = ay + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    return { t, dist, punto: [cy / M_LAT, cx / kx] };
  }

  /**
   * Encuentra dónde está `p` sobre el recorrido.
   *
   * `desdeIdx` limita la búsqueda a una ventana alrededor del último
   * segmento conocido. NO es una optimización: los recorridos de ómnibus
   * pasan dos veces por la misma avenida (ida y vuelta), y sin ventana el
   * match salta a la otra pasada y la app anuncia giros del regreso
   * mientras todavía vas de ida. Con `desdeIdx = -1` busca en todo el
   * recorrido, que es lo correcto al arrancar o al recuperarse de un desvío.
   */
  function proyectar(p, puntos, desdeIdx = -1, ventana = 60) {
    let ini = 0, fin = puntos.length - 1;
    if (desdeIdx >= 0) {
      ini = Math.max(0, desdeIdx - 8);
      fin = Math.min(puntos.length - 1, desdeIdx + ventana);
    }
    let mejor = { idx: ini, t: 0, dist: Infinity, punto: puntos[ini] || null };
    for (let i = ini; i < fin; i++) {
      const r = proyectarEnSegmento(p, puntos[i], puntos[i + 1]);
      if (r.dist < mejor.dist) mejor = { idx: i, t: r.t, dist: r.dist, punto: r.punto };
    }
    return mejor;
  }

  /** Metros recorridos desde el inicio hasta una proyección. */
  function avance(proy, puntos, acc) {
    if (!proy || proy.idx >= puntos.length - 1) return acc[acc.length - 1] || 0;
    const segLargo = acc[proy.idx + 1] - acc[proy.idx];
    return acc[proy.idx] + proy.t * segLargo;
  }

  /**
   * Simplificación Douglas-Peucker.
   * Una grabación de GPS a 1 Hz deja ~3.600 puntos por hora, casi todos
   * redundantes sobre una recta. Sin esto el recorrido pesa de más, el
   * mapa se arrastra y el detector de giros ve ruido donde hay una avenida.
   */
  function simplificar(puntos, tolerancia = 6) {
    if (puntos.length < 3) return puntos.slice();
    const marcados = new Uint8Array(puntos.length);
    marcados[0] = marcados[puntos.length - 1] = 1;
    const pila = [[0, puntos.length - 1]];
    while (pila.length) {
      const [ini, fin] = pila.pop();
      let maxDist = 0, maxIdx = -1;
      for (let i = ini + 1; i < fin; i++) {
        const d = proyectarEnSegmento(puntos[i], puntos[ini], puntos[fin]).dist;
        if (d > maxDist) { maxDist = d; maxIdx = i; }
      }
      if (maxDist > tolerancia && maxIdx > 0) {
        marcados[maxIdx] = 1;
        pila.push([ini, maxIdx], [maxIdx, fin]);
      }
    }
    return puntos.filter((_, i) => marcados[i]);
  }

  /**
   * Detecta los giros de una polilínea a partir de la geometría.
   *
   * Mira el rumbo `mirada` metros antes y `mirada` metros después de cada
   * vértice, no el de los segmentos vecinos: una esquina real viene con
   * tres o cuatro puntos de GPS repartidos en la curva, y comparar segmento
   * contra segmento parte un giro de 90° en tres de 30° que no llegan al
   * umbral. Con la ventana, la esquina aparece una vez y con el ángulo real.
   */
  function detectarGiros(puntos, { umbral = 32, mirada = 25, separacionMin = 30 } = {}) {
    if (puntos.length < 3) return [];
    const acc = acumuladas(puntos);
    const total = acc[acc.length - 1];
    const giros = [];

    for (let i = 1; i < puntos.length - 1; i++) {
      const d = acc[i];
      if (d < mirada || total - d < mirada) continue;

      let a = i; while (a > 0 && acc[i] - acc[a] < mirada) a--;
      let b = i; while (b < puntos.length - 1 && acc[b] - acc[i] < mirada) b++;

      const delta = deltaRumbo(rumbo(puntos[a], puntos[i]), rumbo(puntos[i], puntos[b]));
      if (Math.abs(delta) < umbral) continue;

      // Un giro fuerte deja varios vértices seguidos arriba del umbral.
      // Nos quedamos con el más pronunciado de cada racimo.
      const previo = giros[giros.length - 1];
      if (previo && d - previo.metros < separacionMin) {
        if (Math.abs(delta) > Math.abs(previo.delta)) {
          giros[giros.length - 1] = { idx: i, metros: d, delta, tipo: tipoDeGiro(delta) };
        }
        continue;
      }
      giros.push({ idx: i, metros: d, delta, tipo: tipoDeGiro(delta) });
    }
    return giros;
  }

  function tipoDeGiro(delta) {
    const a = Math.abs(delta);
    if (a >= 150) return delta > 0 ? 'u-der' : 'u-izq';
    if (a >= 60)  return delta > 0 ? 'der' : 'izq';
    return delta > 0 ? 'leve-der' : 'leve-izq';
  }

  const TEXTO_GIRO = {
    'der':      'girá a la derecha',
    'izq':      'girá a la izquierda',
    'leve-der': 'mantenete por la derecha',
    'leve-izq': 'mantenete por la izquierda',
    'u-der':    'giro en U a la derecha',
    'u-izq':    'giro en U a la izquierda',
  };

  /** Caja que contiene todos los puntos, con un margen en metros. */
  function bbox(puntos, margen = 0) {
    if (!puntos.length) return null;
    let s = 90, o = 180, n = -90, e = -180;
    for (const [lat, lng] of puntos) {
      if (lat < s) s = lat; if (lat > n) n = lat;
      if (lng < o) o = lng; if (lng > e) e = lng;
    }
    if (margen) {
      const dLat = margen / M_LAT;
      const dLon = margen / mLon((n + s) / 2 || 0);
      s -= dLat; n += dLat; o -= dLon; e += dLon;
    }
    return { sur: s, oeste: o, norte: n, este: e };
  }

  /** Formatea una distancia para mostrarla o leerla en voz alta. */
  function fmtDist(m) {
    if (!isFinite(m)) return '—';
    if (m < 1000) return `${Math.round(m / 10) * 10} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }

  return {
    distancia, rumbo, deltaRumbo, largo, acumuladas, proyectar, proyectarEnSegmento,
    avance, simplificar, detectarGiros, tipoDeGiro, TEXTO_GIRO, bbox, fmtDist,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
