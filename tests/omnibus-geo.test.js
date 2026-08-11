// Geometría de recorridos: lo que sostiene el modo manejo.
//
// Un error acá no se ve en pantalla, se ve en la calle: un giro anunciado
// en la esquina equivocada o una alerta de desvío que no salta. Por eso
// las distancias se contrastan contra valores conocidos y no contra lo
// que devuelva la propia implementación.

import { describe, it, expect } from 'vitest';
import Geo from '../omnibus/js/00-geo.js';

// Un cuadrado de ~100 m de lado en Ciudad de la Costa: sur → este → norte.
const A = [-34.8235, -55.9560];
const B = [-34.8235, -55.9549];   // ~100 m al este
const C = [-34.8226, -55.9549];   // ~100 m al norte

describe('distancia', () => {
  it('mide un tramo conocido con menos de 1 % de error', () => {
    // 0.0011° de longitud a lat -34.82 ≈ 100,5 m
    expect(Geo.distancia(A, B)).toBeGreaterThan(99);
    expect(Geo.distancia(A, B)).toBeLessThan(102);
  });

  it('da cero para el mismo punto', () => {
    expect(Geo.distancia(A, A)).toBe(0);
  });

  it('es simétrica', () => {
    expect(Geo.distancia(A, B)).toBeCloseTo(Geo.distancia(B, A), 6);
  });
});

describe('rumbo y deltaRumbo', () => {
  it('hacia el este da 90 grados', () => {
    expect(Geo.rumbo(A, B)).toBeCloseTo(90, 0);
  });

  it('hacia el norte da 0 grados', () => {
    expect(Geo.rumbo(B, C)).toBeCloseTo(0, 0);
  });

  it('cruza el 0/360 sin saltar', () => {
    // De 350° a 10° son 20° a la derecha, no -340°. Sin esto, un giro
    // suave apuntando al norte se detecta como una vuelta en U.
    expect(Geo.deltaRumbo(350, 10)).toBe(20);
    expect(Geo.deltaRumbo(10, 350)).toBe(-20);
  });

  it('trata el giro en U como +180, nunca -180', () => {
    expect(Geo.deltaRumbo(0, 180)).toBe(180);
  });
});

describe('acumuladas y avance', () => {
  const puntos = [A, B, C];

  it('la última acumulada es el largo total', () => {
    const acc = Geo.acumuladas(puntos);
    expect(acc[acc.length - 1]).toBeCloseTo(Geo.largo(puntos), 6);
  });

  it('el avance en la mitad del primer tramo es la mitad de su largo', () => {
    const acc = Geo.acumuladas(puntos);
    const medio = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const proy = Geo.proyectar(medio, puntos, -1);
    expect(Geo.avance(proy, puntos, acc)).toBeCloseTo(Geo.distancia(A, B) / 2, 0);
  });
});

describe('proyectar', () => {
  const puntos = [A, B, C];

  it('un punto sobre la traza da distancia casi cero', () => {
    const medio = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    expect(Geo.proyectar(medio, puntos, -1).dist).toBeLessThan(1);
  });

  it('mide la separación perpendicular de un punto afuera', () => {
    // ~55 m al sur del primer tramo (0.0005° de latitud ≈ 55 m)
    const afuera = [A[0] - 0.0005, (A[1] + B[1]) / 2];
    const d = Geo.proyectar(afuera, puntos, -1).dist;
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(60);
  });

  it('la ventana evita saltar a la pasada de vuelta', () => {
    // Ida y vuelta por la MISMA calle: el punto de la ida está a la misma
    // distancia de los dos tramos. Con búsqueda global el match puede caer
    // en el regreso y la app anunciaría los giros de la vuelta yendo de ida.
    const ida = [];
    for (let i = 0; i <= 20; i++) ida.push([A[0], A[1] + 0.0011 * (i / 20)]);
    const vuelta = ida.slice().reverse();
    const puntosIdaVuelta = [...ida, ...vuelta];

    const enLaIda = [A[0], A[1] + 0.0011 * 0.25];
    const conVentana = Geo.proyectar(enLaIda, puntosIdaVuelta, 4);
    expect(conVentana.idx).toBeLessThan(ida.length);
  });
});

describe('simplificar', () => {
  it('deja solo las puntas de una recta', () => {
    const recta = [];
    for (let i = 0; i <= 50; i++) recta.push([A[0], A[1] + 0.0011 * (i / 50)]);
    expect(Geo.simplificar(recta, 6)).toHaveLength(2);
  });

  it('conserva la esquina de un giro', () => {
    const conEsquina = [A, [A[0], A[1] + 0.0006], B, [B[0] + 0.0005, B[1]], C];
    const s = Geo.simplificar(conEsquina, 6);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s[0]).toEqual(A);
    expect(s[s.length - 1]).toEqual(C);
  });

  it('nunca mueve el primero ni el último punto', () => {
    const ruidosa = [];
    for (let i = 0; i <= 80; i++) {
      ruidosa.push([A[0] + Math.sin(i) * 0.00002, A[1] + 0.0011 * (i / 80)]);
    }
    const s = Geo.simplificar(ruidosa, 10);
    expect(s[0]).toEqual(ruidosa[0]);
    expect(s[s.length - 1]).toEqual(ruidosa[ruidosa.length - 1]);
  });
});

