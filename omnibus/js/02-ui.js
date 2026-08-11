// ══════════════════════════════════════════════════════════════
// UI — escapado, navegación entre pantallas, avisos y diálogos.
// ══════════════════════════════════════════════════════════════

const UI = (() => {
  /** Para TEXTO dentro de HTML. No escapa comillas: no sirve para atributos. */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Para ATRIBUTOS. Sí escapa comillas.
   * Los nombres de recorrido y de parada los escribe el usuario y terminan
   * dentro de onclick="..." y title="...": con esc() a secas, una comilla
   * en "Parada 'La Tuna'" rompe el atributo y abre un XSS.
   */
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const $  = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  // ── Navegación ──────────────────────────────────────────────
  let _pantalla = 'lista';
  const _alSalir = {};

  function irA(id, params) {
    if (_pantalla === id && !params) return;
    const anterior = _pantalla;
    if (_alSalir[anterior]) { try { _alSalir[anterior](); } catch (e) { console.warn(e); } }
    $$('.pantalla').forEach(p => p.classList.toggle('activa', p.id === `p-${id}`));
    $$('.tab').forEach(t => t.classList.toggle('activo', t.dataset.ir === id));
    _pantalla = id;
    document.body.dataset.pantalla = id;
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('pantalla', { detail: { id, anterior, params } }));
  }

  const pantallaActual = () => _pantalla;
  const alSalir = (id, fn) => { _alSalir[id] = fn; };

  // ── Avisos ──────────────────────────────────────────────────
  let _toastT = null;
  function toast(msg, tipo = 'info', ms = 3200) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast visible ${tipo}`;
    clearTimeout(_toastT);
    _toastT = setTimeout(() => { el.className = 'toast'; }, ms);
  }

  // ── Diálogos ────────────────────────────────────────────────
  function _dialogo({ titulo, cuerpo, acciones }) {
    return new Promise(res => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `
        <div class="dialogo" role="dialog" aria-modal="true" aria-label="${escAttr(titulo)}">
          <h3>${esc(titulo)}</h3>
          <div class="dialogo-cuerpo">${cuerpo}</div>
          <div class="dialogo-acciones"></div>
        </div>`;
      const cont = ov.querySelector('.dialogo-acciones');
      acciones.forEach(a => {
        const b = document.createElement('button');
        b.className = `btn ${a.clase || ''}`;
        b.textContent = a.texto;
        b.onclick = () => { const v = a.valor(ov); ov.remove(); res(v); };
        cont.appendChild(b);
      });
      ov.addEventListener('click', e => { if (e.target === ov) { ov.remove(); res(null); } });
      document.body.appendChild(ov);
      const foco = ov.querySelector('input, textarea, select, button');
      if (foco) foco.focus();
    });
  }

  const confirmar = (titulo, texto = '', okTexto = 'Sí, dale') => _dialogo({
    titulo,
    cuerpo: texto ? `<p>${esc(texto)}</p>` : '',
    acciones: [
      { texto: 'Cancelar', clase: 'gris', valor: () => false },
      { texto: okTexto,    clase: 'peligro', valor: () => true },
    ],
  });

  const pedirTexto = (titulo, valorInicial = '', placeholder = '') => _dialogo({
    titulo,
    cuerpo: `<input type="text" class="campo" id="dlg-texto" value="${escAttr(valorInicial)}" placeholder="${escAttr(placeholder)}">`,
    acciones: [
      { texto: 'Cancelar', clase: 'gris', valor: () => null },
      { texto: 'Guardar',  clase: 'ok',   valor: (ov) => ov.querySelector('#dlg-texto').value.trim() },
    ],
  });

  const elegir = (titulo, opciones) => _dialogo({
    titulo,
    cuerpo: '',
    acciones: [
      ...opciones.map(o => ({ texto: o.texto, clase: o.clase || '', valor: () => o.valor })),
      { texto: 'Cancelar', clase: 'gris', valor: () => null },
    ],
  });

  /** dd/mm/aaaa — formato de acá, no el del locale del teléfono. */
  function fecha(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  /** Duración en h/min/s a partir de milisegundos. */
  function duracion(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
    if (m) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
    return `${s} s`;
  }

  return { esc, escAttr, $, $$, irA, pantallaActual, alSalir, toast, confirmar, pedirTexto, elegir, fecha, duracion };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = UI;