describe('detectarGiros', () => {
  /** Traza recta de `metros` desde `desde` con el rumbo dado, un punto cada 10 m. */
  function tramo(desde, rumboGrados, metros) {
    const out = [];
    const paso = 10;
    const rad = rumboGrados * Math.PI / 180;
    for (let d = paso; d <= metros; d += paso) {
      out.push([
        desde[0] + (d * Math.cos(rad)) / 110574,
        desde[1] + (d * Math.sin(rad)) / (111320 * Math.cos(desde[0] * Math.PI / 180)),
      ]);
    }
    return out;
  }

  it('no inventa giros en una recta', () => {
    const recta = [A, ...tramo(A, 90, 400)];
    expect(Geo.detectarGiros(recta)).toHaveLength(0);
  });

  it('encuentra una esquina de 90 grados a la derecha', () => {
    const ida = [A, ...tramo(A, 0, 200)];          // al norte
    const esquina = ida[ida.length - 1];
    const puntos = [...ida, ...tramo(esquina, 90, 200)];   // dobla al este
    const giros = Geo.detectarGiros(puntos);
    expect(giros).toHaveLength(1);
    expect(giros[0].tipo).toBe('der');
  });

  it('encuentra una esquina a la izquierda', () => {
    const ida = [A, ...tramo(A, 0, 200)];
    const esquina = ida[ida.length - 1];
    const puntos = [...ida, ...tramo(esquina, 270, 200)];
    const giros = Geo.detectarGiros(puntos);
    expect(giros).toHaveLength(1);
    expect(giros[0].tipo).toBe('izq');
  });

  it('cuenta una esquina UNA sola vez aunque tenga varios vértices', () => {
    // La curva de la esquina repartida en cinco puntos, como la deja un GPS
    // real. Sin agrupar, cada vértice supera el umbral y salen cinco giros:
    // la app cantaría "girá a la derecha" cinco veces en la misma esquina.
    const ida = [A, ...tramo(A, 0, 200)];
    let p = ida[ida.length - 1];
    const curva = [];
    for (const r of [18, 36, 54, 72, 90]) {
      const t = tramo(p, r, 10);
      curva.push(...t);
      p = t[t.length - 1];
    }
    const puntos = [...ida, ...curva, ...tramo(p, 90, 200)];
    expect(Geo.detectarGiros(puntos)).toHaveLength(1);
  });

  it('ignora los giros pegados a las puntas del recorrido', () => {
    // Un giro en el metro 5 no se puede anunciar: no hay lugar para avisarlo
    // y encima el rumbo inicial todavía es puro ruido del GPS.
    const puntos = [A, ...tramo(A, 0, 10), ...tramo([A[0] + 10 / 110574, A[1]], 90, 300)];
    for (const g of Geo.detectarGiros(puntos)) {
      expect(g.metros).toBeGreaterThanOrEqual(25);
    }
  });
});

describe('fmtDist', () => {
  it('redondea los metros de a diez', () => {
    expect(Geo.fmtDist(157)).toBe('160 m');
    expect(Geo.fmtDist(4)).toBe('0 m');
  });

  it('pasa a kilómetros arriba de mil', () => {
    expect(Geo.fmtDist(1500)).toBe('1.5 km');
    expect(Geo.fmtDist(24000)).toBe('24 km');
  });

  it('no explota con valores inválidos', () => {
    expect(Geo.fmtDist(Infinity)).toBe('—');
    expect(Geo.fmtDist(NaN)).toBe('—');
  });
});

describe('bbox', () => {
  it('encierra todos los puntos', () => {
    const b = Geo.bbox([A, B, C]);
    expect(b.sur).toBeLessThanOrEqual(Math.min(A[0], B[0], C[0]));
    expect(b.norte).toBeGreaterThanOrEqual(Math.max(A[0], B[0], C[0]));
    expect(b.oeste).toBeLessThanOrEqual(Math.min(A[1], B[1], C[1]));
    expect(b.este).toBeGreaterThanOrEqual(Math.max(A[1], B[1], C[1]));
  });

  it('el margen se aplica en metros y agranda la caja', () => {
    const sin = Geo.bbox([A, B]);
    const con = Geo.bbox([A, B], 500);
    expect(con.sur).toBeLessThan(sin.sur);
    expect(con.norte).toBeGreaterThan(sin.norte);
  });

  it('devuelve null sin puntos', () => {
    expect(Geo.bbox([])).toBeNull();
  });
});
