// PIN globals — must be at top so onclick handlers work immediately
let ventas = [],
  perfumes = [],
  gastos = [],
  caja = [];
let activeMesVentas = "todos",
  activeMesGan = "todos",
  activeMesGastos = "todos",
  activeMesCaja = "todos";
let filtroEstado = "todas",
  pendingImport = null,
  pendingDeleteId = null,
  pendingDeleteMes = null;
let perfumesEnvioTemp = [],
  editandoPerfumeNombre = null,
  editFotoTemporal = null,
  chartMeses = null;
let metaMensual = 0;
const MESES = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];
const EXCLUIR = [
  "MOVIMIENTO",
  "EXTRADOSE",
  "RESUMEN",
  "CAJA",
  "DETALLE",
  "TOTAL",
  "REPORTE",
];
const CAT_LABELS = {
  envio_compra: "📦 Envío de compra",
  envio_venta: "🚚 Envío de venta",
  bolsas: "🛍 Bolsas/Packaging",
  otro: "📋 Otro gasto",
};
const DIAS_NOMBRES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
// ── INDEXEDDB STORAGE (capacidad casi ilimitada vs ~5MB de localStorage) ──
const PTDB = {
  db: null,
  async init() {
    return new Promise((resolve) => {
      const req = indexedDB.open("parfumtrack_db", 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("data")) db.createObjectStore("data");
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      req.onerror = () => resolve(); // fallback: sigue sin IDB
    });
  },
  async get(key) {
    if (!this.db) return null;
    return new Promise((resolve) => {
      const req = this.db
        .transaction("data", "readonly")
        .objectStore("data")
        .get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  },
  async set(key, value) {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db.transaction("data", "readwrite");
      tx.objectStore("data").put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  },
  async delete(key) {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db.transaction("data", "readwrite");
      tx.objectStore("data").delete(key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  },
  async clear() {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db.transaction("data", "readwrite");
      tx.objectStore("data").clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  },
};

// ── MULTI-PERFIL ──
let activeProfile = localStorage.getItem("pt_active_profile") || "default";

function profileKey(key) {
  return `${key}_${activeProfile}`;
}

async function loadProfile(pid) {
  activeProfile = pid;
  localStorage.setItem("pt_active_profile", pid);
  // Lee de IndexedDB; si no existe migra desde localStorage automáticamente
  async function loadKey(key, defaultVal) {
    let val = await PTDB.get(key);
    if (val === null) {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
          val =
            typeof defaultVal === "number"
              ? parseFloat(raw) || 0
              : JSON.parse(raw);
          await PTDB.set(key, val);
          localStorage.removeItem(key);
        }
      } catch (e) {}
    }
    return val ?? defaultVal;
  }
  ventas = await loadKey(profileKey("vip_ventas_v2"), []);
  perfumes = await loadKey(profileKey("vip_stock_v2"), []);
  gastos = await loadKey(profileKey("vip_gastos_v1"), []);
  caja = await loadKey(profileKey("vip_caja_v1"), []);
  metaMensual = await loadKey(profileKey("vip_meta_v1"), 0);
}

// save() con debounce para evitar escrituras repetitivas
let _saveTimer = null;
function save(immediate) {
  if (immediate) {
    _saveNow();
    return;
  }
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveNow, 500);
}
async function _saveNow() {
  await Promise.all([
    PTDB.set(profileKey("vip_ventas_v2"), ventas),
    PTDB.set(profileKey("vip_stock_v2"), perfumes),
    PTDB.set(profileKey("vip_gastos_v1"), gastos),
    PTDB.set(profileKey("vip_caja_v1"), caja),
    PTDB.set(profileKey("vip_meta_v1"), metaMensual),
  ]);
}

function getProfiles() {
  try {
    return JSON.parse(localStorage.getItem("pt_profiles") || "[]");
  } catch (e) {
    return [];
  }
}

function saveProfiles(profiles) {
  localStorage.setItem("pt_profiles", JSON.stringify(profiles));
}

function getProfileName(pid) {
  const profiles = getProfiles();
  const p = profiles.find((x) => x.id === pid);
  return p ? p.name : pid;
}

// Inicialización async — IndexedDB primero, luego carga datos
ventas = [];
perfumes = [];
gastos = [];
caja = [];
metaMensual = 0;
const _appDataReady = PTDB.init().then(() => loadProfile(activeProfile));

function fmt(n) {
  return (
    "$" +
    Number(n || 0).toLocaleString("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}
function toast(msg, ms = 2800) {
  const el = document.getElementById("toast");
  el.classList.remove("has-undo");
  el.innerHTML = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

// ── UNDO SYSTEM ──
let _undoBuffer = null;
function toastUndo(msg, undoFn, ms = 6000) {
  _undoBuffer = undoFn;
  const el = document.getElementById("toast");
  el.classList.add("has-undo");
  el.innerHTML = `<span>${msg}</span><button class="toast-undo-btn" onclick="undoLast()">↩ Deshacer</button>`;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.classList.remove("show", "has-undo");
    _undoBuffer = null;
  }, ms);
}
function undoLast() {
  if (!_undoBuffer) return;
  _undoBuffer();
  _undoBuffer = null;
  const el = document.getElementById("toast");
  clearTimeout(el._t);
  el.classList.remove("has-undo");
  el.innerHTML = "↩ Deshecho";
  el._t = setTimeout(() => el.classList.remove("show"), 2000);
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("open");
  // Force repaint to unblock desktop render after modal close
  void document.body.offsetHeight;
}
function hoy() {
  return new Date().toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mesKey(fecha) {
  if (!fecha) return "";
  const p = fecha.split("/");
  return p.length < 3 ? "" : p[1] + "/" + p[2];
}
function mesLabel(key) {
  if (!key) return "";
  const [m, a] = key.split("/");
  const n = [
    "",
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  return (n[parseInt(m)] || m) + " " + a;
}
function mesesDeVentas() {
  return [...new Set(ventas.map((v) => mesKey(v.fecha)).filter(Boolean))]
    .sort()
    .reverse();
}
function mesesDeGastos() {
  return [...new Set(gastos.map((g) => mesKey(g.fecha)).filter(Boolean))]
    .sort()
    .reverse();
}
function mesesDeCaja() {
  return [...new Set(caja.map((m) => mesKey(m.fecha)).filter(Boolean))]
    .sort()
    .reverse();
}
function calcDebe(v) {
  if (!v.esCuotas) return 0;
  const p = (v.cuotasPagos || []).reduce((s, p) => s + p.monto, 0);
  return Math.max(0, (v.precioVenta || 0) - p);
}
function ventaCompletada(v) {
  return !v.esCuotas || calcDebe(v) <= 0;
}
function diasDesdeUltimoPago(v) {
  if (!v.esCuotas || ventaCompletada(v)) return -1;
  const pagos = v.cuotasPagos || [];
  const ref = pagos.length > 0 ? pagos[pagos.length - 1].fecha : v.fecha;
  if (!ref) return -1;
  const [d, m, a] = ref.split("/");
  return Math.floor((Date.now() - new Date(a, m - 1, d).getTime()) / 86400000);
}
function parseExcelDate(val) {
  if (!val && val !== 0) return "";
  if (typeof val === "number" && val > 40000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  }
  const s = String(val).trim();
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) return s.replace(/-/g, "/");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [a, m, d] = s.split("T")[0].split("-");
    return `${d}/${m}/${a}`;
  }
  return s;
}
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  document.getElementById("theme-btn").textContent = isDark ? "🌙" : "☀️";
  localStorage.setItem("vip_theme", isDark ? "light" : "dark");
  if (chartMeses) renderChartMeses();
}
(function () {
  const t = localStorage.getItem("vip_theme") || "dark";
  document.documentElement.setAttribute("data-theme", t);
  const btn = document.getElementById("theme-btn");
  if (btn) btn.textContent = t === "dark" ? "🌙" : "☀️";
})();

// ── BACKUP ───────────────────────────────────────────────────
// backupData ya registra timestamp y snooze — no necesita override
function backupData() {
  const data = {
    ventas,
    perfumes,
    gastos,
    caja,
    meta: metaMensual,
    fecha: hoy(),
    version: "vip_v2",
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `VIP_Parfums_backup_${hoy().replace(/\//g, "-")}.json`;
  a.click();
  localStorage.setItem("pt_last_backup", Date.now().toString());
  localStorage.removeItem("pt_backup_snooze");
  localStorage.removeItem("pt_backup_banner_snooze");
  if (typeof updateSyncStatus === "function") updateSyncStatus();
  toast("💾 Backup descargado");
}
function restoreBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.version || !data.ventas) {
        toast("⚠ Archivo inválido");
        return;
      }
      ventas = data.ventas || [];
      perfumes = data.perfumes || [];
      gastos = data.gastos || [];
      caja = data.caja || [];
      if (data.meta) metaMensual = data.meta;
      save();
      localStorage.setItem(profileKey("vip_meta_v1"), metaMensual);
      updateStats();
      toast(
        `✓ Backup restaurado · ${ventas.length} ventas, ${perfumes.length} perfumes`,
      );
    } catch (err) {
      toast("⚠ Error al leer el backup");
    }
  };
  r.readAsText(file);
  e.target.value = "";
}

function confirmarBorrarStock() {
  if (!perfumes.length) return;
  document.getElementById("del-stock-msg").textContent =
    `¿Borrar los ${perfumes.length} perfumes del stock? Las ventas registradas no se tocan.`;
  document.getElementById("del-stock-btn").onclick = () => {
    perfumes = [];
    save();
    closeModal("del-stock-modal");
    const op = document.getElementById("stock-opciones");
    if (op) op.style.display = "none";
    renderStock();
    updateStats();
    toast("Stock borrado");
  };
  document.getElementById("del-stock-modal").classList.add("open");
}

function renderStatsMes(filtered, gastFilt) {
  const el = document.getElementById("stats-mes");
  if (!filtered.length) {
    el.innerHTML = "";
    return;
  }
  const totInversion = filtered.reduce((s, v) => s + (v.precioCompra || 0), 0);
  const totVenta = filtered.reduce((s, v) => s + (v.precioVenta || 0), 0);
  const totGan = filtered.reduce((s, v) => s + (v.ganancia || 0), 0);
  const totGast = gastFilt.reduce((s, g) => s + g.monto, 0);
  const rentabilidad =
    totInversion > 0 ? ((totGan / totInversion) * 100).toFixed(1) : 0;
  const provsUnicos = [
    ...new Set(filtered.map((v) => v.proveedor).filter(Boolean)),
  ].length;
  const perfumesUnicos = [...new Set(filtered.map((v) => v.perfume))].length;
  const clientesUnicos = [
    ...new Set(filtered.map((v) => v.cliente).filter(Boolean)),
  ].length;
  el.innerHTML = [
    { l: "💎 Inversión total", v: fmt(totInversion), s: "precio compra" },
    { l: "📈 Rentabilidad", v: rentabilidad + "%", s: "gan/inversión" },
    { l: "🍶 Perfumes distintos", v: perfumesUnicos, s: "tipos vendidos" },
    {
      l: "👥 Clientes",
      v: clientesUnicos || filtered.length,
      s: "en el período",
    },
    { l: "🏪 Proveedores", v: provsUnicos, s: "distintos" },
    {
      l: "💸 Gasto promedio",
      v: fmt(totGast / (filtered.length || 1)),
      s: "por venta",
    },
  ]
    .map(
      (s) =>
        `<div class="stat-mini"><div class="stat-mini-lbl">${s.l}</div><div class="stat-mini-val">${s.v}</div><div class="stat-mini-sub">${s.s}</div></div>`,
    )
    .join("");
}

function renderComprasPeriodo() {
  const el = document.getElementById("gan-compras");
  // Filtrar compras de caja del período seleccionado
  const compras = caja.filter(
    (m) =>
      m.esCompraStock &&
      (activeMesGan === "todos" || mesKey(m.fecha) === activeMesGan),
  );
  if (!compras.length) {
    el.innerHTML =
      '<div style="font-size:13px;color:var(--text3);padding:8px 0">No hay compras de stock registradas en este período.</div>';
    return;
  }
  const totalInv = compras.reduce((s, c) => s + c.monto, 0);
  el.innerHTML =
    `<div class="mes-total" style="margin-bottom:9px"><span>${compras.length} compra${compras.length !== 1 ? "s" : ""} de stock</span><span style="color:var(--danger);font-weight:500">${fmt(totalInv)} invertidos</span></div>` +
    compras
      .map(
        (c) =>
          `<div class="venta-card"><div class="vc-header"><div class="vc-name" style="font-size:14px">${c.desc.replace("📦 Compra stock: ", "")}</div><div class="vc-meta"><div class="vc-date">📅 ${c.fecha}</div></div></div><div class="vc-body"><div class="vc-row"><span>Invertido</span><span style="color:var(--danger)">${fmt(c.monto)}</span></div></div></div>`,
      )
      .join("");
}

function showTab(t) {
  document
    .querySelectorAll(".section")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById("tab-" + t).classList.add("active");
  if (t === "ventas") {
    renderMesFilter("mes-filter-ventas", "ventas");
    renderVentas();
  }
  if (t === "cuotas") renderCuotasPendientes();
  if (t === "gastos") {
    renderMesFilter("mes-filter-gastos", "gastos");
    renderGastos();
    initFecha("g-fecha");
    fillSuggestionsGasto();
  }
  if (t === "ganancias") {
    renderMesFilter("mes-filter-gan", "ganancias");
    renderGanancias();
    fillComparadores();
    renderMetaBar();
  }
  if (t === "caja") {
    renderMesFilter("mes-filter-caja", "caja");
    renderCaja();
    initFecha("caja-fecha");
  }
  if (t === "catalogo") renderCatalogo();
  if (t === "stock") {
    renderStock();
    fillStockSuggestions();
  }
  if (t === "add") fillSuggestions();
  if (t === "ajustes") renderAjustes();
  updateStats();
}
function renderMesFilter(cId, tab) {
  const meses =
    tab === "gastos"
      ? mesesDeGastos()
      : tab === "caja"
        ? mesesDeCaja()
        : mesesDeVentas();
  const active =
    tab === "ventas"
      ? activeMesVentas
      : tab === "gastos"
        ? activeMesGastos
        : tab === "caja"
          ? activeMesCaja
          : activeMesGan;
  const el = document.getElementById(cId);
  if (!meses.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = [
    `<button class="mes-chip ${active === "todos" ? "active" : ""}" onclick="setMes('todos','${tab}')">Todos</button>`,
    ...meses.map(
      (m) =>
        `<button class="mes-chip ${active === m ? "active" : ""}" onclick="setMes('${m}','${tab}')">${mesLabel(m)}</button>`,
    ),
  ].join("");
}
function setMes(mes, tab) {
  if (tab === "ventas") {
    activeMesVentas = mes;
    renderMesFilter("mes-filter-ventas", "ventas");
    renderVentas();
  } else if (tab === "gastos") {
    activeMesGastos = mes;
    renderMesFilter("mes-filter-gastos", "gastos");
    renderGastos();
  } else if (tab === "caja") {
    activeMesCaja = mes;
    renderMesFilter("mes-filter-caja", "caja");
    renderCaja();
  } else {
    activeMesGan = mes;
    renderMesFilter("mes-filter-gan", "ganancias");
    renderGanancias();
    renderMetaBar();
  }
}
function setFiltroEstado(estado) {
  filtroEstado = estado;
  ["todas", "hoy", "pendiente", "completada"].forEach((e) =>
    document
      .getElementById("fchip-" + e)
      ?.classList.toggle("active", e === estado),
  );
  renderVentas();
}
function updateStats() {
  document.getElementById("st-ventas").textContent = ventas.length;
  document.getElementById("st-ganancia").textContent = fmt(
    ventas.reduce((s, v) => s + (v.ganancia || 0), 0),
  );
  const totalDebe = ventas.reduce((s, v) => s + calcDebe(v), 0);
  document.getElementById("st-debe").textContent = fmt(totalDebe);
  // Indicador de cuotas pendientes
  const cuotasPend = ventas.filter(
    (v) => v.esCuotas && !ventaCompletada(v),
  ).length;
  const subEl = document.getElementById("st-cuotas-pendientes");
  if (subEl) {
    if (cuotasPend > 0) {
      subEl.textContent = cuotasPend + " deuda" + (cuotasPend !== 1 ? "s" : "");
      subEl.style.display = "block";
    } else {
      subEl.style.display = "none";
    }
  }
  renderMetaStrip();
  renderResumenDiario();
}
function eliminarMes(mesK) {
  pendingDeleteMes = mesK;
  const ventasMes = ventas.filter((v) => mesKey(v.fecha) === mesK);
  const ganMes = ventasMes.reduce((s, v) => s + (v.ganancia || 0), 0);
  document.getElementById("del-mes-label").textContent = mesLabel(mesK);
  document.getElementById("del-mes-num").textContent = ventasMes.length;
  document.getElementById("del-mes-gan").textContent = fmt(ganMes);
  document.getElementById("modal-del-mes").classList.add("open");
  // Countdown de 3s antes de habilitar el botón de confirmación
  const btn = document.getElementById("btn-del-mes-confirm");
  const cdEl = document.getElementById("del-mes-countdown");
  if (btn && cdEl) {
    btn.disabled = true;
    btn.style.opacity = ".5";
    btn.style.cursor = "not-allowed";
    let secs = 3;
    cdEl.textContent = secs;
    clearInterval(window._delMesTimer);
    window._delMesTimer = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(window._delMesTimer);
        btn.disabled = false;
        btn.style.opacity = "";
        btn.style.cursor = "";
        cdEl.textContent = "";
      } else cdEl.textContent = secs;
    }, 1000);
  }
}
function confirmarEliminarMes() {
  if (!pendingDeleteMes) return;
  const label = mesLabel(pendingDeleteMes);
  const ventasEliminadas = ventas.filter(
    (v) => mesKey(v.fecha) === pendingDeleteMes,
  );
  ventas = ventas.filter((v) => mesKey(v.fecha) !== pendingDeleteMes);
  if (activeMesVentas === pendingDeleteMes) activeMesVentas = "todos";
  pendingDeleteMes = null;
  save();
  closeModal("modal-del-mes");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      renderMesFilter("mes-filter-ventas", "ventas");
      renderVentas();
      updateStats();
      const tc = document.getElementById("tab-cuotas");
      if (tc && tc.classList.contains("active")) renderCuotasPendientes();
      toastUndo(
        `🗑 ${ventasEliminadas.length} ventas de ${label} eliminadas`,
        () => {
          ventas = [...ventasEliminadas, ...ventas];
          save();
          renderMesFilter("mes-filter-ventas", "ventas");
          renderVentas();
          updateStats();
        },
        8000,
      );
    });
  });
}
function renderVentas() {
  const q = (
    document.getElementById("search-ventas").value || ""
  ).toLowerCase();
  let filtered =
    activeMesVentas === "todos"
      ? ventas
      : ventas.filter((v) => mesKey(v.fecha) === activeMesVentas);
  if (q)
    filtered = filtered.filter((v) =>
      [v.perfume, v.cliente, v.vendedor, v.proveedor].some((x) =>
        (x || "").toLowerCase().includes(q),
      ),
    );
  if (filtroEstado === "hoy")
    filtered = filtered.filter((v) => v.fecha === hoy());
  else if (filtroEstado === "pendiente")
    filtered = filtered.filter((v) => v.esCuotas && !ventaCompletada(v));
  else if (filtroEstado === "completada")
    filtered = filtered.filter((v) => ventaCompletada(v));
  const el = document.getElementById("ventas-list");
  if (!filtered.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">💸</div><p>No hay ventas${q ? " con ese criterio" : activeMesVentas !== "todos" ? " en este mes" : ""} todavía.</p></div>`;
    return;
  }
  const mesMasReciente = mesesDeVentas()[0] || "";
  const porMes = {};
  filtered.forEach((v) => {
    const k = mesKey(v.fecha) || "Sin fecha";
    if (!porMes[k]) porMes[k] = [];
    porMes[k].push(v);
  });
  el.innerHTML = Object.keys(porMes)
    .sort()
    .reverse()
    .map((mes) => {
      const vs = porMes[mes];
      const totGan = vs.reduce((s, v) => s + (v.ganancia || 0), 0);
      const totDebe = vs.reduce((s, v) => s + calcDebe(v), 0);
      const esActual = mes === mesMasReciente;
      return `<div class="mes-sep"><div class="mes-sep-line"></div><div style="display:flex;align-items:center;gap:5px;white-space:nowrap"><div class="mes-sep-label">${mesLabel(mes)}</div>${esActual ? `<span style="background:rgba(112,201,160,0.2);color:var(--success);border:0.5px solid rgba(112,201,160,0.4);border-radius:20px;font-size:9px;padding:1px 6px;font-weight:500">ACTUAL</span>` : ""}</div><div class="mes-sep-line"></div><button onclick="eliminarMes('${mes}')" style="background:none;border:0.5px solid rgba(224,112,112,0.3);color:var(--danger);border-radius:var(--radius-sm);padding:3px 8px;font-size:11px;cursor:pointer;white-space:nowrap;flex-shrink:0">🗑 Mes</button></div><div class="mes-total"><span>${vs.length} venta${vs.length !== 1 ? "s" : ""} · Gan: <strong style="color:var(--success)">${fmt(totGan)}</strong></span>${totDebe > 0 ? `<span style="color:var(--warn)">Debe: ${fmt(totDebe)}</span>` : ""}</div><div class=\"ventas-mes-grid\">${vs.map((v) => renderVentaCard(v)).join("")}</div>`;
    })
    .join("");
}
// Fix XSS: sanitizar todo campo de usuario antes de inyectar en innerHTML
function escapeHTML(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderVentaCard(v) {
  const debe = calcDebe(v);
  const comp = ventaCompletada(v);
  const dias = diasDesdeUltimoPago(v);
  const badges = [];
  if (v.esCuotas) {
    const totalC = v.cuotasTotal || 1,
      pagadas = (v.cuotasPagos || []).length;
    badges.push(
      `<span class="badge badge-cuota">📆 ${pagadas}/${totalC} cuotas</span>`,
    );
    if (!comp) {
      badges.push(`<span class="badge badge-debe">Debe ${fmt(debe)}</span>`);
      if (dias >= 0)
        badges.push(
          `<span class="badge badge-dias ${dias > 14 ? "" : "warn"}">${dias === 0 ? "Hoy" : dias === 1 ? "Ayer" : `Hace ${dias}d`}</span>`,
        );
    } else badges.push(`<span class="badge badge-ok">✅ Pagado</span>`);
  }
  if (v.descuento)
    badges.push(
      `<span class="badge" style="background:rgba(201,168,76,0.1);color:var(--gold);border:0.5px solid var(--border)">%${v.descuento} dto</span>`,
    );
  if (v.vendedor)
    badges.push(
      `<span class="badge" style="background:var(--card2);color:var(--text2);border:0.5px solid var(--border)">${v.vendedor}</span>`,
    );
  let cuotasPanel = "";
  if (v.esCuotas) {
    const pagos = v.cuotasPagos || [],
      totalC = v.cuotasTotal || 2;
    let items = "";
    for (let i = 0; i < totalC; i++) {
      const p = pagos[i];
      if (p) {
        items += `<div class="cuota-item"><div><div class="cuota-num">Cuota ${i + 1}/${totalC}</div><div class="cuota-fecha">${p.fecha}</div></div><div style="text-align:right"><div class="cuota-monto cuota-ok">${fmt(p.monto)}</div><div style="font-size:10px;color:var(--success)">✓ Pagado</div></div></div>`;
      } else {
        const m = Math.ceil(debe / Math.max(1, totalC - pagos.length));
        items += `<div class="cuota-item"><div><div class="cuota-num">Cuota ${i + 1}/${totalC}</div><div class="cuota-fecha cuota-pend">Pendiente</div></div><div style="text-align:right"><div class="cuota-monto cuota-pend">~${fmt(m)}</div><button class="btn-pagar-cuota" onclick="abrirModalCuota(${v.id},${i})">Cobrar</button></div></div>`;
      }
    }
    for (let i = totalC; i < pagos.length; i++) {
      const p = pagos[i];
      items += `<div class="cuota-item"><div><div class="cuota-num">Pago extra</div><div class="cuota-fecha">${p.fecha}</div></div><div class="cuota-monto cuota-ok">${fmt(p.monto)}</div></div>`;
    }
    cuotasPanel = `<div class="cuotas-panel"><div class="cuotas-panel-header" onclick="toggleCuotasPanel(${v.id})"><span>📆 Ver cuotas y pagos</span><span id="caret-${v.id}" style="color:var(--text3);font-size:12px">▼</span></div><div class="cuotas-panel-body" id="cpanel-${v.id}">${items}${!comp ? `<div class="add-cuota-form"><input type="number" id="extra-monto-${v.id}" placeholder="Monto pago extra" inputmode="numeric"><button class="btn-add-cuota" onclick="registrarPagoExtra(${v.id})">+ Pago</button></div>` : ""}</div></div>`;
  }
  // botón WhatsApp cobro
  const waBtn =
    v.esCuotas && !comp
      ? `<button class="btn-wa" onclick="whatsappCobro(${v.id})">📲 WhatsApp cobro</button>`
      : "";
  return `<div class="venta-card ${v.esCuotas ? (comp ? "completada" : "pendiente") : ""}"><div class="vc-header"><div class="vc-name">${v.nVenta ? `<span style="font-size:11px;color:var(--text3)">#${v.nVenta} · </span>` : ""}${escapeHTML(v.perfume)}</div><div class="vc-meta"><div class="vc-date">📅 ${escapeHTML(v.fecha)}</div><div style="display:flex;gap:5px"><button class="btn-icon" onclick="abrirModalPago(${v.id})" title="Cobrar" style="color:#00bb6e;border-color:rgba(0,187,110,.3)">💳</button><button class="btn-icon" onclick="whatsappComprobante(${v.id})" title="Enviar comprobante WA">📲</button><button class="btn-icon" onclick="abrirModalPDF(${v.id})" title="Recibo PDF">🧾</button><button class="btn-icon" onclick="abrirEditarVenta(${v.id})" title="Editar venta" style="color:var(--gold);border-color:rgba(201,168,76,.3)">✏️</button><button class="btn-icon" onclick="openDeleteModal(${v.id})">🗑</button></div></div></div>${badges.length ? `<div class="badges-row">${badges.join("")}</div>` : ""}<div class="vc-body"><div class="vc-row"><span>Precio venta</span><span>${fmt(v.precioVenta)}</span></div><div class="vc-row"><span>Precio compra</span><span>${fmt(v.precioCompra)}</span></div><div class="vc-row"><span>Ganancia</span><span class="${(v.ganancia || 0) >= 0 ? "pos" : "neg"}">${fmt(v.ganancia)}</span></div>${v.esCuotas ? `<div class="vc-row"><span>Total cobrado</span><span class="pos">${fmt((v.cuotasPagos || []).reduce((s, p) => s + p.monto, 0))}</span></div>` : ""}${v.proveedor ? `<div class="vc-row"><span>Proveedor</span><span>${escapeHTML(v.proveedor)}</span></div>` : ""}${v.cliente ? `<div class="vc-row"><span>Cliente</span><span>${escapeHTML(v.cliente)}</span></div>` : ""}</div>${v.nota ? `<div class="vc-nota">💬 ${escapeHTML(v.nota)}</div>` : ""}${cuotasPanel}${waBtn ? `<div style="padding:8px 11px;border-top:0.5px solid var(--border)">${waBtn}</div>` : ""}</div>`;
}
// ── WHATSAPP ──────────────────────────────────────────────────
function whatsappComprobante(id) {
  const v = ventas.find((x) => x.id === id);
  if (!v) return;
  const debe = calcDebe(v);
  const pagado = (v.cuotasPagos || []).reduce((s, p) => s + p.monto, 0);
  const perfil = getProfileName(activeProfile) || "Parfum Track";
  let msg = `🍶 *${perfil}* — Comprobante de venta\n\n`;
  msg += `*Perfume:* ${v.perfume}\n`;
  msg += `*Fecha:* ${v.fecha}\n`;
  msg += `*Precio:* ${fmt(v.precioVenta)}\n`;
  if (v.esCuotas) {
    msg += `*Cuotas:* ${(v.cuotasPagos || []).length}/${v.cuotasTotal}\n`;
    msg += `*Cobrado:* ${fmt(pagado)}\n`;
    if (debe > 0) msg += `*Saldo pendiente:* ${fmt(debe)}\n`;
  }
  if (v.cliente) msg += `\n_Para: ${v.cliente}_`;
  msg += `\n\n_${perfil}_ 🍶`;
  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}
function whatsappCobro(id) {
  const v = ventas.find((x) => x.id === id);
  if (!v) return;
  const debe = calcDebe(v);
  const pagadas = (v.cuotasPagos || []).length;
  const total = v.cuotasTotal || 2;
  const cuotasPend = Math.max(1, total - pagadas);
  const montoCuota = Math.ceil(debe / cuotasPend);
  let msg = `Hola${v.cliente ? " " + v.cliente : ""}! 👋\n\nTe recuerdo que tenés una cuota pendiente de tu perfume *${v.perfume}*:\n\n`;
  msg += `📆 Cuota ${pagadas + 1} de ${total}\n`;
  msg += `💰 Monto: ${fmt(montoCuota)}\n`;
  msg += `📊 Total adeudado: ${fmt(debe)}\n\n`;
  msg += `_${getProfileName(activeProfile) || "Parfum Track"}_ 🍶`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
}
function toggleCuotasPanel(id) {
  const p = document.getElementById("cpanel-" + id);
  const c = document.getElementById("caret-" + id);
  if (!p) return;
  const o = p.classList.toggle("open");
  if (c) c.textContent = o ? "▲" : "▼";
}
function abrirModalCuota(ventaId, numCuota) {
  const v = ventas.find((x) => x.id === ventaId);
  if (!v) return;
  const debe = calcDebe(v);
  const totalC = v.cuotasTotal || 2;
  const pagadas = (v.cuotasPagos || []).length;
  const sug = Math.ceil(debe / Math.max(1, totalC - pagadas));
  document.getElementById("modal-cuota-title").textContent =
    `Cuota ${numCuota + 1} de ${totalC}`;
  document.getElementById("modal-cuota-desc").textContent =
    `${v.perfume} · ${v.cliente || v.vendedor || ""} · Debe: ${fmt(debe)}`;
  document.getElementById("modal-cuota-monto").value = sug;
  document.getElementById("modal-cuota-ok").onclick = () => {
    const m =
      parseFloat(document.getElementById("modal-cuota-monto").value) || 0;
    if (!m) {
      toast("⚠ Ingresá un monto");
      return;
    }
    if (!v.cuotasPagos) v.cuotasPagos = [];
    v.cuotasPagos.push({ monto: m, fecha: hoy(), numCuota });
    save();
    closeModal("modal-cuota");
    const nd = calcDebe(v);
    toast(
      nd <= 0
        ? `✅ Venta completada — ${v.perfume}`
        : `✓ Cobrado ${fmt(m)} · Resta: ${fmt(nd)}`,
      3200,
    );
    updateStats();
    renderVentas();
    renderCuotasPendientes();
  };
  document.getElementById("modal-cuota").classList.add("open");
}
function registrarPagoExtra(id) {
  const v = ventas.find((x) => x.id === id);
  if (!v) return;
  const m =
    parseFloat(document.getElementById("extra-monto-" + id)?.value) || 0;
  if (!m) {
    toast("⚠ Ingresá un monto");
    return;
  }
  if (!v.cuotasPagos) v.cuotasPagos = [];
  v.cuotasPagos.push({
    monto: m,
    fecha: hoy(),
    numCuota: v.cuotasPagos.length,
  });
  save();
  updateStats();
  toast(
    calcDebe(v) <= 0
      ? `✅ ¡Venta completada!`
      : `✓ Pago ${fmt(m)} · Resta: ${fmt(calcDebe(v))}`,
    3000,
  );
  renderVentas();
  renderCuotasPendientes();
}
function cobrarDesdePendientes(id) {
  const v = ventas.find((x) => x.id === id);
  if (!v) return;
  const m =
    parseFloat(document.getElementById("cpend-monto-" + id)?.value) || 0;
  if (!m) {
    toast("⚠ Ingresá un monto");
    return;
  }
  if (!v.cuotasPagos) v.cuotasPagos = [];
  v.cuotasPagos.push({
    monto: m,
    fecha: hoy(),
    numCuota: v.cuotasPagos.length,
  });
  save();
  updateStats();
  toast(
    calcDebe(v) <= 0
      ? `✅ ¡${v.perfume} completado!`
      : `✓ Cobrado ${fmt(m)} · Resta: ${fmt(calcDebe(v))}`,
    3000,
  );
  renderCuotasPendientes();
}
function renderCuotasPendientes() {
  const pend = ventas
    .filter((v) => v.esCuotas && !ventaCompletada(v))
    .sort((a, b) => diasDesdeUltimoPago(b) - diasDesdeUltimoPago(a));
  const el = document.getElementById("cuotas-pendientes-list");
  if (!pend.length) {
    el.innerHTML =
      '<div class="empty"><div class="empty-icon">🎉</div><p>No hay cuotas pendientes.<br>¡Todo al día!</p></div>';
    return;
  }
  const totDebe = pend.reduce((s, v) => s + calcDebe(v), 0);
  el.innerHTML =
    `<div style="background:rgba(224,176,96,0.1);border:0.5px solid rgba(224,176,96,0.3);border-radius:var(--radius-sm);padding:9px 12px;margin-bottom:13px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:13px;color:var(--text2)">${pend.length} venta${pend.length !== 1 ? "s" : ""} con deuda</span><span style="font-size:15px;font-weight:500;color:var(--warn)">${fmt(totDebe)}</span></div>` +
    pend
      .map((v) => {
        const debe = calcDebe(v);
        const pagadas = (v.cuotasPagos || []).length;
        const total = v.cuotasTotal || 2;
        const dias = diasDesdeUltimoPago(v);
        return `<div class="venta-card pendiente"><div class="vc-header"><div class="vc-name">${escapeHTML(v.perfume)}</div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><div class="vc-date">📅 ${escapeHTML(v.fecha)}</div><button class="btn-wa" onclick="whatsappCobro(${v.id})" style="padding:4px 10px;font-size:11px">📲 Recordar</button></div></div><div class="badges-row"><span class="badge badge-cuota">📆 ${pagadas}/${total} cuotas</span><span class="badge badge-debe">Debe ${fmt(debe)}</span>${dias >= 0 ? `<span class="badge badge-dias ${dias > 14 ? "" : "warn"}">${dias === 0 ? "Hoy" : dias === 1 ? "Ayer" : `Sin pago hace ${dias}d`}</span>` : ""}${v.cliente ? `<span class="badge" style="background:var(--card2);color:var(--text2);border:0.5px solid var(--border)">${escapeHTML(v.cliente)}</span>` : ""}</div><div class="vc-body"><div class="vc-row"><span>Total</span><span>${fmt(v.precioVenta)}</span></div><div class="vc-row"><span>Cobrado</span><span class="pos">${fmt((v.cuotasPagos || []).reduce((s, p) => s + p.monto, 0))}</span></div>${v.vendedor ? `<div class="vc-row"><span>Vendedor</span><span>${escapeHTML(v.vendedor)}</span></div>` : ""}</div><div style="padding:9px 11px;border-top:0.5px solid var(--border);display:flex;gap:7px"><input type="number" id="cpend-monto-${v.id}" placeholder="Monto a cobrar" inputmode="numeric" style="flex:1;padding:7px 9px;background:var(--card2);border:0.5px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:13px"><button class="btn-pagar-cuota" style="padding:7px 14px;font-size:13px" onclick="cobrarDesdePendientes(${v.id})">Cobrar</button></div></div>`;
      })
      .join("");
}
// ── ANÁLISIS ──────────────────────────────────────────────────
async function renderChartMeses() {
  if (!(await ensureChart())) {
    return;
  }
  const meses = mesesDeVentas().slice().reverse();
  if (!meses.length) return;
  const canvas = document.getElementById("chart-meses");
  if (!canvas) return;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const textColor = isDark ? "#9e9bbf" : "#5a4e3a";
  const gridColor = isDark ? "rgba(201,168,76,0.1)" : "rgba(160,120,48,0.1)";
  if (chartMeses) chartMeses.destroy();
  chartMeses = new Chart(canvas, {
    type: "bar",
    data: {
      labels: meses.map((m) => mesLabel(m).split(" ")[0]),
      datasets: [
        {
          label: "Ganancia",
          data: meses.map((m) =>
            ventas
              .filter((v) => mesKey(v.fecha) === m)
              .reduce((s, v) => s + (v.ganancia || 0), 0),
          ),
          backgroundColor: "rgba(112,201,160,0.7)",
          borderRadius: 4,
        },
        {
          label: "Gastos",
          data: meses.map((m) =>
            gastos
              .filter((g) => mesKey(g.fecha) === m)
              .reduce((s, g) => s + g.monto, 0),
          ),
          backgroundColor: "rgba(224,112,112,0.6)",
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 11 } },
          grid: { color: gridColor },
        },
        y: {
          ticks: {
            color: textColor,
            font: { size: 11 },
            callback: (v) => "$" + Number(v).toLocaleString("es-AR"),
          },
          grid: { color: gridColor },
        },
      },
    },
  });
}
function renderStatsAvanzadas(filtered) {
  const el = document.getElementById("stats-avanzadas");
  if (!filtered.length) {
    el.innerHTML = "";
    return;
  }
  const ticket =
    filtered.reduce((s, v) => s + (v.precioVenta || 0), 0) / filtered.length;
  const totalVentas = filtered.reduce((s, v) => s + (v.precioVenta || 0), 0);
  const margen =
    totalVentas > 0
      ? (filtered.reduce((s, v) => s + (v.ganancia || 0), 0) / totalVentas) *
        100
      : 0;
  const enCuotas = filtered.filter((v) => v.esCuotas).length;
  const pctCuotas =
    filtered.length > 0 ? ((enCuotas / filtered.length) * 100).toFixed(0) : 0;
  const mejorDia = () => {
    const byD = {};
    filtered.forEach((v) => {
      if (!v.fecha) return;
      const [d, m, a] = v.fecha.split("/");
      const dow = new Date(a, m - 1, d).getDay();
      if (!byD[dow]) byD[dow] = 0;
      byD[dow] += v.ganancia || 0;
    });
    const top = Object.entries(byD).sort(([, a], [, b]) => b - a)[0];
    return top ? DIAS_NOMBRES[parseInt(top[0])] : "-";
  };
  el.innerHTML = [
    { l: "🎫 Ticket promedio", v: fmt(ticket), s: "" },
    { l: "📊 Margen promedio", v: margen.toFixed(1) + "%", s: "" },
    { l: "📆 Ventas en cuotas", v: enCuotas, s: `${pctCuotas}% del total` },
    { l: "📅 Mejor día", v: mejorDia(), s: "" },
  ]
    .map(
      (s) =>
        `<div class="stat-mini"><div class="stat-mini-lbl">${s.l}</div><div class="stat-mini-val">${s.v}</div>${s.s ? `<div class="stat-mini-sub">${s.s}</div>` : ""}</div>`,
    )
    .join("");
}
function renderChartDias(filtered) {
  const el = document.getElementById("chart-dias");
  if (!filtered.length) {
    el.innerHTML = "";
    return;
  }
  const byD = {};
  filtered.forEach((v) => {
    if (!v.fecha) return;
    const [d, m, a] = v.fecha.split("/");
    const dow = new Date(a, m - 1, d).getDay();
    if (!byD[dow]) byD[dow] = { gan: 0, count: 0 };
    byD[dow].gan += v.ganancia || 0;
    byD[dow].count++;
  });
  const maxGan = Math.max(...Object.values(byD).map((x) => x.gan), 1);
  el.innerHTML = DIAS_NOMBRES.map((nombre, i) => {
    const d = byD[i] || { gan: 0, count: 0 };
    const pct = Math.round((d.gan / maxGan) * 100);
    return `<div class="bar-row"><div class="bar-label">${nombre}</div><div class="bar-fill-wrap"><div class="bar-fill" style="width:${pct}%"></div></div><div class="bar-val">${d.count > 0 ? fmt(d.gan) : "-"}</div></div>`;
  }).join("");
}
function fillComparadores() {
  const meses = mesesDeVentas();
  const opts = meses
    .map((m) => `<option value="${m}">${mesLabel(m)}</option>`)
    .join("");
  const no = '<option value="">— elegir mes —</option>';
  document.getElementById("cmp-mes1").innerHTML = no + opts;
  document.getElementById("cmp-mes2").innerHTML = no + opts;
}
function renderComparacion() {
  const m1 = document.getElementById("cmp-mes1").value,
    m2 = document.getElementById("cmp-mes2").value;
  const el = document.getElementById("comparacion-result");
  if (!m1 || !m2 || m1 === m2) {
    el.style.display = "none";
    return;
  }
  function stats(m) {
    const vs = ventas.filter((v) => mesKey(v.fecha) === m);
    const gs = gastos.filter((g) => mesKey(g.fecha) === m);
    return {
      ventas: vs.length,
      gan: vs.reduce((s, v) => s + (v.ganancia || 0), 0),
      gast: gs.reduce((s, g) => s + g.monto, 0),
      debe: vs.reduce((s, v) => s + calcDebe(v), 0),
    };
  }
  const s1 = stats(m1),
    s2 = stats(m2);
  function dif(a, b) {
    const d = a - b;
    return d === 0
      ? ""
      : `<span style="color:${d > 0 ? "var(--success)" : "var(--danger)"}"> ${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}</span>`;
  }
  el.style.display = "block";
  el.innerHTML = `<div class="comparar-row"><div class="cmp-card"><div class="cmp-mes">${mesLabel(m1)}</div><div class="cmp-row"><span>Ventas</span><span>${s1.ventas}</span></div><div class="cmp-row"><span>Ganancia</span><span>${fmt(s1.gan)}</span></div><div class="cmp-row"><span>Gastos</span><span>${fmt(s1.gast)}</span></div><div class="cmp-row"><span>Por cobrar</span><span>${fmt(s1.debe)}</span></div></div><div class="cmp-card"><div class="cmp-mes">${mesLabel(m2)}</div><div class="cmp-row"><span>Ventas</span><span>${s2.ventas} ${dif(s2.ventas, s1.ventas)}</span></div><div class="cmp-row"><span>Ganancia</span><span>${fmt(s2.gan)} ${dif(s2.gan, s1.gan)}</span></div><div class="cmp-row"><span>Gastos</span><span>${fmt(s2.gast)} ${dif(s2.gast, s1.gast)}</span></div><div class="cmp-row"><span>Por cobrar</span><span>${fmt(s2.debe)}</span></div></div></div>`;
}
function renderGanancias() {
  const filtered =
    activeMesGan === "todos"
      ? ventas
      : ventas.filter((v) => mesKey(v.fecha) === activeMesGan);
  const gastFilt =
    activeMesGan === "todos"
      ? gastos
      : gastos.filter((g) => mesKey(g.fecha) === activeMesGan);
  const totGan = filtered.reduce((s, v) => s + (v.ganancia || 0), 0);
  const totGast = gastFilt.reduce((s, g) => s + g.monto, 0);
  const totCob = filtered.reduce(
    (s, v) =>
      s +
      (v.esCuotas
        ? (v.cuotasPagos || []).reduce((a, p) => a + p.monto, 0)
        : v.precioVenta || 0),
    0,
  );
  const totDebe = filtered.reduce((s, v) => s + calcDebe(v), 0);
  document.getElementById("g-totalv").textContent = filtered.length;
  document.getElementById("g-neta").textContent = fmt(totGan);
  document.getElementById("g-neta").className =
    "g-card-val " + (totGan >= 0 ? "green" : "red");
  document.getElementById("g-gastos-periodo").textContent = fmt(totGast);
  document.getElementById("g-real").textContent = fmt(totGan - totGast);
  document.getElementById("g-real").className =
    "g-card-val " + (totGan - totGast >= 0 ? "green" : "red");
  document.getElementById("g-cobrado").textContent = fmt(totCob);
  document.getElementById("g-debe").textContent = fmt(totDebe);
  renderChartMeses();
  renderStatsAvanzadas(filtered);
  renderChartDias(filtered);
  renderStatsMes(filtered, gastFilt);
  renderComprasPeriodo();
  const byP = {};
  filtered.forEach((v) => {
    const k = v.perfume || "?";
    if (!byP[k]) byP[k] = { nombre: k, ventas: 0, gan: 0 };
    byP[k].ventas++;
    byP[k].gan += v.ganancia || 0;
  });
  document.getElementById("gan-list").innerHTML =
    Object.values(byP)
      .sort((a, b) => b.gan - a.gan)
      .map(
        (g, i) =>
          `<div class="venta-card"><div class="vc-header"><div class="vc-name">${i === 0 ? "🥇 " : ""}${g.nombre}</div><div class="vc-date">${g.ventas} venta${g.ventas !== 1 ? "s" : ""}</div></div><div class="vc-body"><div class="vc-row"><span>Ganancia total</span><span class="pos">${fmt(g.gan)}</span></div><div class="vc-row"><span>Promedio</span><span>${fmt(g.gan / g.ventas)}</span></div></div></div>`,
      )
      .join("") ||
    '<div class="empty"><div class="empty-icon">📊</div><p>Sin datos.</p></div>';
  const byV = {};
  filtered.forEach((v) => {
    const k = v.vendedor || "Sin vendedor";
    if (!byV[k]) byV[k] = { nombre: k, ventas: 0, gan: 0 };
    byV[k].ventas++;
    byV[k].gan += v.ganancia || 0;
  });
  document.getElementById("gan-vendedor").innerHTML = Object.values(byV)
    .sort((a, b) => b.gan - a.gan)
    .map(
      (v, i) =>
        `<div class="venta-card"><div class="vc-header"><div class="vc-name">${i === 0 ? "⭐ " : ""}${v.nombre}</div><div class="vc-date">${v.ventas} venta${v.ventas !== 1 ? "s" : ""}</div></div><div class="vc-body"><div class="vc-row"><span>Ganancia</span><span class="pos">${fmt(v.gan)}</span></div></div></div>`,
    )
    .join("");
}
// ── CAJA ──────────────────────────────────────────────────────
function initFecha(id) {
  const el = document.getElementById(id);
  if (el && !el.value) {
    const d = new Date();
    el.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}
function addMovCaja() {
  const tipo = document.getElementById("caja-tipo").value;
  const desc = document.getElementById("caja-desc").value.trim();
  const monto = parseFloat(document.getElementById("caja-monto").value) || 0;
  const fechaRaw = document.getElementById("caja-fecha").value;
  if (!desc) {
    toast("⚠ Agregá una descripción");
    return;
  }
  if (!monto) {
    toast("⚠ Ingresá el monto");
    return;
  }
  if (!fechaRaw) {
    toast("⚠ Seleccioná la fecha");
    return;
  }
  const [aa, mm, dd] = fechaRaw.split("-");
  const fechaTest = new Date(fechaRaw);
  if (isNaN(fechaTest.getTime())) {
    toast("⚠ La fecha ingresada no es válida");
    return;
  }
  caja.unshift({
    id: Date.now(),
    tipo,
    desc,
    monto,
    fecha: `${dd}/${mm}/${aa}`,
  });
  save();
  document.getElementById("caja-desc").value = "";
  document.getElementById("caja-monto").value = "";
  toast(
    `✓ ${tipo === "entrada" ? "Entrada" : "Salida"} de ${fmt(monto)} registrada`,
  );
  renderCaja();
  renderMesFilter("mes-filter-caja", "caja");
}
function delMovCaja(id) {
  const mov = caja.find((m) => m.id === id);
  caja = caja.filter((m) => m.id !== id);
  save();
  renderCaja();
  renderMesFilter("mes-filter-caja", "caja");
  if (mov)
    toastUndo(`🗑 Movimiento eliminado`, () => {
      caja.unshift(mov);
      save();
      renderCaja();
      renderMesFilter("mes-filter-caja", "caja");
    });
}
function renderCaja() {
  const filtered =
    activeMesCaja === "todos"
      ? caja
      : caja.filter((m) => mesKey(m.fecha) === activeMesCaja);
  const saldo = caja.reduce(
    (s, m) => s + (m.tipo === "entrada" ? m.monto : -m.monto),
    0,
  );
  const salEl = document.getElementById("caja-saldo");
  salEl.textContent = fmt(saldo);
  salEl.style.color = saldo >= 0 ? "var(--gold2)" : "var(--danger)";
  const el = document.getElementById("caja-list");
  if (!filtered.length) {
    el.innerHTML =
      '<div class="empty"><div class="empty-icon">🏦</div><p>No hay movimientos registrados.</p></div>';
    return;
  }
  const porMes = {};
  filtered.forEach((m) => {
    const k = mesKey(m.fecha) || "Sin fecha";
    if (!porMes[k]) porMes[k] = [];
    porMes[k].push(m);
  });
  el.innerHTML = Object.keys(porMes)
    .sort()
    .reverse()
    .map((mes) => {
      const ms = porMes[mes];
      const saldoMes = ms.reduce(
        (s, m) => s + (m.tipo === "entrada" ? m.monto : -m.monto),
        0,
      );
      return `<div class="mes-sep"><div class="mes-sep-line"></div><div class="mes-sep-label">${mesLabel(mes)}</div><div class="mes-sep-line"></div></div><div class="mes-total"><span>${ms.length} movimientos</span><span style="color:${saldoMes >= 0 ? "var(--success)" : "var(--danger)"};font-weight:500">${fmt(saldoMes)}</span></div>${ms.map((m) => `<div class="mov-card ${m.tipo}"><div class="mov-info"><div class="mov-desc">${escapeHTML(m.desc)}</div><div class="mov-meta">📅 ${m.fecha}</div></div><div style="display:flex;align-items:center;gap:8px"><div class="mov-monto ${m.tipo}">${m.tipo === "entrada" ? "+" : "-"}${fmt(m.monto)}</div><button onclick="delMovCaja(${m.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px">🗑</button></div></div>`).join("")}`;
    })
    .join("");
}
// ── CATÁLOGO ─────────────────────────────────────────────────
// renderCatalogo — implementación completa al final del HTML (script catálogo)
function verDetalleCatalogo(nombre) {
  const p = perfumes.find((x) => x.nombre === nombre);
  if (!p) return;
  let msg = `🍶 *${p.nombre}*`;
  if (p.ml) msg += ` — ${p.ml}ml`;
  msg += "\n\n";
  if (p.pVenta) msg += `💰 Precio: ${fmt(p.pVenta)}\n`;
  if (p.notas) msg += `📋 ${p.notas}\n`;
  msg += `\n_${getProfileName(activeProfile) || "Parfum Track"}_`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
}
// ── STOCK ─────────────────────────────────────────────────────
function renderStock() {
  const q = (document.getElementById("search-inp").value || "").toLowerCase();
  const f = perfumes.filter((p) => p.nombre.toLowerCase().includes(q));
  const el = document.getElementById("perfume-list");
  if (!f.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🍶</div><p>${perfumes.length ? "Sin resultados" : "No hay perfumes en stock."}</p></div>`;
    return;
  }
  el.innerHTML = f
    .map((p, idx) => {
      const min = p.stockMin || 3;
      const pill =
        p.stock === 0
          ? '<span class="stock-pill pill-out">Sin stock</span>'
          : p.stock <= min
            ? '<span class="stock-pill pill-low">Stock bajo</span>'
            : '<span class="stock-pill pill-ok">En stock</span>';
      const thumb = p.foto
        ? `<img src="${p.foto}" alt="" style="width:100%;height:100%;object-fit:cover">`
        : "🍶";
      const mlB = p.ml
        ? `<span style="font-size:10px;background:var(--gold-dim);color:var(--gold);border:0.5px solid var(--border);border-radius:20px;padding:1px 6px">${p.ml}ml</span>`
        : "";
      return `<div class="perf-card"><div class="card-body"><div class="perf-thumb">${thumb}</div><div class="card-info"><div class="card-name">${escapeHTML(p.nombre)}</div><div style="display:flex;gap:4px;align-items:center;margin-top:2px;flex-wrap:wrap">${mlB}${p.proveedor ? `<span style="font-size:11px;color:var(--text2)">${escapeHTML(p.proveedor)}</span>` : ""}</div><div style="font-size:12px;color:var(--gold);margin-top:2px">${fmt(p.precio)}</div>${p.pVenta ? `<div style="font-size:11px;color:var(--success);margin-top:1px">Venta habitual: ${fmt(p.pVenta)}</div>` : ""} ${p.historialPrecios?.length > 1 ? `<div style="font-size:10px;color:var(--text3);margin-top:1px">Anterior: ${fmt(p.historialPrecios[p.historialPrecios.length - 2].precio)}</div>` : ""}</div><div class="card-right">${pill}<div class="qty-ctrl"><button class="qty-btn" data-action="minus" data-idx="${idx}">−</button><span class="qty-num">${p.stock}</span><button class="qty-btn" data-action="plus" data-idx="${idx}">+</button></div><button data-action="edit" data-idx="${idx}" style="font-size:11px;padding:3px 9px;background:var(--gold-dim);border:0.5px solid var(--gold);color:var(--gold2);border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap">✏ Editar</button><button data-action="del" data-idx="${idx}" style="font-size:11px;padding:3px 9px;background:rgba(224,112,112,0.1);border:0.5px solid rgba(224,112,112,0.3);color:var(--danger);border-radius:var(--radius-sm);cursor:pointer">🗑</button></div></div></div>`;
    })
    .join("");
  document.getElementById("low-alert").classList.toggle(
    "show",
    perfumes.some((p) => p.stock <= (p.stockMin || 3)),
  );
  // event delegation for stock actions
  el.onclick = function (e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    const p = f[idx];
    if (!p) return;
    const action = btn.dataset.action;
    if (action === "minus") {
      p.stock = Math.max(0, (p.stock || 0) - 1);
      save();
      renderStock();
    } else if (action === "plus") {
      p.stock = (p.stock || 0) + 1;
      save();
      renderStock();
    } else if (action === "edit") {
      abrirEditarPerfume(p.nombre);
    } else if (action === "del") {
      eliminarStock(p.nombre);
    }
  };
}
function eliminarStock(nombre) {
  const p = perfumes.find((x) => x.nombre === nombre);
  if (!p) return;
  document.getElementById("del-stock-msg").textContent =
    `¿Eliminar "${p.nombre}" del stock? Esto no afecta las ventas registradas.`;
  document.getElementById("del-stock-btn").onclick = () => {
    perfumes = perfumes.filter((x) => x.nombre !== nombre);
    save();
    closeModal("del-stock-modal");
    renderStock();
    toast("Perfume eliminado del stock");
  };
  document.getElementById("del-stock-modal").classList.add("open");
}
function chgQty(nombre, delta) {
  const p = perfumes.find((x) => x.nombre === nombre);
  if (!p) return;
  p.stock = Math.max(0, (p.stock || 0) + delta);
  save();
  renderStock();
}
// ── EDITAR PERFUME ────────────────────────────────────────────
function abrirEditarPerfume(nombre) {
  const p = perfumes.find((x) => x.nombre === nombre);
  if (!p) return;
  editandoPerfumeNombre = nombre;
  editFotoTemporal = null;
  document.getElementById("edit-nombre").value = p.nombre || "";
  document.getElementById("edit-ml").value = p.ml || "";
  document.getElementById("edit-precio").value = p.precio || "";
  document.getElementById("edit-pventa").value = p.pVenta || "";
  document.getElementById("edit-proveedor").value = p.proveedor || "";
  document.getElementById("edit-stock").value = p.stock || 0;
  document.getElementById("edit-stock-min").value = p.stockMin || 3;
  document.getElementById("edit-notas").value = p.notas || "";
  document.getElementById("edit-foto-url").value = "";
  const prev = document.getElementById("edit-foto-preview");
  const qBtn = document.getElementById("edit-foto-quitar");
  if (p.foto) {
    prev.innerHTML = `<img src="${p.foto}" style="width:100%;height:100%;object-fit:cover">`;
    qBtn.style.display = "block";
  } else {
    prev.innerHTML = "🍶";
    qBtn.style.display = "none";
  }
  document.getElementById("edit-foto-input").value = "";
  document.getElementById("modal-editar").classList.add("open");
}
function previewFotoEdit(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => {
    // Comprimir la imagen antes de guardarla
    const img = new Image();
    img.onload = () => {
      const MAX = 400; // máximo 400px en el lado más largo
      let w = img.width,
        h = img.height;
      if (w > h) {
        if (w > MAX) {
          h = Math.round((h * MAX) / w);
          w = MAX;
        }
      } else {
        if (h > MAX) {
          w = Math.round((w * MAX) / h);
          h = MAX;
        }
      }
      const cvs = document.createElement("canvas");
      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      editFotoTemporal = cvs.toDataURL("image/jpeg", 0.72); // JPEG 72% calidad
      document.getElementById("edit-foto-preview").innerHTML =
        `<img src="${editFotoTemporal}" style="width:100%;height:100%;object-fit:cover">`;
      document.getElementById("edit-foto-quitar").style.display = "block";
      document.getElementById("edit-foto-url").value = "";
      // Mostrar tamaño resultante
      const kb = Math.round((editFotoTemporal.length * 0.75) / 1024);
      toast("📷 Foto optimizada · " + kb + "KB", 2000);
    };
    img.src = ev.target.result;
  };
  r.readAsDataURL(f);
}
function previewFotoUrl(forzar = false) {
  const url = document.getElementById("edit-foto-url").value.trim();
  if (!url) return;
  const img = new Image();
  img.onload = () => {
    editFotoTemporal = url;
    document.getElementById("edit-foto-preview").innerHTML =
      `<img src="${url}" style="width:100%;height:100%;object-fit:cover">`;
    document.getElementById("edit-foto-quitar").style.display = "block";
    if (forzar) toast("✓ Imagen cargada");
  };
  img.onerror = () => {
    if (forzar) toast("⚠ No se pudo cargar esa URL");
  };
  img.src = url;
}
function buscarEnPinterest() {
  const nombre =
    document.getElementById("edit-nombre").value.trim() ||
    editandoPerfumeNombre ||
    "perfume";
  window.open(
    `https://pinterest.com/search/pins/?q=${encodeURIComponent(nombre + " perfume")}`,
    "_blank",
  );
  toast(
    "💡 Encontrá la imagen → mantené presionada → Copiar enlace → pegalo en la app",
    5000,
  );
}
function quitarFotoEdit() {
  editFotoTemporal = "__quitar__";
  document.getElementById("edit-foto-preview").innerHTML = "🍶";
  document.getElementById("edit-foto-quitar").style.display = "none";
  document.getElementById("edit-foto-url").value = "";
}
function guardarEdicionPerfume() {
  if (!editandoPerfumeNombre) return;
  const p = perfumes.find((x) => x.nombre === editandoPerfumeNombre);
  if (!p) return;
  const nuevoNombre = document.getElementById("edit-nombre").value.trim();
  if (!nuevoNombre) {
    toast("⚠ El nombre no puede estar vacío");
    return;
  }
  if (nuevoNombre !== p.nombre) {
    ventas.forEach((v) => {
      if (v.perfume === p.nombre) v.perfume = nuevoNombre;
    });
    gastos.forEach((g) => {
      if (g.perfumesEnvio)
        g.perfumesEnvio = g.perfumesEnvio.map((n) =>
          n === p.nombre ? nuevoNombre : n,
        );
    });
  }
  const nuevoPrecio =
    parseFloat(document.getElementById("edit-precio").value) || p.precio || 0;
  if (nuevoPrecio !== p.precio) {
    if (!p.historialPrecios) p.historialPrecios = [];
    p.historialPrecios.push({ precio: nuevoPrecio, fecha: hoy() });
  }
  p.nombre = nuevoNombre;
  p.ml = parseInt(document.getElementById("edit-ml").value) || 0;
  p.precio = nuevoPrecio;
  p.pVenta = parseFloat(document.getElementById("edit-pventa").value) || 0;
  p.proveedor = document.getElementById("edit-proveedor").value.trim();
  p.stock = parseInt(document.getElementById("edit-stock").value) || 0;
  p.stockMin = parseInt(document.getElementById("edit-stock-min").value) || 3;
  p.notas = document.getElementById("edit-notas").value.trim();
  if (editFotoTemporal === "__quitar__") p.foto = null;
  else if (editFotoTemporal) p.foto = editFotoTemporal;
  else {
    const u = document.getElementById("edit-foto-url").value.trim();
    if (u) p.foto = u;
  }
  editandoPerfumeNombre = null;
  editFotoTemporal = null;
  save();
  closeModal("modal-editar");
  renderStock();
  renderCatalogo();
  toast(`✓ "${p.nombre}" actualizado`);
}
// ── GASTOS ────────────────────────────────────────────────────
function toggleGastoCat() {
  const cat = document.getElementById("g-categoria").value;
  document.getElementById("g-envio-compra-extra").style.display =
    cat === "envio_compra" ? "block" : "none";
  document.getElementById("g-otro-extra").style.display =
    cat === "otro" ? "block" : "none";
  if (cat === "envio_compra") {
    perfumesEnvioTemp = [];
    renderPerfumesEnvio();
  }
}
function fillSuggestionsGasto() {
  const n = [...new Set(ventas.map((v) => v.perfume).filter(Boolean))];
  document.getElementById("sug-perfume-gasto").innerHTML = n
    .map((x) => `<option value="${x}">`)
    .join("");
}
function agregarPerfumeEnvio() {
  const inp = document.getElementById("g-perfume-envio-input");
  const n = inp.value.trim();
  if (!n) return;
  if (!perfumesEnvioTemp.includes(n)) perfumesEnvioTemp.push(n);
  inp.value = "";
  renderPerfumesEnvio();
}
function quitarPerfumeEnvio(n) {
  perfumesEnvioTemp = perfumesEnvioTemp.filter((x) => x !== n);
  renderPerfumesEnvio();
}
function renderPerfumesEnvio() {
  const el = document.getElementById("g-perfumes-envio-list");
  el.innerHTML = perfumesEnvioTemp.length
    ? perfumesEnvioTemp
        .map(
          (n) =>
            `<span class="perfume-envio-tag">${escapeHTML(n)}<button onclick="quitarPerfumeEnvio('${n.replace(/'/g, "\\'")}')">×</button></span>`,
        )
        .join("")
    : '<div style="font-size:11px;color:var(--text3);padding:3px 0">Ningún perfume agregado aún</div>';
}
function addGasto() {
  const cat = document.getElementById("g-categoria").value;
  const monto = parseFloat(document.getElementById("g-monto").value) || 0;
  const fechaRaw = document.getElementById("g-fecha").value;
  const desc = document.getElementById("g-descripcion").value.trim();
  const otroNombre =
    cat === "otro" ? document.getElementById("g-otro-nombre").value.trim() : "";
  if (!monto) {
    toast("⚠ Ingresá el monto");
    return;
  }
  if (!fechaRaw) {
    toast("⚠ Seleccioná la fecha");
    return;
  }
  if (cat === "otro" && !otroNombre) {
    toast("⚠ Poné un nombre para el gasto");
    return;
  }
  const [aa, mm, dd] = fechaRaw.split("-");
  gastos.unshift({
    id: Date.now(),
    categoria: cat,
    nombreOtro: otroNombre,
    monto,
    fecha: `${dd}/${mm}/${aa}`,
    descripcion: desc,
    perfumesEnvio: cat === "envio_compra" ? [...perfumesEnvioTemp] : [],
  });
  perfumesEnvioTemp = [];
  save();
  updateStats();
  document.getElementById("g-monto").value = "";
  document.getElementById("g-descripcion").value = "";
  document.getElementById("g-otro-nombre").value = "";
  document.getElementById("g-categoria").value = "envio_compra";
  document.getElementById("g-envio-compra-extra").style.display = "none";
  document.getElementById("g-otro-extra").style.display = "none";
  renderPerfumesEnvio();
  toggleGastoCat();
  toast(
    `✓ Gasto "${otroNombre || CAT_LABELS[cat]}" ${fmt(monto)} registrado`,
    2800,
  );
  renderGastos();
}
function deleteGasto(id) {
  gastos = gastos.filter((g) => g.id !== id);
  save();
  updateStats();
  renderGastos();
  renderMesFilter("mes-filter-gastos", "gastos");
}
function renderGastos() {
  const filtered =
    activeMesGastos === "todos"
      ? gastos
      : gastos.filter((g) => mesKey(g.fecha) === activeMesGastos);
  const mesCur = mesKey(hoy());
  document.getElementById("gs-total").textContent = fmt(
    gastos.reduce((s, g) => s + g.monto, 0),
  );
  document.getElementById("gs-mes").textContent = fmt(
    gastos
      .filter((g) => mesKey(g.fecha) === mesCur)
      .reduce((s, g) => s + g.monto, 0),
  );
  const el = document.getElementById("gastos-list");
  if (!filtered.length) {
    el.innerHTML =
      '<div class="empty"><div class="empty-icon">💸</div><p>No hay gastos registrados.</p></div>';
    return;
  }
  const porCat = {};
  filtered.forEach((g) => {
    if (!porCat[g.categoria]) porCat[g.categoria] = 0;
    porCat[g.categoria] += g.monto;
  });
  const totFilt = filtered.reduce((s, g) => s + g.monto, 0);
  let html = `<div class="gastos-resumen-cat"><div style="font-size:11px;color:var(--gold);margin-bottom:5px">RESUMEN · ${fmt(totFilt)}</div>`;
  Object.entries(porCat)
    .sort(([, a], [, b]) => b - a)
    .forEach(([cat, tot]) => {
      const pct = totFilt > 0 ? Math.round((tot / totFilt) * 100) : 0;
      html += `<div class="gastos-resumen-cat-row"><span>${CAT_LABELS[cat] || cat}</span><span>${fmt(tot)} <span style="color:var(--text3);font-weight:400">(${pct}%)</span></span></div>`;
    });
  html += "</div>";
  const porMes = {};
  filtered.forEach((g) => {
    const k = mesKey(g.fecha) || "Sin fecha";
    if (!porMes[k]) porMes[k] = [];
    porMes[k].push(g);
  });
  Object.keys(porMes)
    .sort()
    .reverse()
    .forEach((mes) => {
      const gs = porMes[mes];
      html += `<div class="mes-sep"><div class="mes-sep-line"></div><div class="mes-sep-label">${mesLabel(mes)}</div><div class="mes-sep-line"></div></div><div class="mes-total"><span>${gs.length} gasto${gs.length !== 1 ? "s" : ""}</span><span style="color:var(--danger);font-weight:500">${fmt(gs.reduce((s, g) => s + g.monto, 0))}</span></div>`;
      gs.forEach((g) => {
        const titulo =
          g.categoria === "otro" && g.nombreOtro
            ? `📋 ${g.nombreOtro}`
            : CAT_LABELS[g.categoria] || g.categoria;
        const cxp =
          g.categoria === "envio_compra" && g.perfumesEnvio?.length > 0
            ? `<div class="gc-row"><span>Costo por perfume</span><span>${fmt(g.monto / g.perfumesEnvio.length)}</span></div>`
            : "";
        const perf = g.perfumesEnvio?.length
          ? `<div class="gc-row"><span>Perfumes</span><span style="text-align:right;max-width:55%">${g.perfumesEnvio.join(", ")}</span></div>`
          : "";
        html += `<div class="gasto-card ${g.categoria}"><div class="gc-header"><div><div class="gc-cat">${titulo}</div>${g.descripcion ? `<div style="font-size:11px;color:var(--text2);margin-top:1px">${g.descripcion}</div>` : ""}</div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px"><div class="gc-monto">${fmt(g.monto)}</div><div style="font-size:11px;color:var(--text2)">📅 ${g.fecha}</div><button onclick="deleteGasto(${g.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px">🗑</button></div></div>${cxp || perf ? `<div class="gc-body">${cxp}${perf}</div>` : ""}</div>`;
      });
    });
  el.innerHTML = html;
}
// ── NUEVA VENTA ───────────────────────────────────────────────
function onPerfumeInput() {
  const nombre = document.getElementById("f-perfume").value.trim();
  const p = perfumes.find(
    (x) => x.nombre.toLowerCase() === nombre.toLowerCase(),
  );
  const el = document.getElementById("precio-sugerido");
  if (p && p.pVenta) {
    el.textContent = `💡 Precio habitual: ${fmt(p.pVenta)}`;
    el.style.display = "block";
    if (!document.getElementById("f-pventa").value)
      document.getElementById("f-pventa").value = p.pVenta;
  } else {
    el.style.display = "none";
  }
  if (p && p.precio && !document.getElementById("f-pcompra").value)
    document.getElementById("f-pcompra").value = p.precio;
  calcGananciaPreview();
}
function calcGananciaPreview() {
  const pv = parseFloat(document.getElementById("f-pventa").value) || 0;
  const pc = parseFloat(document.getElementById("f-pcompra").value) || 0;
  const dto = parseFloat(document.getElementById("f-descuento").value) || 0;
  const el = document.getElementById("ganancia-preview");
  if (!pv) {
    el.textContent = "";
    return;
  }
  const pvFinal = pv * (1 - dto / 100);
  const gan = pvFinal - pc;
  const prefix = gan < 0 ? "⚠ Vendés a pérdida · " : "";
  el.textContent = `${prefix}Ganancia: ${fmt(gan)}${dto > 0 ? ` (venta: ${fmt(pvFinal)})` : ""}`;
  el.style.color = gan >= 0 ? "var(--success)" : "var(--danger)";
}
function calcEditGananciaPreview() {
  const pv = parseFloat(document.getElementById("ev-pventa").value) || 0;
  const pc = parseFloat(document.getElementById("ev-pcompra").value) || 0;
  const el = document.getElementById("ev-preview");
  if (!pv) {
    el.textContent = "";
    return;
  }
  const gan = pv - pc;
  const prefix = gan < 0 ? "⚠ Vendés a pérdida · " : "";
  el.textContent = `${prefix}Ganancia: ${fmt(gan)}`;
  el.style.color = gan >= 0 ? "var(--success)" : "var(--danger)";
}
function toggleCuotasForm() {
  const t = document.getElementById("f-tipo-cuota").value;
  document.getElementById("cuotas-form-extra").style.display =
    t === "cuotas" ? "block" : "none";
  recalcCuotas();
}
function recalcCuotas() {
  const pv = parseFloat(document.getElementById("f-pventa").value) || 0;
  const dto = parseFloat(document.getElementById("f-descuento").value) || 0;
  const pvFinal = pv * (1 - dto / 100);
  const n = parseInt(document.getElementById("f-num-cuotas").value) || 2;
  const primera =
    parseFloat(document.getElementById("f-primera-cuota").value) || 0;
  if (!pvFinal || !n) {
    document.getElementById("cuotas-preview").innerHTML = "";
    return;
  }
  const rpc =
    primera && n > 1
      ? Math.ceil((pvFinal - primera) / (n - 1))
      : Math.ceil(pvFinal / n);
  let h = `<strong style="color:var(--gold2)">Plan de cuotas</strong><br>`;
  for (let i = 0; i < n; i++) {
    const m = i === 0 && primera ? primera : rpc;
    h += `Cuota ${i + 1}: <strong>${fmt(m)}</strong>${i === 0 ? " (hoy)" : ""}<br>`;
  }
  h += `Total: <strong>${fmt(pvFinal)}</strong>`;
  document.getElementById("cuotas-preview").innerHTML = h;
}
function fillSuggestions() {
  const fields = {
    perfume: "perfume",
    proveedor: "proveedor",
    vendedor: "vendedor",
    cliente: "cliente",
  };
  Object.entries(fields).forEach(([id, key]) => {
    const vals = [...new Set(ventas.map((v) => v[key]).filter(Boolean))];
    document.getElementById("sug-" + id).innerHTML = vals
      .map((n) => `<option value="${n}">`)
      .join("");
  });
}
function addVenta() {
  // ── TRIAL LIMIT CHECK ──
  if (window._trialLimitado && !isActivated()) {
    const restantes = getTrialVentasRestantes();
    if (restantes <= 0) {
      abrirModalActivacion();
      toast(
        "🔒 Límite alcanzado. Activá tu licencia para seguir registrando ventas.",
      );
      return;
    }
  }
  const perfume = document.getElementById("f-perfume").value.trim();
  const pv = parseFloat(document.getElementById("f-pventa").value) || 0;
  const pc = parseFloat(document.getElementById("f-pcompra").value) || 0;
  const dto = parseFloat(document.getElementById("f-descuento").value) || 0;
  const tipo = document.getElementById("f-tipo-cuota").value;
  const proveedor = document.getElementById("f-proveedor").value.trim();
  const vendedor = document.getElementById("f-vendedor").value.trim();
  const cliente = document.getElementById("f-cliente").value.trim();
  const nota = document.getElementById("f-nota").value.trim();
  if (!perfume) {
    toast("⚠ Ingresá el nombre del perfume");
    return;
  }
  if (!pv || pv <= 0) {
    toast("⚠ Ingresá un precio de venta válido (mayor a 0)");
    return;
  }
  if (pc < 0) {
    toast("⚠ El precio de compra no puede ser negativo");
    return;
  }
  if (pv > 10000000) {
    toast("⚠ El precio parece muy alto. Verificá los datos");
    return;
  }
  // Fix: validar rango de descuento
  if (dto < 0 || dto > 100) {
    toast("⚠ El descuento debe estar entre 0 y 100%");
    return;
  }
  // Fix: advertencia no bloqueante si precio de compra es $0
  if (pc === 0) {
    toast(
      "💡 El precio de compra es $0 — la ganancia podría estar inflada",
      3500,
    );
  }
  const pvFinal = dto > 0 ? pv * (1 - dto / 100) : pv;
  // Advertir si ganancia negativa (precio compra mayor al precio final de venta)
  if (pc > pvFinal) {
    toast(
      "⚠ El precio de compra es mayor al precio de venta. La ganancia será negativa.",
      4000,
    );
  }
  const fecha = hoy();
  const mesFecha = mesKey(fecha);
  const esMesNuevo = !mesesDeVentas().includes(mesFecha);
  const nVenta = ventas.filter((v) => mesKey(v.fecha) === mesFecha).length + 1;
  const esCuotas = tipo === "cuotas";
  let cuotasTotal = 1,
    primeraCuota = 0,
    cuotasPagos = [];
  if (esCuotas) {
    cuotasTotal = parseInt(document.getElementById("f-num-cuotas").value) || 2;
    primeraCuota =
      parseFloat(document.getElementById("f-primera-cuota").value) || 0;
    if (primeraCuota > 0)
      cuotasPagos = [{ monto: primeraCuota, fecha, numCuota: 0 }];
  } else cuotasPagos = [{ monto: pvFinal, fecha, numCuota: 0 }];
  const _btnGuardar = document.getElementById("btn-guardar-venta");
  if (_btnGuardar) {
    _btnGuardar.disabled = true;
    _btnGuardar.textContent = "Guardando...";
  }
  ventas.unshift({
    id: Date.now(),
    createdAt: Date.now(),
    nVenta,
    perfume,
    precioVenta: pvFinal,
    precioCompra: pc,
    ganancia: pvFinal - pc,
    descuento: dto || 0,
    esCuotas,
    cuotasTotal,
    primeraCuota,
    cuotasPagos,
    proveedor,
    vendedor,
    cliente,
    nota,
    fecha,
  });
  let sp = perfumes.find(
    (p) => p.nombre.toLowerCase() === perfume.toLowerCase(),
  );
  if (!sp) {
    sp = {
      nombre: perfume,
      precio: pc,
      stock: 0,
      proveedor,
      foto: null,
      historialPrecios: [{ precio: pc, fecha }],
    };
    perfumes.push(sp);
  }
  if (sp.stock > 0) sp.stock--;
  save();
  updateStats();
  [
    "f-perfume",
    "f-pventa",
    "f-pcompra",
    "f-descuento",
    "f-proveedor",
    "f-vendedor",
    "f-cliente",
    "f-nota",
  ].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("f-tipo-cuota").value = "contado";
  document.getElementById("cuotas-form-extra").style.display = "none";
  document.getElementById("cuotas-preview").innerHTML = "";
  document.getElementById("precio-sugerido").style.display = "none";
  document.getElementById("ganancia-preview").textContent = "";
  const debe = calcDebe(ventas[0]);
  toast(
    (esCuotas
      ? `✓ Venta en ${cuotasTotal} cuotas${primeraCuota ? " · 1ra cobrada" : ""}${debe > 0 ? " · Resta: " + fmt(debe) : ""}`
      : ` ✓ Venta registrada · Ganancia: ${fmt(pvFinal - pc)}`) +
      (dto > 0 ? ` · Descuento: ${dto}%` : "") +
      (esMesNuevo ? `\n📅 Nueva sección ${mesLabel(mesFecha)} creada` : ""),
    3200,
  );
  if (esMesNuevo) activeMesVentas = mesFecha;
  // Rehabilitar botón guardar
  const _bg = document.getElementById("btn-guardar-venta");
  if (_bg) {
    _bg.disabled = false;
    _bg.textContent = "Guardar venta";
  }
  // Aviso si queda poco margen de trial limitado
  if (window._trialLimitado && !isActivated()) {
    const r = getTrialVentasRestantes();
    if (r === 1)
      setTimeout(
        () =>
          toast(
            "⚠ Esta fue tu penúltima venta en modo limitado. Activá la licencia para seguir.",
            4000,
          ),
        3400,
      );
    else if (r === 0)
      setTimeout(() => {
        mostrarBannerTrialVencido(0);
      }, 3400);
  }
}
function renderMetaBar() {
  const el = document.getElementById("meta-bar-fill");
  const lbl = document.getElementById("meta-label");
  const pct = document.getElementById("meta-progress-lbl");
  if (!el) return;
  const mes = new Date()
    .toLocaleDateString("es-AR", { month: "2-digit", year: "numeric" })
    .replace("/", "//");
  const mesK = mesKey(hoy());
  const ganMes = ventas
    .filter((v) => mesKey(v.fecha) === mesK)
    .reduce((s, v) => s + (v.ganancia || 0), 0);
  if (!metaMensual) {
    el.style.width = "0%";
    if (lbl) lbl.textContent = "Sin meta";
    if (pct) pct.textContent = "";
    return;
  }
  const p = Math.min(100, Math.round((ganMes / metaMensual) * 100));
  el.style.width = p + "%";
  el.style.background =
    p >= 100 ? "var(--success)" : p >= 60 ? "var(--gold)" : "var(--warn)";
  if (lbl) lbl.textContent = `Meta: ${fmt(ganMes)} / ${fmt(metaMensual)}`;
  if (pct)
    pct.textContent =
      p >= 100
        ? `✓ Meta alcanzada`
        : `${p}% · Faltan ${fmt(metaMensual - ganMes)}`;
}

function renderMetaStrip() {
  const el = document.getElementById("meta-strip");
  if (!el) return;
  const mesK = mesKey(hoy());
  const filtered = ventas.filter((v) => mesKey(v.fecha) === mesK);
  if (!filtered.length) {
    el.innerHTML = "";
    return;
  }
  const totGan = filtered.reduce((s, v) => s + (v.ganancia || 0), 0);
  const byVend = {};
  filtered.forEach((v) => {
    if (v.vendedor) {
      byVend[v.vendedor] = (byVend[v.vendedor] || 0) + (v.ganancia || 0);
    }
  });
  const top = Object.entries(byVend)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const ticketProm = filtered.length ? Math.round(totGan / filtered.length) : 0;
  el.innerHTML =
    `<div class="meta-item"><div class="meta-item-lbl">⭐ Mejor vendedor</div><div class="meta-item-val">${top.length ? top[0][0] + " " + fmt(top[0][1]) : "—"}</div></div>` +
    `<div class="meta-item"><div class="meta-item-lbl">🎫 Ticket promedio</div><div class="meta-item-val">${fmt(ticketProm)}</div></div>` +
    `<div class="meta-item"><div class="meta-item-lbl">📦 Ventas hoy</div><div class="meta-item-val">${ventas.filter((v) => v.fecha === hoy()).length}</div></div>`;
}

function renderResumenDiario() {
  const el = document.getElementById("daily-banner");
  if (!el) return;
  const h = hoy();
  const hoy_ventas = ventas.filter((v) => v.fecha === h);
  const ganHoy = hoy_ventas.reduce((s, v) => s + (v.ganancia || 0), 0);
  const mesK = mesKey(h);
  const ganMes = ventas
    .filter((v) => mesKey(v.fecha) === mesK)
    .reduce((s, v) => s + (v.ganancia || 0), 0);
  el.innerHTML = `<span>Hoy: <strong>${fmt(ganHoy)}</strong> · ${hoy_ventas.length} venta${hoy_ventas.length !== 1 ? "s" : ""}</span><span>Mes: <strong>${fmt(ganMes)}</strong></span>`;
  el.classList.add("show");
}
function toggleAgregarStock() {
  const panel = document.getElementById("agregar-stock-panel");
  const btn = document.getElementById("btn-agregar-stock");
  const isOpen = panel.style.display === "block";
  panel.style.display = isOpen ? "none" : "block";
  btn.textContent = isOpen ? "+ Agregar" : "× Cerrar";
  if (!isOpen) {
    document.getElementById("as-perfume").focus();
    fillStockSuggestions();
  }
}
function agregarStockYCerrar() {
  agregarStock();
  // Close panel after adding
  const panel = document.getElementById("agregar-stock-panel");
  const btn = document.getElementById("btn-agregar-stock");
  panel.style.display = "none";
  btn.textContent = "+ Agregar";
}
function toggleStockOpciones() {
  const el = document.getElementById("stock-opciones");
  el.style.display = el.style.display === "none" ? "block" : "none";
}

function abrirModalMeta() {
  document.getElementById("meta-input").value = metaMensual || "";
  document.getElementById("modal-meta").classList.add("open");
}

function guardarMeta() {
  const v = parseFloat(document.getElementById("meta-input").value) || 0;
  metaMensual = v;
  PTDB.set(profileKey("vip_meta_v1"), v);
  closeModal("modal-meta");
  renderMetaBar();
  toast(v > 0 ? `Meta: ${fmt(v)} para este mes` : "Meta eliminada");
}

function calcTotalStock() {
  const cant = parseInt(document.getElementById("as-cantidad").value) || 1;
  const precio = parseFloat(document.getElementById("as-precio").value) || 0;
  const total = cant * precio;
  const el = document.getElementById("as-total-preview");
  if (total > 0) {
    el.textContent = `💸 Total a descontar de Caja: ${fmt(total)} (${cant} x ${fmt(precio)})`;
    el.style.display = "block";
  } else el.style.display = "none";
}

function fillStockSuggestions() {
  const nombres = [...new Set(perfumes.map((p) => p.nombre))];
  document.getElementById("sug-as-perfume").innerHTML = nombres
    .map((n) => `<option value="${n}">`)
    .join("");
  const provs = [
    ...new Set(
      [
        ...ventas.map((v) => v.proveedor),
        ...perfumes.map((p) => p.proveedor),
      ].filter(Boolean),
    ),
  ];
  document.getElementById("sug-as-proveedor").innerHTML = provs
    .map((p) => `<option value="${p}">`)
    .join("");
  // Si hay un perfume ya en stock, autocompletar precio
  document.getElementById("as-perfume").oninput = function () {
    const p = perfumes.find(
      (x) => x.nombre.toLowerCase() === this.value.toLowerCase(),
    );
    if (p) {
      if (p.precio && !document.getElementById("as-precio").value)
        document.getElementById("as-precio").value = p.precio;
      if (p.pVenta && !document.getElementById("as-pventa").value)
        document.getElementById("as-pventa").value = p.pVenta;
      if (p.proveedor && !document.getElementById("as-proveedor").value)
        document.getElementById("as-proveedor").value = p.proveedor;
      calcTotalStock();
    }
  };
}

function agregarStock() {
  const nombre = document.getElementById("as-perfume").value.trim();
  const cantidad = parseInt(document.getElementById("as-cantidad").value) || 1;
  const precio = parseFloat(document.getElementById("as-precio").value) || 0;
  const proveedor = document.getElementById("as-proveedor").value.trim();
  const pventa = parseFloat(document.getElementById("as-pventa").value) || 0;
  if (!nombre) {
    toast("⚠ Ingresá el nombre del perfume");
    return;
  }
  if (!precio) {
    toast("⚠ Ingresá el precio de compra");
    return;
  }
  const total = cantidad * precio;
  // Actualizar o crear perfume en stock
  let p = perfumes.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
  if (!p) {
    p = {
      nombre,
      precio,
      pVenta: pventa,
      stock: 0,
      proveedor,
      foto: null,
      stockMin: 3,
      historialPrecios: [{ precio, fecha: hoy() }],
    };
    perfumes.push(p);
  } else {
    if (precio !== p.precio) {
      if (!p.historialPrecios) p.historialPrecios = [];
      p.historialPrecios.push({ precio, fecha: hoy() });
    }
    p.precio = precio;
    if (pventa) p.pVenta = pventa;
    if (proveedor) p.proveedor = proveedor;
    p.stock = (p.stock || 0) + cantidad;
  }
  if (!p.stock && p.stock !== 0) p.stock = cantidad; // solo si es nuevo sin stock inicializado
  // Registrar salida en Caja con referencia al stock
  caja.unshift({
    id: Date.now(),
    tipo: "salida",
    desc: `📦 Compra stock: ${cantidad}x ${nombre} (${fmt(precio)} c/u)`,
    monto: total,
    fecha: hoy(),
    esCompraStock: true,
    stockNombre: nombre,
    stockCantidad: cantidad,
  });
  save();
  updateStats();
  // Limpiar form
  ["as-perfume", "as-precio", "as-pventa", "as-proveedor"].forEach(
    (id) => (document.getElementById(id).value = ""),
  );
  document.getElementById("as-cantidad").value = "1";
  document.getElementById("as-total-preview").style.display = "none";
  toast(
    `✓ ${cantidad}x "${nombre}" agregado al stock · ${fmt(total)} descontado de Caja`,
    3200,
  );
  showTab("stock");
}

// ── EDITAR VENTA ──
let _editVentaId = null;

function abrirEditarVenta(id) {
  const v = ventas.find((x) => x.id === id);
  if (!v) return;
  _editVentaId = id;
  document.getElementById("ev-perfume").value = v.perfume || "";
  document.getElementById("ev-pventa").value = v.precioVenta || "";
  document.getElementById("ev-pcompra").value = v.precioCompra || "";
  document.getElementById("ev-cliente").value = v.cliente || "";
  document.getElementById("ev-nota").value = v.nota || "";
  actualizarPreviewEditar();
  // Wire live preview
  ["ev-pventa", "ev-pcompra"].forEach((id) => {
    document.getElementById(id).oninput = actualizarPreviewEditar;
  });
  document.getElementById("modal-editar-venta").classList.add("open");
}

function actualizarPreviewEditar() {
  const pv = parseFloat(document.getElementById("ev-pventa").value) || 0;
  const pc = parseFloat(document.getElementById("ev-pcompra").value) || 0;
  const gan = pv - pc;
  const el = document.getElementById("ev-preview");
  if (!el) return;
  if (pv > 0) {
    el.textContent = "Ganancia: " + fmt(gan) + (gan < 0 ? " ⚠ negativa" : "");
    el.style.color = gan < 0 ? "var(--danger)" : "var(--success)";
  } else {
    el.textContent = "";
  }
}

function guardarEditarVenta() {
  const v = ventas.find((x) => x.id === _editVentaId);
  if (!v) return;
  const perfume = document.getElementById("ev-perfume").value.trim();
  const pv = parseFloat(document.getElementById("ev-pventa").value) || 0;
  const pc = parseFloat(document.getElementById("ev-pcompra").value) || 0;
  const cliente = document.getElementById("ev-cliente").value.trim();
  const nota = document.getElementById("ev-nota").value.trim();
  if (!perfume) {
    toast("⚠ Ingresá el nombre del perfume");
    return;
  }
  if (!pv || pv <= 0) {
    toast("⚠ Ingresá un precio de venta válido");
    return;
  }
  if (pc < 0) {
    toast("⚠ El precio de compra no puede ser negativo");
    return;
  }
  if (pv > 10000000) {
    toast("⚠ El precio parece muy alto");
    return;
  }
  // Validar que el nuevo precio no sea menor a lo ya cobrado en cuotas
  if (v.esCuotas) {
    const totalPagado = (v.cuotasPagos || []).reduce((s, p) => s + p.monto, 0);
    if (pv < totalPagado) {
      toast(
        `⚠ El nuevo precio (${fmt(pv)}) es menor a lo ya cobrado (${fmt(totalPagado)}). Ajustá el precio o los pagos primero.`,
        4000,
      );
      return;
    }
  }
  v.perfume = perfume;
  v.precioVenta = pv;
  v.precioCompra = pc;
  const dto = v.descuento || 0;
  const pvFinal = pv * (1 - dto / 100);
  v.ganancia = pvFinal - pc;
  v.cliente = cliente;
  v.nota = nota;
  // Si es cuotas y cambió el precio, recalcular cuotas pendientes proporcionalmente
  if (v.esCuotas) {
    const pagado = (v.cuotasPagos || []).reduce((s, p) => s + p.monto, 0);
    const resto = Math.max(0, pv - pagado);
    const pagadasCount = (v.cuotasPagos || []).length;
    const pendientes = Math.max(1, (v.cuotasTotal || 2) - pagadasCount);
    v._montoCuotaPendiente = Math.ceil(resto / pendientes);
  }
  // Actualizar cuotasPagos al contado si no es cuotas
  if (!v.esCuotas) {
    v.cuotasPagos = [{ monto: pv, fecha: v.fecha, numCuota: 0 }];
  }
  save();
  updateStats();
  renderVentas();
  closeModal("modal-editar-venta");
  toast("✅ Venta actualizada");
}

function openDeleteModal(id) {
  const v = ventas.find((x) => x.id === id);
  if (!v) return;
  pendingDeleteId = id;
  const pc = v.precioCompra || 0;
  document.getElementById("del-modal-msg").textContent =
    `¿Eliminar la venta de "${v.perfume}"?${pc > 0 ? " Se devolverán " + fmt(pc) + " a la caja (precio de compra)." : ""}${v.esCuotas ? " Las cuotas también se eliminan." : ""}`;
  document.getElementById("del-confirm-btn").onclick = () => {
    const vx = ventas.find((x) => x.id === pendingDeleteId);
    if (vx && vx.precioCompra > 0) {
      // devolver precio de compra a caja como entrada
      caja.unshift({
        id: Date.now(),
        tipo: "entrada",
        desc: `Devolución compra: ${vx.perfume} (venta eliminada)`,
        monto: vx.precioCompra,
        fecha: hoy(),
        auto: true,
      });
      // restaurar stock
      const sp = perfumes.find(
        (p) => p.nombre.toLowerCase() === vx.perfume.toLowerCase(),
      );
      if (sp) sp.stock = (sp.stock || 0) + 1;
    }
    const ventaEliminada = ventas.find((x) => x.id === pendingDeleteId);
    const cajaEntradaId = pc > 0 ? Date.now() : null;
    ventas = ventas.filter((x) => x.id !== pendingDeleteId);
    save();
    closeModal("del-modal");
    updateStats();
    renderVentas();
    renderMesFilter("mes-filter-ventas", "ventas");
    const tc = document.getElementById("tab-cuotas");
    if (tc && tc.classList.contains("active")) renderCuotasPendientes();
    const tb = document.getElementById("tab-caja");
    if (tb && tb.classList.contains("active")) renderCaja();
    // Undo: restaurar la venta y revertir la entrada de caja automática
    toastUndo(
      pc > 0
        ? `🗑 Venta eliminada · ${fmt(pc)} devueltos a la caja`
        : "🗑 Venta eliminada",
      () => {
        if (ventaEliminada) {
          ventas.unshift(ventaEliminada);
        }
        if (cajaEntradaId) {
          caja = caja.filter((m) => m.id !== cajaEntradaId);
        }
        // revertir stock sumado
        if (ventaEliminada && ventaEliminada.precioCompra > 0) {
          const sp = perfumes.find(
            (p) =>
              p.nombre.toLowerCase() === ventaEliminada.perfume.toLowerCase(),
          );
          if (sp) sp.stock = Math.max(0, (sp.stock || 0) - 1);
        }
        save();
        updateStats();
        renderVentas();
        renderMesFilter("mes-filter-ventas", "ventas");
      },
    );
  };
  document.getElementById("del-modal").classList.add("open");
}
// ── IMPORTAR ─────────────────────────────────────────────────
function esMesSheet(name) {
  const n = name.toUpperCase().trim();
  if (!MESES.some((m) => n.includes(m))) return false;
  return !EXCLUIR.some((e) => n.includes(e));
}
function normH(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}
function findCol(headers, cands) {
  for (const c of cands) {
    const i = headers.findIndex((h) => normH(h) === c || normH(h).includes(c));
    if (i >= 0) return i;
  }
  return -1;
}
function parseVentasSheet(ws) {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (raw.length < 2) return [];
  let hIdx = -1,
    headers = [];
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    const row = raw[i].map((c) => normH(String(c)));
    if (row.some((c) => c.includes("PERFUME") || c.includes("PRECIO VENTA"))) {
      hIdx = i;
      headers = row;
      break;
    }
  }
  if (hIdx < 0) return [];
  const iN = findCol(headers, ["Nº VENTAS", "º VENTAS", "# VENTAS"]),
    iF = findCol(headers, ["FECHA"]),
    iP = findCol(headers, ["PERFUME"]),
    iPV = findCol(headers, ["PRECIO VENTA", "VENTA"]),
    iC = findCol(headers, ["CUOTAS"]),
    iD = findCol(headers, ["DEBE DE CUOTA", "DEBE"]),
    iPago = findCol(headers, ["PAGO"]),
    iComp = findCol(headers, ["COMPRA"]),
    iG = findCol(headers, ["GANANCIA"]),
    iProv = findCol(headers, ["PROVEEDOR"]),
    iVend = findCol(headers, ["VENDEDOR"]),
    iCli = findCol(headers, ["CLIENTE"]);
  if (iP < 0 || iPV < 0) return [];
  const res = [];
  for (let i = hIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const perfume = String(row[iP] || "").trim();
    const pv = parseFloat(row[iPV]) || 0;
    if (!perfume || !pv) continue;
    const cRaw = iC >= 0 ? String(row[iC] || "1").trim() : "1";
    const debe = iD >= 0 ? parseFloat(row[iD]) || 0 : 0;
    const pago = iPago >= 0 ? parseFloat(row[iPago]) || 0 : pv;
    const compra = iComp >= 0 ? parseFloat(row[iComp]) || 0 : 0;
    const ganRaw = iG >= 0 ? parseFloat(row[iG]) : NaN;
    const gan = !isNaN(ganRaw) && ganRaw !== 0 ? ganRaw : pv - compra;
    const esCuotasRaw = cRaw.includes("/") || debe > 0;
    let cuotasTotal = 1;
    if (esCuotasRaw) {
      const m = cRaw.match(/\/(\d+)/);
      cuotasTotal = m ? parseInt(m[1]) : 2;
    }
    const cuotasPagos =
      pago > 0
        ? [
            {
              monto: pago,
              fecha: parseExcelDate(iF >= 0 ? row[iF] : ""),
              numCuota: 0,
            },
          ]
        : [];
    res.push({
      nVenta: iN >= 0 ? String(row[iN] || "").trim() : "",
      fecha: parseExcelDate(iF >= 0 ? row[iF] : ""),
      perfume,
      precioVenta: pv,
      precioCompra: compra,
      ganancia: gan,
      esCuotas: esCuotasRaw,
      cuotasTotal,
      primeraCuota: pago,
      cuotasPagos,
      proveedor: iProv >= 0 ? String(row[iProv] || "").trim() : "",
      vendedor: iVend >= 0 ? String(row[iVend] || "").trim() : "",
      cliente: iCli >= 0 ? String(row[iCli] || "").trim() : "",
    });
  }
  return res;
}
async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast(
      "⚠ El archivo es muy grande (" +
        Math.round(file.size / 1024 / 1024) +
        "MB). Máximo 10MB.",
    );
    e.target.value = "";
    return;
  }
  if (!(await ensureXLSX())) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: "array" });
      let todas = [],
        hojas = [],
        errores = [];
      for (const sn of wb.SheetNames) {
        if (!esMesSheet(sn)) continue;
        const filas = parseVentasSheet(wb.Sheets[sn]);
        if (!filas.length) {
          errores.push(`"${sn}": sin ventas válidas`);
          continue;
        }
        const anio = new Date().getFullYear();
        const miMap = {
          ENERO: "01",
          FEBRERO: "02",
          MARZO: "03",
          ABRIL: "04",
          MAYO: "05",
          JUNIO: "06",
          JULIO: "07",
          AGOSTO: "08",
          SEPTIEMBRE: "09",
          OCTUBRE: "10",
          NOVIEMBRE: "11",
          DICIEMBRE: "12",
        };
        let mm = "01";
        for (const [k, v] of Object.entries(miMap)) {
          if (sn.toUpperCase().includes(k)) {
            mm = v;
            break;
          }
        }
        filas.forEach((f, idx) => {
          if (!f.fecha) f.fecha = `01/${mm}/${anio}`;
          f.id = Date.now() + todas.length + idx;
          todas.push(f);
        });
        hojas.push(`${sn} (${filas.length})`);
      }
      if (!todas.length) {
        toast("⚠ No se encontraron ventas. Verificá los nombres de las hojas.");
        e.target.value = "";
        return;
      }
      const existKeys = new Set(
        ventas.map(
          (v) => `${v.fecha}|${v.perfume}|${v.precioVenta}|${v.ganancia}`,
        ),
      );
      const nuevas = todas.filter(
        (v) =>
          !existKeys.has(
            `${v.fecha}|${v.perfume}|${v.precioVenta}|${v.ganancia}`,
          ),
      );
      pendingImport = {
        nuevas,
        hojas,
        dup: todas.length - nuevas.length,
        errores,
      };
      document.getElementById("import-stats").innerHTML = [
        `<div class="import-stat"><span>Hojas leídas</span><span>${hojas.join(", ")}</span></div>`,
        `<div class="import-stat"><span>✨ Ventas nuevas</span><span>${nuevas.length}</span></div>`,
        nuevas.filter((v) => v.esCuotas).length
          ? `<div class="import-stat"><span>📆 En cuotas</span><span>${nuevas.filter((v) => v.esCuotas).length}</span></div>`
          : "",
        pendingImport.dup
          ? `<div class="import-stat"><span>⏭ Duplicadas</span><span>${pendingImport.dup}</span></div>`
          : "",
      ].join("");
      document.getElementById("import-preview").innerHTML =
        nuevas
          .slice(0, 25)
          .map(
            (v) =>
              `<div class="import-preview-item">📅 ${v.fecha} · <span>${v.perfume}</span> · ${fmt(v.precioVenta)}${v.esCuotas ? ` · <span style="color:var(--warn)">${v.cuotasTotal} cuotas</span>` : ""}</div>`,
          )
          .join("") +
        (nuevas.length > 25
          ? `<div class="import-preview-item" style="color:var(--text3)">...y ${nuevas.length - 25} más</div>`
          : "");
      const errEl = document.getElementById("import-errors");
      if (errores.length) {
        errEl.innerHTML = "⚠ " + errores.join("<br>");
        errEl.classList.add("show");
      } else errEl.classList.remove("show");
      document.getElementById("import-result").classList.add("show");
      document
        .getElementById("btn-import-confirm")
        .classList.toggle("show", nuevas.length > 0);
    } catch (err) {
      toast("⚠ Error: " + err.message);
    }
    e.target.value = "";
  };
  reader.readAsArrayBuffer(file);
}
function confirmImport() {
  if (!pendingImport) return;
  const { nuevas } = pendingImport;
  const total = nuevas.length;
  nuevas.sort((a, b) =>
    b.fecha
      .split("/")
      .reverse()
      .join("")
      .localeCompare(a.fecha.split("/").reverse().join("")),
  );
  ventas = [...nuevas, ...ventas];
  nuevas.forEach((v) => {
    let sp = perfumes.find(
      (p) => p.nombre.toLowerCase() === v.perfume.toLowerCase(),
    );
    if (!sp) {
      sp = {
        nombre: v.perfume,
        precio: v.precioCompra || 0,
        stock: 0,
        proveedor: v.proveedor || "",
        foto: null,
      };
      perfumes.push(sp);
    }
  });
  save();
  pendingImport = null;
  // Reset import UI
  document.getElementById("import-result").classList.remove("show");
  document.getElementById("btn-import-confirm").classList.remove("show");
  document.getElementById("import-errors").classList.remove("show");
  toast(`✓ ${total} ventas importadas`, 2500);
  // Force full re-render on next frames — fixes desktop render freeze
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      activeMesVentas = "todos";
      showTab("ventas");
      updateStats();
    });
  });
}
// drag-drop listeners moved to DOMContentLoaded
// ── EXPORTAR EXCEL ────────────────────────────────────────────
async function exportExcel() {
  if (!(await ensureXLSX())) {
    return;
  }
  const wb2 = XLSX.utils.book_new();
  const porMes = {};
  ventas.forEach((v) => {
    const k = mesKey(v.fecha) || "SIN MES";
    if (!porMes[k]) porMes[k] = [];
    porMes[k].push(v);
  });
  Object.entries(porMes)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([k, vs]) => {
      const nombre = mesLabel(k).toUpperCase();
      const rows = [
        [
          `VIP PARFUMS ${nombre}`,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ],
        [
          "º VENTAS",
          "FECHA",
          "PERFUME",
          "PRECIO VENTA",
          "CUOTAS",
          "DEBE DE CUOTA",
          "PAGO",
          "COMPRA",
          "GANANCIA",
          "PROVEEDOR",
          "VENDEDOR",
          "CLIENTE",
          "",
        ],
      ];
      let tV = 0,
        tD = 0,
        tP = 0,
        tC = 0,
        tG = 0;
      vs.forEach((v, i) => {
        const pagado = (v.cuotasPagos || []).reduce((s, p) => s + p.monto, 0);
        const debe = calcDebe(v);
        const cStr = v.esCuotas
          ? `${(v.cuotasPagos || []).length}/${v.cuotasTotal}`
          : "1";
        rows.push([
          i + 1,
          v.fecha,
          v.perfume,
          v.precioVenta,
          cStr,
          debe,
          pagado,
          v.precioCompra || 0,
          v.ganancia || 0,
          v.proveedor || "",
          v.vendedor || "",
          v.cliente || "",
          "",
        ]);
        tV += v.precioVenta || 0;
        tD += debe;
        tP += pagado;
        tC += v.precioCompra || 0;
        tG += v.ganancia || 0;
      });
      rows.push(["", "", "", tV, "", tD, tP, tC, tG, "", "", "", ""]);
      rows.push(["", "", "", "", "", "", "", "", tG, "", "", "", ""]);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 10 },
        { wch: 12 },
        { wch: 24 },
        { wch: 14 },
        { wch: 8 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 16 },
        { wch: 4 },
      ];
      XLSX.utils.book_append_sheet(wb2, ws, nombre.substring(0, 31));
    });
  const resRows = [
    ["RESUMEN VIP PARFUMS"],
    [""],
    [
      "Mes",
      "Ventas",
      "Ganancia",
      "Cobrado",
      "Por cobrar",
      "Gastos",
      "Ganancia Real",
    ],
  ];
  Object.entries(porMes)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([k, vs]) => {
      const gs = gastos.filter((g) => mesKey(g.fecha) === k);
      resRows.push([
        mesLabel(k),
        vs.length,
        vs.reduce((s, v) => s + (v.ganancia || 0), 0),
        vs.reduce(
          (s, v) => s + (v.cuotasPagos || []).reduce((a, p) => a + p.monto, 0),
          0,
        ),
        vs.reduce((s, v) => s + calcDebe(v), 0),
        gs.reduce((s, g) => s + g.monto, 0),
        vs.reduce((s, v) => s + (v.ganancia || 0), 0) -
          gs.reduce((s, g) => s + g.monto, 0),
      ]);
    });
  resRows.push([]);
  resRows.push([
    "TOTAL",
    ventas.length,
    ventas.reduce((s, v) => s + (v.ganancia || 0), 0),
    ventas.reduce(
      (s, v) => s + (v.cuotasPagos || []).reduce((a, p) => a + p.monto, 0),
      0,
    ),
    ventas.reduce((s, v) => s + calcDebe(v), 0),
    gastos.reduce((s, g) => s + g.monto, 0),
    ventas.reduce((s, v) => s + (v.ganancia || 0), 0) -
      gastos.reduce((s, g) => s + g.monto, 0),
  ]);
  const wsRes = XLSX.utils.aoa_to_sheet(resRows);
  wsRes["!cols"] = [
    { wch: 16 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb2, wsRes, "RESUMEN");
  const gRows = [
    ["FECHA", "CATEGORÍA", "DESCRIPCIÓN", "MONTO", "PERFUMES", "COSTO X PERF"],
  ];
  gastos.forEach((g) => {
    const p =
      g.perfumesEnvio?.length > 0 ? g.monto / g.perfumesEnvio.length : 0;
    gRows.push([
      g.fecha,
      CAT_LABELS[g.categoria] || g.categoria,
      g.nombreOtro || g.descripcion || "",
      g.monto,
      (g.perfumesEnvio || []).join(", "),
      p || "",
    ]);
  });
  const wsG = XLSX.utils.aoa_to_sheet(gRows);
  wsG["!cols"] = [
    { wch: 12 },
    { wch: 20 },
    { wch: 22 },
    { wch: 12 },
    { wch: 26 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb2, wsG, "GASTOS");
  const cajRows = [["FECHA", "TIPO", "DESCRIPCIÓN", "MONTO"]];
  caja.forEach((m) =>
    cajRows.push([
      m.fecha,
      m.tipo === "entrada" ? "ENTRADA" : "SALIDA",
      m.desc,
      m.monto,
    ]),
  );
  const wsCaj = XLSX.utils.aoa_to_sheet(cajRows);
  wsCaj["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 28 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb2, wsCaj, "CAJA");
  XLSX.writeFile(wb2, `VIP_Parfums_${hoy().replace(/\//g, "-")}.xlsx`);
  toast("📥 Excel exportado en formato VIP");
}
// Modal close on backdrop click + initial tab — moved to DOMContentLoaded
// (see DOMContentLoaded handler below)

// Service Worker externo removido — app funciona offline via cache del navegador

// ══════════════════════════════════════════════
// 1. SISTEMA DE LICENCIA
// ══════════════════════════════════════════════
const LICENSE = {
  trialDays: 7, // Días de prueba gratuita completa
  trialMinutes: null, // Solo para demo — setear a un número (ej: 1) para pruebas rápidas
  trialLimitedVentas: 5, // Ventas nuevas permitidas tras vencer el trial
  isDemo: false, // true = modo demostración con datos de ejemplo
};

// ══════════════════════════════════════════════
// SISTEMA DE ACTIVACIÓN POR CÓDIGO
// ══════════════════════════════════════════════

// Genera el hash simple de un código candidato para validación local
// ══════════════════════════════════════════════════════════════
// SISTEMA DE LICENCIAS — Validación server-side via Netlify Functions
//
// Para agregar un código nuevo:
//   1. Abrí Netlify → Site Settings → Environment Variables
//   2. Editá VALID_LICENSE_CODES y agregá el nuevo código (ej: PT-CCCC-3333)
//   3. Re-deploy (o Trigger deploy) — listo.
//
// La clave secreta y la lista de códigos NO están en este archivo.
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// VALIDACIÓN DE LICENCIA — SERVER-SIDE via Netlify Functions
// La clave secreta y la lista de códigos válidos viven SOLO en el
// servidor (variables de entorno de Netlify). Nada sensible en cliente.
// ══════════════════════════════════════════════════════════════

// Llama al servidor para validar el código de activación.
// Retorna { valid: true, token, activatedAt } o { valid: false }.
async function isValidActivationCode(code) {
  try {
    const res = await fetch("/api/validate-license", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    });
    if (!res.ok) return { valid: false };
    return await res.json();
  } catch (e) {
    // Sin conexión — no se puede validar ahora
    return { valid: false, offline: true };
  }
}

// Llama al servidor para verificar que un token existente siga siendo válido.
// Se ejecuta silenciosamente en segundo plano cada 7 días.
async function verifyStoredToken() {
  const token = localStorage.getItem("pt_server_token") || "";
  const activatedAt = localStorage.getItem("pt_activated_at") || "";
  const code = localStorage.getItem("pt_license_code") || "";
  if (!token || !activatedAt || !code) return false;
  try {
    const res = await fetch("/api/verify-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, activatedAt, code }),
    });
    if (!res.ok) return true; // servidor caído → no penalizar al usuario
    const data = await res.json();
    if (data.valid) {
      localStorage.setItem("pt_last_verified", Date.now().toString());
      return true;
    }
    if (data.reason === "revoked") {
      // Licencia revocada: limpiar y mostrar aviso
      clearLicenseStorage();
      toast("⚠ Tu licencia fue desactivada. Contactá a soporte.", 6000);
    }
    return false;
  } catch {
    return true; // sin conexión → optimista
  }
}

function clearLicenseStorage() {
  [
    "pt_server_token",
    "pt_activated_at",
    "pt_license_code",
    "pt_last_verified",
  ].forEach((k) => localStorage.removeItem(k));
}

// Verificación periódica silenciosa al iniciar la app
function scheduleBackgroundVerification() {
  if (!isActivated()) return;
  const lastVerified = parseInt(
    localStorage.getItem("pt_last_verified") || "0",
  );
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - lastVerified > SEVEN_DAYS) {
    // Esperar 5s para no bloquear el arranque de la app
    setTimeout(async () => {
      const still = await verifyStoredToken();
      if (!still) {
        clearLicenseStorage();
        window._trialLimitado = true;
        renderAjustes?.();
      }
    }, 5000);
  }
}

async function activarLicencia() {
  const input = document.getElementById("activation-code-input");
  if (!input) return;
  const code = input.value.trim().toUpperCase();
  if (!code) {
    shakeInput(input);
    return;
  }

  // Mostrar estado de carga mientras se computa el HMAC
  const btn = document.querySelector(
    '#modal-activacion .btn-gold, #modal-activacion button[onclick*="activar"]',
  );
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Verificando...";
  }

  const result = await isValidActivationCode(code);

  if (btn) {
    btn.disabled = false;
    btn.textContent = "🔑 Activar";
  }

  if (result && result.valid) {
    // Guardar token firmado por el servidor + metadata (nunca la clave secreta)
    localStorage.setItem("pt_server_token", result.token);
    localStorage.setItem("pt_activated_at", result.activatedAt);
    localStorage.setItem("pt_license_code", code); // el usuario ya conoce su propio código
    localStorage.setItem("pt_last_verified", Date.now().toString());
    const banner = document.getElementById("trial-banner");
    if (banner) banner.remove();
    document.body.classList.remove("has-top-banner");
    closeModal("modal-activacion");
    window._trialLimitado = false;
    toast(
      "🎉 ¡Licencia activada! Parfum Track está completamente desbloqueado.",
      4000,
    );
    renderAjustes();
  } else {
    shakeInput(input);
    const err = document.getElementById("activation-error");
    if (err) {
      if (result && result.offline) {
        err.textContent =
          "⚠ Sin conexión. Conectate a internet para activar la licencia.";
      } else {
        err.textContent = "⚠ Código incorrecto. Verificá y volvé a intentar.";
      }
      setTimeout(() => {
        err.textContent = "";
      }, 4000);
    }
  }
}

function shakeInput(el) {
  el.style.animation = "none";
  el.offsetHeight; // reflow
  el.style.animation = "shake-input .4s ease";
  el.style.borderColor = "var(--danger)";
  setTimeout(() => {
    el.style.borderColor = "";
    el.style.animation = "";
  }, 600);
}

function abrirModalActivacion() {
  document.getElementById("modal-activacion").classList.add("open");
  setTimeout(() => {
    const inp = document.getElementById("activation-code-input");
    if (inp) inp.focus();
  }, 200);
}

function isActivated() {
  // Verifica que exista un token de 64 chars hex firmado por el servidor.
  // La autenticidad real se verifica en el servidor cada 7 días (scheduleBackgroundVerification).
  const token = localStorage.getItem("pt_server_token") || "";
  return token.length === 64 && /^[0-9a-f]+$/.test(token);
}

// ══════════════════════════════════════════════
// SISTEMA DE TRIAL — 7 días completo → modo limitado
// ══════════════════════════════════════════════
window._trialLimitado = false; // true cuando venció el trial pero no activó

function getTrialDuration() {
  // Demo mode: usar minutos si está seteado
  if (LICENSE.trialMinutes) return LICENSE.trialMinutes * 60 * 1000;
  return LICENSE.trialDays * 86400000;
}

function getTrialTimeLeft(trialStart) {
  const elapsed = Date.now() - parseInt(trialStart);
  const duration = getTrialDuration();
  return duration - elapsed;
}

function formatTrialTimeLeft(ms) {
  if (ms <= 0) return null;
  if (LICENSE.trialMinutes) {
    // Mostrar minutos y segundos
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  }
  const days = Math.floor(ms / 86400000);
  return `${days} día${days !== 1 ? "s" : ""}`;
}
function getTrialVentasRestantes() {
  const trialStart = parseInt(localStorage.getItem("pt_trial_start") || "0");
  const vencimiento = trialStart + getTrialDuration();
  // Fix: usar createdAt explícito en lugar de id (que no siempre es timestamp)
  const ventasTrasVencer = ventas.filter(
    (v) => (v.createdAt || v.id) > vencimiento,
  ).length;
  return Math.max(0, LICENSE.trialLimitedVentas - ventasTrasVencer);
}

function checkTrial() {
  if (isActivated()) {
    scheduleBackgroundVerification(); // verificar token en servidor cada 7 días
    return;
  }
  if (LICENSE.isDemo) {
    cargarDatosDemo();
    mostrarCartelDemo();
    return;
  }
  if (!LICENSE.trialDays && !LICENSE.trialMinutes) return;
  if (LICENSE.expiresAt) return;

  let trialStart = localStorage.getItem("pt_trial_start");
  if (!trialStart) {
    trialStart = Date.now().toString();
    localStorage.setItem("pt_trial_start", trialStart);
    if (ventas.length === 0 && perfumes.length === 0) {
      cargarDatosDemo();
      localStorage.setItem("pt_trial_demo_loaded", "1");
    }
    setTimeout(() => mostrarBienvenidaTrial(), 1200);
    return;
  }

  const msLeft = getTrialTimeLeft(trialStart);

  if (msLeft <= 0) {
    window._trialLimitado = true;
    const restantes = getTrialVentasRestantes();
    mostrarBannerTrialVencido(restantes);
  } else {
    mostrarBannerTrial(formatTrialTimeLeft(msLeft));
    // Si estamos en modo minutos, actualizar el banner cada segundo
    if (LICENSE.trialMinutes) {
      if (window._trialTickerInterval)
        clearInterval(window._trialTickerInterval);
      window._trialTickerInterval = setInterval(() => {
        if (isActivated()) {
          clearInterval(window._trialTickerInterval);
          return;
        }
        const ms = getTrialTimeLeft(trialStart);
        if (ms <= 0) {
          clearInterval(window._trialTickerInterval);
          window._trialLimitado = true;
          const r = getTrialVentasRestantes();
          mostrarBannerTrialVencido(r);
          toast(
            "⏳ Período de prueba finalizado. Podés registrar " +
              r +
              " ventas más.",
            5000,
          );
        } else {
          mostrarBannerTrial(formatTrialTimeLeft(ms));
        }
      }, 1000);
    }
  }
}

function mostrarBienvenidaTrial() {
  // Solo mostrar si hay un modal de bienvenida trial en el DOM
  const el = document.getElementById("modal-trial-bienvenida");
  if (el) el.classList.add("open");
}

function mostrarBannerTrialVencido(restantes) {
  let banner = document.getElementById("trial-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "trial-banner";
    document.body.appendChild(banner);
    document.body.classList.add("has-top-banner");
  }
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:9000;padding:max(8px, env(safe-area-inset-top)) 14px 8px;text-align:center;font-size:12px;cursor:pointer;backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;";
  banner.style.background =
    "linear-gradient(90deg,rgba(224,112,112,0.18),rgba(224,112,112,0.06))";
  banner.style.borderBottom = "1px solid var(--danger)";
  banner.style.color = "#e07070";

  if (restantes > 0) {
    banner.innerHTML = `⚠️ Prueba vencida · Podés cargar <strong>${restantes} venta${restantes !== 1 ? "s" : ""} más</strong> · <span onclick="abrirModalActivacion()" style="text-decoration:underline;cursor:pointer;color:#f0a0a0;">Activar ahora →</span>`;
  } else {
    banner.innerHTML = `🔒 Límite alcanzado · <span onclick="abrirModalActivacion()" style="text-decoration:underline;cursor:pointer;color:#f0a0a0;">Activá tu licencia para seguir registrando ventas →</span>`;
  }
  banner.onclick = function (e) {
    if (e.target === banner || e.target.tagName === "STRONG")
      abrirModalActivacion();
  };
}

function mostrarBannerTrial(label) {
  let banner = document.getElementById("trial-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "trial-banner";
    document.body.appendChild(banner);
    document.body.classList.add("has-top-banner");
  }
  const urgente =
    (typeof label === "string" &&
      label.includes("s") &&
      !label.includes("m") &&
      !label.includes("día")) ||
    label === "1m 0s" ||
    label === "0m 30s";
  const col = urgente ? "#e07070" : "var(--gold2)";
  const bg = urgente
    ? "linear-gradient(90deg,rgba(224,112,112,0.15),rgba(224,112,112,0.04))"
    : "linear-gradient(90deg,var(--gold-dim),rgba(201,168,76,0.04))";
  const bdr = urgente ? "var(--danger)" : "var(--gold)";
  banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9000;background:${bg};border-bottom:1px solid ${bdr};padding:max(7px, env(safe-area-inset-top)) 14px 7px;text-align:center;font-size:12px;color:${col};backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;`;
  banner.innerHTML = `${urgente ? "⚠️" : "⏳"} Prueba gratuita: quedan <strong>${label}</strong> &nbsp;·&nbsp; <span onclick="abrirModalActivacion()" style="text-decoration:underline;cursor:pointer;">Activar licencia →</span>`;
}

function mostrarCartelDemo() {
  let banner = document.getElementById("demo-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "demo-banner";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9000;background:linear-gradient(90deg,rgba(160,112,224,0.2),rgba(160,112,224,0.05));border-bottom:1px solid #a070e0;padding:7px 14px;text-align:center;font-size:12px;color:#c9a0f0;backdrop-filter:blur(8px);";
    banner.innerHTML =
      "🎭 MODO DEMOSTRACIÓN · Estás viendo datos de ejemplo · Esta es una versión de prueba";
    document.body.appendChild(banner);
    document.body.classList.add("has-top-banner");
  }
}

function cargarDatosDemo() {
  // Carga datos de ejemplo realistas para que el cliente vea la app funcionando
  const hoyD = new Date();
  function fechaRel(diasAtras) {
    const d = new Date(hoyD);
    d.setDate(d.getDate() - diasAtras);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }

  perfumes = [
    {
      nombre: "Haramain Gold",
      precio: 3100,
      stock: 12,
      proveedor: "SCENTA",
      foto: null,
      pVenta: 3900,
    },
    {
      nombre: "Bharara King",
      precio: 3300,
      stock: 8,
      proveedor: "ESTEFANI",
      foto: null,
      pVenta: 3900,
    },
    {
      nombre: "Yara Rosa",
      precio: 1800,
      stock: 2,
      proveedor: "SCENTA",
      foto: null,
      pVenta: 2500,
    },
    {
      nombre: "CDN Urban Elixir",
      precio: 2650,
      stock: 5,
      proveedor: "ESTEFANI",
      foto: null,
      pVenta: 2900,
    },
    {
      nombre: "Lattafa Asad",
      precio: 2400,
      stock: 0,
      proveedor: "SCENTA",
      foto: null,
      pVenta: 3200,
    },
  ];

  ventas = [
    {
      id: Date.now() + 1,
      perfume: "Haramain Gold",
      precioVenta: 3900,
      precioCompra: 3100,
      ganancia: 800,
      cliente: "María G.",
      vendedor: "",
      fecha: fechaRel(2),
      esCuotas: false,
      cuotasPagos: [{ monto: 3900, fecha: fechaRel(2) }],
      cuotasTotal: 1,
      proveedor: "SCENTA",
    },
    {
      id: Date.now() + 2,
      perfume: "Bharara King",
      precioVenta: 3900,
      precioCompra: 3300,
      ganancia: 600,
      cliente: "José R.",
      vendedor: "",
      fecha: fechaRel(5),
      esCuotas: true,
      cuotasPagos: [{ monto: 1950, fecha: fechaRel(5) }],
      cuotasTotal: 2,
      proveedor: "ESTEFANI",
    },
    {
      id: Date.now() + 3,
      perfume: "Yara Rosa",
      precioVenta: 2500,
      precioCompra: 1800,
      ganancia: 700,
      cliente: "Lucía P.",
      vendedor: "",
      fecha: fechaRel(8),
      esCuotas: false,
      cuotasPagos: [{ monto: 2500, fecha: fechaRel(8) }],
      cuotasTotal: 1,
      proveedor: "SCENTA",
    },
    {
      id: Date.now() + 4,
      perfume: "CDN Urban Elixir",
      precioVenta: 2900,
      precioCompra: 2650,
      ganancia: 250,
      cliente: "Ana M.",
      vendedor: "",
      fecha: fechaRel(12),
      esCuotas: true,
      cuotasPagos: [{ monto: 1000, fecha: fechaRel(12) }],
      cuotasTotal: 3,
      proveedor: "ESTEFANI",
    },
    {
      id: Date.now() + 5,
      perfume: "Haramain Gold",
      precioVenta: 3900,
      precioCompra: 3100,
      ganancia: 800,
      cliente: "Carla S.",
      vendedor: "",
      fecha: fechaRel(15),
      esCuotas: false,
      cuotasPagos: [{ monto: 3900, fecha: fechaRel(15) }],
      cuotasTotal: 1,
      proveedor: "SCENTA",
    },
  ];

  gastos = [
    {
      id: 1,
      categoria: "envio_compra",
      descripcion: "Envío proveedor",
      nombreOtro: "",
      monto: 450,
      fecha: fechaRel(10),
      perfumesEnvio: [],
    },
    {
      id: 2,
      categoria: "bolsas",
      descripcion: "Bolsas de regalo",
      nombreOtro: "",
      monto: 300,
      fecha: fechaRel(7),
      perfumesEnvio: [],
    },
  ];

  caja = [
    {
      tipo: "entrada",
      desc: "Venta Haramain Gold",
      monto: 3900,
      fecha: fechaRel(2),
    },
    { tipo: "salida", desc: "Compra stock", monto: 9300, fecha: fechaRel(20) },
    {
      tipo: "entrada",
      desc: "Venta Yara Rosa",
      monto: 2500,
      fecha: fechaRel(8),
    },
  ];

  metaMensual = 12000;
  // NO guardamos en localStorage los datos demo si es trial real (para no pisar datos del usuario)
  // En modo isDemo sí se mantienen en memoria
  if (!LICENSE.isDemo) {
    save();
  }
}

function resetTrialYDatos() {
  // Para testing: limpia el trial
  localStorage.removeItem("pt_trial_start");
  localStorage.removeItem("pt_trial_demo_loaded");
}

// 2. SISTEMA DE PIN — implementado en DOMContentLoaded (ver abajo)

// Cambiar PIN desde ajustes

// ══════════════════════════════════════════════
// 3. BACKUP AUTOMÁTICO — RECORDATORIO
// ══════════════════════════════════════════════
function checkBackupReminder() {
  // Si el onboarding todavía no se completó, no molestar con el backup
  if (!localStorage.getItem("pt_onboarding_done")) return;
  // Si el banner proactivo ya está visible, no mostrar el modal encima
  const bannerActivo =
    document.getElementById("backup-proactive-banner") &&
    document
      .getElementById("backup-proactive-banner")
      .classList.contains("show");
  if (bannerActivo) return;
  const lastBackup = localStorage.getItem("pt_last_backup");
  const snooze = localStorage.getItem("pt_backup_snooze");
  // Si hay snooze activo (menos de 24hs), no mostrar
  if (snooze && Date.now() - parseInt(snooze) < 24 * 60 * 60 * 1000) return;
  if (!lastBackup) {
    // Nunca hizo backup
    document.getElementById("ultimo-backup-fecha").textContent = "nunca";
    setTimeout(() => {
      // Cerrar el banner si está abierto y abrir el modal en su lugar
      const banner = document.getElementById("backup-proactive-banner");
      if (banner) banner.classList.remove("show");
      document.getElementById("backup-modal").classList.add("open");
    }, 2000);
    return;
  }
  const daysSince = Math.floor((Date.now() - parseInt(lastBackup)) / 86400000);
  if (daysSince >= 7) {
    const d = new Date(parseInt(lastBackup));
    document.getElementById("ultimo-backup-fecha").textContent =
      d.toLocaleDateString("es-AR");
    setTimeout(() => {
      // Cerrar el banner si está abierto y abrir el modal en su lugar
      const banner = document.getElementById("backup-proactive-banner");
      if (banner) banner.classList.remove("show");
      document.getElementById("backup-modal").classList.add("open");
    }, 2000);
  }
}

function backupDataYClose() {
  backupData();
  localStorage.setItem("pt_last_backup", Date.now().toString());
  closeModal("backup-modal");
}

function snoozeBackup() {
  localStorage.setItem("pt_backup_snooze", Date.now().toString());
  closeModal("backup-modal");
  toast("⏰ Te recordamos mañana");
}

// timestamp y snooze ya integrados en backupData()

// ── BACKUP POR EMAIL ──
// Descarga el backup Y abre el mail listo para enviártelo a vos mismo
function backupPorWhatsApp() {
  // 1. Descargar el archivo JSON
  backupData();
  // 2. Armar mensaje con instrucciones claras
  const totalVentas = ventas.length;
  const totalGanancia = ventas.reduce((s, v) => s + (v.ganancia || 0), 0);
  const msg = encodeURIComponent(
    `💾 *Backup Parfum Track — ${hoy()}*\n\n` +
      `📊 Resumen:\n` +
      `• ${totalVentas} ventas registradas\n` +
      `• Ganancia total: ${fmt(totalGanancia)}\n` +
      `• ${perfumes.length} perfumes en catálogo\n\n` +
      `📁 El archivo de backup se acaba de descargar en tu celular.\n` +
      `Enviátelo a vos mismo por este chat para tenerlo guardado.\n\n` +
      `_Para restaurar: abrí Parfum Track → Importar → subí el archivo_`,
  );
  setTimeout(() => {
    window.open(`https://wa.me/?text=${msg}`, "_blank");
    toast("📲 Backup descargado. Enviátelo por WhatsApp para guardarlo.", 4000);
  }, 600);
}

function guardarEmailBackup() {
  const email = document.getElementById("cfg-backup-email").value.trim();
  if (email && !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    toast("⚠ Email inválido");
    return;
  }
  localStorage.setItem("pt_backup_email", email);
  toast("✅ Email de backup guardado");
}
// ── BACKUP POR EMAIL (abre cliente de correo) ──
function backupPorEmail() {
  backupData(); // descarga el archivo primero
  const email = localStorage.getItem("pt_backup_email") || "";
  const totalVentas = ventas.length;
  const totalGanancia = ventas.reduce((s, v) => s + (v.ganancia || 0), 0);
  const asunto = encodeURIComponent("Backup Parfum Track - " + hoy());
  const cuerpo = encodeURIComponent(
    "Backup de Parfum Track\n" +
      "Fecha: " +
      hoy() +
      "\n\n" +
      "Resumen:\n" +
      "- " +
      totalVentas +
      " ventas registradas\n" +
      "- Ganancia total: " +
      fmt(totalGanancia) +
      "\n\n" +
      "IMPORTANTE: Adjuntá el archivo que se descargó a este mail antes de enviarlo.\n" +
      "Para restaurar: abrí la app, andá a Importar y subí este archivo.",
  );
  setTimeout(() => {
    window.location.href =
      "mailto:" + email + "?subject=" + asunto + "&body=" + cuerpo;
    toast("📧 Archivo descargado. Adjuntalo al mail que se abrió.");
  }, 700);
}

// ── EXPORTACIÓN AUTOMÁTICA PROGRAMADA ──
// Recuerda cada X días hacer backup automáticamente al abrir la app
function checkAutoBackup() {
  const freq = parseInt(localStorage.getItem("pt_autobackup_dias") || "0");
  if (!freq) return; // 0 = desactivado
  const lastAuto = localStorage.getItem("pt_last_autobackup");
  const now = Date.now();
  if (!lastAuto || now - parseInt(lastAuto) >= freq * 86400000) {
    // Solo si hay datos que respaldar
    if (ventas.length > 0 || perfumes.length > 0) {
      setTimeout(() => {
        backupData();
        localStorage.setItem("pt_last_autobackup", now.toString());
        toast("💾 Backup automático descargado");
      }, 3000);
    }
  }
}

function guardarAutoBackup() {
  const dias = document.getElementById("cfg-autobackup").value;
  localStorage.setItem("pt_autobackup_dias", dias);
  toast(
    dias === "0"
      ? "Backup automático desactivado"
      : `✅ Backup automático cada ${dias} días`,
  );
}

// ══════════════════════════════════════════════
// 4. RECIBOS PDF
// ══════════════════════════════════════════════
let pdfVentaId = null;

async function abrirModalPDF(id) {
  // lazy-load jsPDF
  if (!(await ensureJsPDF())) return;

  const v = ventas.find((x) => x.id === id);
  if (!v) return;
  pdfVentaId = id;
  const debe = calcDebe(v);
  const pagado = (v.cuotasPagos || []).reduce((s, p) => s + p.monto, 0);
  document.getElementById("pdf-modal-desc").textContent =
    `${v.perfume} · ${v.fecha}`;
  const lineas = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  🍶  PARFUM TRACK — RECIBO",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `  Perfume:   ${v.perfume}`,
    `  Fecha:     ${v.fecha}`,
    v.cliente ? `  Cliente:   ${v.cliente}` : "",
    v.vendedor ? `  Vendedor:  ${v.vendedor}` : "",
    "",
    "  ─────────────────────────────",
    `  Precio:    ${fmt(v.precioVenta)}`,
    v.descuento ? `  Descuento: ${v.descuento}%` : "",
    "",
    v.esCuotas
      ? `  Cuotas:    ${(v.cuotasPagos || []).length}/${v.cuotasTotal}`
      : "  Pago:      Contado",
    v.esCuotas ? `  Cobrado:   ${fmt(pagado)}` : "",
    v.esCuotas && debe > 0
      ? `  Pendiente: ${fmt(debe)}`
      : v.esCuotas
        ? "  Estado:    ✅ Pagado"
        : "",
    v.nota ? `\n  Nota: ${v.nota}` : "",
    "",
    "  ─────────────────────────────",
    `  Emitido: ${hoy()}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ]
    .filter((l) => l !== "")
    .join("\n");
  document.getElementById("pdf-preview").textContent = lineas;
  document.getElementById("pdf-modal").classList.add("open");
}

function generarPDF() {
  if (typeof window.jspdf === "undefined" && typeof jsPDF === "undefined") {
    toast("📶 Esta función necesita internet para generar el PDF");
    return;
  }

  const v = ventas.find((x) => x.id === pdfVentaId);
  if (!v) return;
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      unit: "mm",
      format: "a6",
      orientation: "portrait",
    });
    const debe = calcDebe(v);
    const pagado = (v.cuotasPagos || []).reduce((s, p) => s + p.monto, 0);
    // Colors
    const gold = [201, 168, 76];
    const dark = [15, 15, 26];
    const gray = [100, 100, 130];
    // Background
    doc.setFillColor(...dark);
    doc.rect(0, 0, 105, 148, "F");
    // Header bar
    doc.setFillColor(...gold);
    doc.rect(0, 0, 105, 18, "F");
    // Title
    doc.setTextColor(15, 15, 26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("PARFUM TRACK", 52.5, 8, { align: "center" });
    doc.setFontSize(8);
    doc.text("RECIBO DE VENTA", 52.5, 14, { align: "center" });
    // Perfume name
    doc.setTextColor(232, 201, 126);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(v.perfume.toUpperCase(), 52.5, 28, {
      align: "center",
      maxWidth: 90,
    });
    // Divider
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.3);
    doc.line(8, 32, 97, 32);
    // Details
    const rows = [
      ["Fecha", v.fecha],
      v.cliente ? ["Cliente", v.cliente] : null,
      v.vendedor ? ["Vendedor", v.vendedor] : null,
      ["Precio", fmt(v.precioVenta)],
      v.descuento ? ["Descuento", v.descuento + "%"] : null,
      v.esCuotas
        ? ["Cuotas", `${(v.cuotasPagos || []).length}/${v.cuotasTotal}`]
        : ["Pago", "Contado"],
      v.esCuotas ? ["Cobrado", fmt(pagado)] : null,
      v.esCuotas && debe > 0
        ? ["Pendiente", fmt(debe)]
        : v.esCuotas
          ? ["Estado", "✓ Pagado"]
          : null,
    ].filter(Boolean);
    let y = 39;
    rows.forEach(([label, value]) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...gray);
      doc.text(label + ":", 10, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(240, 236, 228);
      doc.text(String(value), 45, y);
      y += 7;
    });
    // Footer divider
    doc.setDrawColor(...gold);
    doc.line(8, y + 2, 97, y + 2);
    y += 8;
    // Footer
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...gray);
    doc.text(`Emitido el ${hoy()} · Parfum Track`, 52.5, y, {
      align: "center",
    });
    if (v.nota) {
      y += 7;
      doc.text("Nota: " + v.nota, 52.5, y, { align: "center", maxWidth: 85 });
    }
    // Gold corner accent
    doc.setFillColor(...gold);
    doc.circle(97, 140, 12, "F");
    doc.setTextColor(15, 15, 26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("🍶", 93, 143);
    doc.save(
      `Recibo_${v.perfume.replace(/\s+/g, "_")}_${v.fecha.replace(/\//g, "-")}.pdf`,
    );
    closeModal("pdf-modal");
    toast("📥 Recibo PDF descargado");
  } catch (e) {
    toast("⚠ Error al generar PDF: " + e.message);
    console.error(e);
  }
}

function enviarReciboWA() {
  const v = ventas.find((x) => x.id === pdfVentaId);
  if (!v) return;
  whatsappComprobante(v.id);
  closeModal("pdf-modal");
}

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// RENDER AJUSTES
// ══════════════════════════════════════════════
function guardarConfigPago() {
  PAYMENT_CONFIG.mercadopago.alias = document
    .getElementById("cfg-mp-alias")
    .value.trim();
  PAYMENT_CONFIG.transferencia.titular = document
    .getElementById("cfg-titular")
    .value.trim();
  PAYMENT_CONFIG.transferencia.banco = document
    .getElementById("cfg-banco")
    .value.trim();
  PAYMENT_CONFIG.transferencia.cbu = document
    .getElementById("cfg-cbu")
    .value.trim();
  PAYMENT_CONFIG.transferencia.alias = document
    .getElementById("cfg-alias-banco")
    .value.trim();
  localStorage.setItem("pt_payment_config", JSON.stringify(PAYMENT_CONFIG));
  toast("✅ Configuración de pago guardada");
}

function loadPaymentConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem("pt_payment_config") || "{}");
    if (saved.mercadopago)
      Object.assign(PAYMENT_CONFIG.mercadopago, saved.mercadopago);
    if (saved.transferencia)
      Object.assign(PAYMENT_CONFIG.transferencia, saved.transferencia);
  } catch (e) {}
}

// loadPaymentConfig() se llama después de definir PAYMENT_CONFIG (ver abajo)

function renderAjustes() {
  // Cargar config de backup
  const bkEmail = document.getElementById("cfg-backup-email");
  if (bkEmail) bkEmail.value = localStorage.getItem("pt_backup_email") || "";
  const autoBk = document.getElementById("cfg-autobackup");
  if (autoBk) autoBk.value = localStorage.getItem("pt_autobackup_dias") || "0";

  // Último backup
  const lastBackup = localStorage.getItem("pt_last_backup");
  const el = document.getElementById("ajustes-ultimo-backup");
  if (el) {
    if (!lastBackup) {
      el.innerHTML =
        '<span style="color:var(--danger);">Nunca — ¡hacé un backup!</span>';
    } else {
      const d = new Date(parseInt(lastBackup));
      const days = Math.floor((Date.now() - parseInt(lastBackup)) / 86400000);
      const color =
        days >= 7
          ? "var(--danger)"
          : days >= 3
            ? "var(--warn)"
            : "var(--success)";
      el.innerHTML = `<span style="color:${color};">${d.toLocaleDateString("es-UY")} (hace ${days === 0 ? "hoy" : days + " día" + (days !== 1 ? "s" : "")})</span>`;
    }
  }

  // Payment config fields
  const mpAlias = document.getElementById("cfg-mp-alias");
  const cfgTitular = document.getElementById("cfg-titular");
  const cfgBanco = document.getElementById("cfg-banco");
  const cfgCbu = document.getElementById("cfg-cbu");
  const cfgAlias = document.getElementById("cfg-alias-banco");
  if (mpAlias) mpAlias.value = PAYMENT_CONFIG.mercadopago.alias || "";
  if (cfgTitular) cfgTitular.value = PAYMENT_CONFIG.transferencia.titular || "";
  if (cfgBanco) cfgBanco.value = PAYMENT_CONFIG.transferencia.banco || "";
  if (cfgCbu) cfgCbu.value = PAYMENT_CONFIG.transferencia.cbu || "";
  if (cfgAlias) cfgAlias.value = PAYMENT_CONFIG.transferencia.alias || "";

  // Profiles list in ajustes
  const perfilesEl = document.getElementById("ajustes-perfiles-list");
  if (perfilesEl) {
    const profiles = getProfiles();
    perfilesEl.innerHTML = profiles
      .map((p) => {
        const isActive = p.id === activeProfile;
        const vCount = (() => {
          try {
            return JSON.parse(
              localStorage.getItem(`vip_ventas_v2_${p.id}`) || "[]",
            ).length;
          } catch (e) {
            return 0;
          }
        })();
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border:0.5px solid ${isActive ? "var(--gold)" : "var(--border)"};border-radius:var(--radius-sm);">
        <span style="font-size:20px;">${p.emoji || "👤"}</span>
        <div style="flex:1;"><div style="font-size:13px;font-weight:500;color:var(--text);">${p.name}${isActive ? ' <span style="font-size:10px;color:var(--gold2);">(activo)</span>' : ""}</div>
        <div style="font-size:11px;color:var(--text3);">${vCount} ventas</div></div>
        <button onclick="editarPerfil('${p.id}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;">✏️</button>
        ${!isActive ? `<button onclick="eliminarPerfil('${p.id}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;">🗑</button>` : ""}
      </div>`;
      })
      .join("");
  }

  // Licencia
  const licEl = document.getElementById("ajustes-licencia-info");
  if (licEl) {
    let html = `<div style="line-height:1.9;font-size:12px;">`;

    if (isActivated()) {
      // ACTIVADA
      const licenseCode = localStorage.getItem("pt_license_code") || "";
      const activatedAt = localStorage.getItem("pt_activated_at");
      const lastVerified = localStorage.getItem("pt_last_verified");
      const fecha = activatedAt
        ? new Date(parseInt(activatedAt)).toLocaleDateString("es-UY")
        : "";
      const fechaVerif = lastVerified
        ? new Date(parseInt(lastVerified)).toLocaleDateString("es-UY")
        : "nunca";
      html += `<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px;padding:9px 12px;background:rgba(112,201,160,0.1);border:0.5px solid rgba(112,201,160,0.3);border-radius:10px;">
        <span style="font-size:22px;">✅</span>
        <div><div style="font-size:13px;font-weight:600;color:var(--success);">Licencia activa</div>
        <div style="font-size:11px;color:var(--text3);">Activada el ${fecha} · Verificada el ${fechaVerif}</div></div>
      </div>`;
      html += `<div>🔑 Código: <span style="color:var(--gold2);font-size:11px;letter-spacing:1px;">${licenseCode || "(guardado)"}</span></div>`;
      html += `<div>👤 Perfil: <strong style="color:var(--text);">${LICENSE.clientName}</strong></div>`;
      html += `<div style="margin-top:8px;"><span style="font-size:11px;color:var(--text3);">Parfum Track desbloqueado sin restricciones ✓</span></div>`;
    } else {
      // TRIAL o VENCIDO
      const trialStart = localStorage.getItem("pt_trial_start");
      if (trialStart) {
        const msLeft = getTrialTimeLeft(trialStart);
        const daysLeft = Math.floor(msLeft / 86400000);

        if (msLeft > 0) {
          const label = formatTrialTimeLeft(msLeft);
          html += `<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px;padding:9px 12px;background:var(--gold-dim);border:0.5px solid var(--border2);border-radius:10px;">
            <span style="font-size:22px;">⏳</span>
            <div><div style="font-size:13px;font-weight:600;color:var(--gold2);">Prueba gratuita</div>
            <div style="font-size:11px;color:var(--text3);">Quedan <strong style="color:var(--gold2);">${label}</strong> de prueba completa</div></div>
          </div>`;
          html += `<div style="font-size:11px;color:var(--text2);margin-bottom:12px;">Todas las funciones están habilitadas durante el período de prueba.</div>`;
        } else {
          const restantes = getTrialVentasRestantes();
          html += `<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px;padding:9px 12px;background:rgba(224,112,112,0.1);border:0.5px solid rgba(224,112,112,0.3);border-radius:10px;">
            <span style="font-size:22px;">🔒</span>
            <div><div style="font-size:13px;font-weight:600;color:var(--danger);">Prueba finalizada</div>
            <div style="font-size:11px;color:var(--text3);">Podés registrar <strong style="color:var(--warn);">${restantes} venta${restantes !== 1 ? "s" : ""} más</strong> en modo limitado</div></div>
          </div>`;
          html += `<div style="font-size:11px;color:var(--text2);margin-bottom:12px;">Tus datos están intactos. Activá la licencia para seguir sin restricciones.</div>`;
        }
        html += `<button onclick="abrirModalActivacion()" style="width:100%;padding:11px;background:linear-gradient(135deg,var(--gold),var(--gold2));color:#1a1a2e;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;letter-spacing:.3px;">🔑 Activar licencia</button>`;
      } else {
        html += `<div>Estado: <span style="color:var(--text3);">Sin inicializar</span></div>`;
      }
    }
    html += `</div>`;
    licEl.innerHTML = html;
  }

  // Datos de la app
  const dataEl = document.getElementById("ajustes-data-info");
  if (dataEl) {
    const totalVentas = ventas.length;
    const totalPerfumes = perfumes.length;
    const totalGastos = gastos.length;
    const totalCaja = caja.length;
    const totalGanancia = ventas.reduce((s, v) => s + (v.ganancia || 0), 0);
    const dataSize = JSON.stringify({ ventas, perfumes, gastos, caja }).length;
    const dataKB = (dataSize / 1024).toFixed(1);
    dataEl.innerHTML = `
      <div>💰 Ventas registradas: <strong style="color:var(--text);">${totalVentas}</strong></div>
      <div>🍶 Perfumes en stock: <strong style="color:var(--text);">${totalPerfumes}</strong></div>
      <div>🧾 Gastos registrados: <strong style="color:var(--text);">${totalGastos}</strong></div>
      <div>🏦 Movimientos de caja: <strong style="color:var(--text);">${totalCaja}</strong></div>
      <div>📈 Ganancia total acumulada: <strong style="color:var(--success);">${fmt(totalGanancia)}</strong></div>
      <div style="margin-top:8px;padding-top:8px;border-top:0.5px solid var(--border2);">💾 Datos de la app: <span style="color:var(--text3);">${dataKB} KB (IndexedDB)</span></div>
    `;
    // Barra visual usando Storage API real del dispositivo
    const barEl = document.getElementById("storage-bar");
    const pctLabel = document.getElementById("storage-pct-label");
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(({ usage, quota }) => {
        const pct = Math.min(100, (usage / quota) * 100).toFixed(1);
        const usedMB = (usage / 1048576).toFixed(1);
        const quotaMB = (quota / 1048576).toFixed(0);
        if (barEl) {
          barEl.style.width = pct + "%";
          barEl.style.background =
            pct > 80
              ? "var(--danger)"
              : pct > 50
                ? "var(--warn)"
                : "var(--success)";
        }
        if (pctLabel)
          pctLabel.textContent = `${usedMB} MB de ${quotaMB} MB (${pct}%)`;
      });
    } else {
      if (pctLabel) pctLabel.textContent = "IndexedDB activo";
    }
  }
  // Refrescar estado del PIN
  if (typeof actualizarCardPin === "function") actualizarCardPin();
}

// ══════════════════════════════════
// OPTIMIZACIÓN DE FOTOS DEL STOCK
// ══════════════════════════════════
function analizarFotos() {
  const conFoto = perfumes.filter((p) => p.foto && p.foto.startsWith("data:"));
  const sinFoto = perfumes.filter(
    (p) => !p.foto || !p.foto.startsWith("data:"),
  );
  const totalKB = conFoto.reduce(
    (s, p) => s + Math.round((p.foto.length * 0.75) / 1024),
    0,
  );
  const grandes = conFoto.filter((p) => (p.foto.length * 0.75) / 1024 > 50); // >50KB

  const infoEl = document.getElementById("opt-fotos-info");
  const btnOpt = document.getElementById("btn-opt-fotos");

  if (!conFoto.length) {
    infoEl.innerHTML = "✅ No hay fotos guardadas en la app.";
    infoEl.style.display = "block";
    if (btnOpt) btnOpt.style.display = "none";
    return;
  }

  infoEl.innerHTML =
    "📷 <strong>" +
    conFoto.length +
    "</strong> perfumes con foto · " +
    '<strong style="color:var(--warn)">' +
    totalKB +
    " KB</strong> usados<br>" +
    (grandes.length
      ? "⚠ <strong>" +
        grandes.length +
        "</strong> fotos grandes (>50KB) se pueden comprimir"
      : "✅ Todas las fotos ya están optimizadas") +
    '<br><span style="font-size:11px;color:var(--text3)">' +
    sinFoto.length +
    " perfumes sin foto</span>";
  infoEl.style.display = "block";

  if (btnOpt) btnOpt.style.display = grandes.length ? "block" : "none";
}

async function optimizarTodasLasFotos() {
  const conFoto = perfumes.filter((p) => p.foto && p.foto.startsWith("data:"));
  if (!conFoto.length) {
    toast("No hay fotos para optimizar");
    return;
  }

  const btnOpt = document.getElementById("btn-opt-fotos");
  if (btnOpt) {
    btnOpt.disabled = true;
    btnOpt.textContent = "⏳ Optimizando...";
  }

  let optimizadas = 0;
  let ahorroKB = 0;

  for (const p of conFoto) {
    const kbAntes = Math.round((p.foto.length * 0.75) / 1024);
    if (kbAntes <= 30) continue; // ya está bien optimizada

    try {
      const nuevaFoto = await comprimirFotoBase64(p.foto, 400, 0.72);
      const kbDespues = Math.round((nuevaFoto.length * 0.75) / 1024);
      ahorroKB += kbAntes - kbDespues;
      p.foto = nuevaFoto;
      optimizadas++;
    } catch (e) {
      // Si falla una, continúa con las demás
    }
  }

  if (optimizadas > 0) {
    save();
    toast(
      "✅ " +
        optimizadas +
        " fotos optimizadas · Liberaste ~" +
        ahorroKB +
        " KB",
      4000,
    );
    analizarFotos(); // actualizar el panel
  } else {
    toast("✅ Todas las fotos ya estaban optimizadas");
  }

  if (btnOpt) {
    btnOpt.disabled = false;
    btnOpt.textContent = "⚡ Optimizar todas";
    btnOpt.style.display = "none";
  }
}

function comprimirFotoBase64(dataUrl, maxSize, calidad) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width,
        h = img.height;
      if (w > h) {
        if (w > maxSize) {
          h = Math.round((h * maxSize) / w);
          w = maxSize;
        }
      } else {
        if (h > maxSize) {
          w = Math.round((w * maxSize) / h);
          h = maxSize;
        }
      }
      const cvs = document.createElement("canvas");
      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(cvs.toDataURL("image/jpeg", calidad));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function resetApp() {
  if (
    !confirm(
      "⚠ ¿Estás seguro? Se borrarán TODAS las ventas, perfumes, gastos y caja. Esta acción no se puede deshacer.",
    )
  )
    return;
  if (!confirm("¿Confirmar? Último aviso — se borrará todo.")) return;
  await PTDB.clear();
  // Preservar: PIN, licencia, activación, trial y perfiles
  const preserve = [
    "pt_pin_hash",
    "pt_pin_fails",
    "pt_pin_lockout",
    "pt_license_key",
    "pt_license_first_use",
    "pt_server_token",
    "pt_activated_at",
    "pt_license_code",
    "pt_last_verified",
    "pt_trial_start",
    "pt_profiles",
    "pt_active_profile",
    "vip_theme",
  ];
  const saved = {};
  preserve.forEach((k) => {
    const v = localStorage.getItem(k);
    if (v !== null) saved[k] = v;
  });
  localStorage.clear();
  Object.entries(saved).forEach(([k, v]) => localStorage.setItem(k, v));
  ventas = [];
  perfumes = [];
  gastos = [];
  caja = [];
  updateStats();
  toast("🗑 Todos los datos fueron borrados");
  showTab("ventas");
}

// ══════════════════════════════════════════════
// MULTI-PERFIL
// ══════════════════════════════════════════════
let editingProfileId = null;
let pagoVentaId = null;

// Payment config — set per client deployment
const PAYMENT_CONFIG = {
  mercadopago: {
    alias: "", // Tu alias de MP (ej: 'luccas.mp')
    cbu: "", // CBU/CVU opcional
  },
  transferencia: {
    banco: "", // Ej: 'Santander'
    cbu: "", // CBU/CVU
    alias: "", // Alias bancario
    titular: "", // Nombre del titular
  },
};

// Cargar config guardada inmediatamente después de definir el objeto
loadPaymentConfig();

function showProfileScreen() {
  const profiles = getProfiles();
  const list = document.getElementById("profile-list");
  if (!list) return;

  if (!profiles.length) {
    // First time — create default profile from existing data
    const defaultProfile = {
      id: "default",
      name: "Mi Negocio",
      emoji: "🍶",
      createdAt: Date.now(),
    };
    saveProfiles([defaultProfile]);
    // Existing data already under 'default' key — go straight to app
    enterApp();
    return;
  }

  list.innerHTML = profiles
    .map((p) => {
      const vCount = (() => {
        try {
          return JSON.parse(
            localStorage.getItem(`vip_ventas_v2_${p.id}`) || "[]",
          ).length;
        } catch (e) {
          return 0;
        }
      })();
      const isActive = p.id === activeProfile;
      return `<div style="width:100%;max-width:340px;position:relative;">
      <button class="profile-btn ${isActive ? "active-profile" : ""}" onclick="selectProfile('${p.id}')" style="width:100%;padding-right:44px;">
        <div class="profile-btn-icon">${p.emoji || "👤"}</div>
        <div style="flex:1;text-align:left;">
          <div class="profile-btn-name">${p.name}</div>
          <div class="profile-btn-sub">${vCount} venta${vCount !== 1 ? "s" : ""} registradas</div>
        </div>
      </button>
      <button onclick="editarPerfil('${p.id}')" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text3);cursor:pointer;padding:6px;font-size:16px;line-height:1;">✏️</button>
    </div>`;
    })
    .join("");

  document.getElementById("profile-screen").style.display = "flex";
}

async function selectProfile(pid) {
  await loadProfile(pid);
  document.getElementById("profile-screen").style.display = "none";
  enterApp();
}

function enterApp() {
  // Sugerir cambio de PIN si sigue siendo el default
  try {
    const PIN_KEY = "pt_pin_v3";
    const storedPin = localStorage.getItem(PIN_KEY);
    const defaultShown = localStorage.getItem("pt_pin_hint_shown");
    if (!storedPin && !defaultShown) {
      // PIN no configurado todavía (usa el default)
      localStorage.setItem("pt_pin_hint_shown", "1");
      setTimeout(
        () =>
          toast("💡 Tip: configurá tu propio PIN en Ajustes → Seguridad", 5000),
        2000,
      );
    }
  } catch (e) {}

  // Update header with current profile name
  const profiles = getProfiles();
  const p = profiles.find((x) => x.id === activeProfile);
  const badge = document.getElementById("profile-badge");
  if (badge && p)
    badge.textContent =
      (p.emoji || "🍶") +
      " " +
      (p.name.length > 8 ? p.name.slice(0, 8) + "…" : p.name);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      showTab("ventas");
      updateStats();
    });
  });
}

function abrirCrearPerfil() {
  editingProfileId = null;
  document.getElementById("modal-perfil-title").textContent = "Nuevo perfil";
  document.getElementById("perfil-nombre-input").value = "";
  document.getElementById("perfil-emoji-input").value = "👤";
  document.getElementById("modal-perfil").classList.add("open");
}

function editarPerfil(pid) {
  const profiles = getProfiles();
  const p = profiles.find((x) => x.id === pid);
  if (!p) return;
  editingProfileId = pid;
  document.getElementById("modal-perfil-title").textContent = "Editar perfil";
  document.getElementById("perfil-nombre-input").value = p.name;
  document.getElementById("perfil-emoji-input").value = p.emoji || "👤";
  document.getElementById("modal-perfil").classList.add("open");
}

function guardarPerfil() {
  const name = document.getElementById("perfil-nombre-input").value.trim();
  const emoji =
    document.getElementById("perfil-emoji-input").value.trim() || "👤";
  if (!name) {
    toast("⚠ Poné un nombre para el perfil");
    return;
  }
  const profiles = getProfiles();
  if (editingProfileId) {
    const p = profiles.find((x) => x.id === editingProfileId);
    if (p) {
      p.name = name;
      p.emoji = emoji;
    }
  } else {
    const pid = "profile_" + Date.now();
    profiles.push({ id: pid, name, emoji, createdAt: Date.now() });
  }
  saveProfiles(profiles);
  closeModal("modal-perfil");
  showProfileScreen();
  toast(editingProfileId ? "✅ Perfil actualizado" : "✅ Perfil creado");
}

function eliminarPerfil(pid) {
  if (
    !confirm("¿Eliminar este perfil y TODOS sus datos? No se puede deshacer.")
  )
    return;
  const profiles = getProfiles().filter((x) => x.id !== pid);
  saveProfiles(profiles);
  // Remove all data for this profile
  [
    "vip_ventas_v2",
    "vip_stock_v2",
    "vip_gastos_v1",
    "vip_caja_v1",
    "vip_meta_v1",
  ].forEach((k) => {
    localStorage.removeItem(`${k}_${pid}`);
  });
  if (activeProfile === pid) {
    loadProfile(profiles[0]?.id || "default");
  }
  showProfileScreen();
  toast("🗑 Perfil eliminado");
}

// Emoji picker
document.addEventListener("click", (e) => {
  if (e.target.closest("#emoji-picker") && e.target.tagName === "SPAN") {
    document.getElementById("perfil-emoji-input").value = e.target.textContent;
  }
});

// ══════════════════════════════════════════════
// MEDIOS DE PAGO
// ══════════════════════════════════════════════
function abrirModalPago(ventaId) {
  const v = ventas.find((x) => x.id === ventaId);
  if (!v) return;
  pagoVentaId = ventaId;
  const debe = calcDebe(v);
  const monto = debe > 0 ? debe : v.precioVenta;
  document.getElementById("modal-pago-info").innerHTML =
    `<strong style="color:var(--text);">${v.perfume}</strong><br>` +
    `${v.cliente ? `Cliente: ${v.cliente}<br>` : ""}` +
    `Monto a cobrar: <strong style="color:var(--gold2);">${fmt(monto)}</strong>` +
    (v.esCuotas && debe > 0
      ? `<br><span style="color:var(--warn);font-size:11px;">Saldo pendiente</span>`
      : "");
  document.getElementById("modal-pago").classList.add("open");
}

function getMontoVenta() {
  const v = ventas.find((x) => x.id === pagoVentaId);
  if (!v) return 0;
  const debe = calcDebe(v);
  return debe > 0 ? debe : v.precioVenta;
}

function cobrarMP() {
  const v = ventas.find((x) => x.id === pagoVentaId);
  if (!v) return;
  const monto = getMontoVenta();
  const alias = PAYMENT_CONFIG.mercadopago.alias;
  if (alias) {
    // MP link with amount pre-filled
    const url = `https://link.mercadopago.com.ar/${alias}`;
    // Copy amount to clipboard too
    navigator.clipboard?.writeText(String(monto)).catch(() => {});
    window.open(url, "_blank");
    toast(`💚 Abriendo MP · Monto copiado: ${fmt(monto)}`);
  } else {
    // Fallback — copy amount and open MP
    navigator.clipboard?.writeText(String(monto)).catch(() => {});
    window.open("https://www.mercadopago.com.ar/", "_blank");
    toast(`💚 Monto copiado al portapapeles: ${fmt(monto)}
Configurá tu alias en Ajustes`);
  }
  closeModal("modal-pago");
}

function cobrarTransferencia() {
  const monto = getMontoVenta();
  const cfg = PAYMENT_CONFIG.transferencia;
  const v = ventas.find((x) => x.id === pagoVentaId);
  const lines = [
    `💳 Datos de transferencia — Parfum Track`,
    ``,
    cfg.titular ? `Titular: ${cfg.titular}` : "",
    cfg.banco ? `Banco: ${cfg.banco}` : "",
    cfg.cbu ? `CBU/CVU: ${cfg.cbu}` : "",
    cfg.alias ? `Alias: ${cfg.alias}` : "",
    ``,
    `Perfume: ${v?.perfume || ""}`,
    `Monto: ${fmt(monto)}`,
    ``,
    `_${getProfileName(activeProfile) || "Parfum Track"}_ 🍶`,
  ]
    .filter(Boolean)
    .join("\n");

  navigator.clipboard
    ?.writeText(lines)
    .then(() => {
      toast("🏦 Datos copiados al portapapeles");
    })
    .catch(() => {
      // Fallback for mobile
      const el = document.createElement("textarea");
      el.value = lines;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      toast("🏦 Datos copiados al portapapeles");
    });
  closeModal("modal-pago");
}

function cobrarEfectivo() {
  const monto = getMontoVenta();
  closeModal("modal-pago");
  toast(`💵 Cobro en efectivo: ${fmt(monto)}`);
}

// ══════════════════════════════════════════════
// INIT — override unlockApp to show profile screen
// ══════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", function () {
  // Esperar IndexedDB antes de arrancar la app
  _appDataReady.then(function () {
    // Hide loading screen
    const loader = document.getElementById("app-loading");
    if (loader) loader.style.display = "none";
    // Attach modal backdrop close listeners
    [
      "modal-del-mes",
      "del-modal",
      "modal-cuota",
      "modal-editar",
      "modal-meta",
      "backup-modal",
      "pdf-modal",
      "modal-pago",
      "modal-perfil",
      "del-stock-modal",
      "modal-activacion",
      "modal-trial-bienvenida",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el)
        el.addEventListener("click", (e) => {
          if (e.target === el) closeModal(id);
        });
    });
    // Drag-drop on import zone
    const zone = document.getElementById("import-zone");
    if (zone) {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("drag");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("drag");
        const f = e.dataTransfer.files[0];
        if (f) handleImportFile({ target: { files: [f], value: "" } });
      });
    }
    // ── PIN SYSTEM — SHA-256, lockout, modal propio ──
    (function () {
      var PIN_HASH_KEY = "pt_pin_hash"; // Guardamos el hash, nunca el PIN en claro
      var PIN_LOCK_KEY = "pt_pin_lockout";
      var PIN_FAILS_KEY = "pt_pin_fails";
      var MAX_FAILS = 5;
      var LOCKOUT_MS = 5 * 60 * 1000; // 5 minutos
      var buf = "";
      var setupStep = 0; // 0=ingresar nuevo, 1=confirmar
      var setupFirst = ""; // primer ingreso para confirmar

      // ── Hash SHA-256 via SubtleCrypto (async) ──
      async function hashPIN(pin) {
        var enc = new TextEncoder().encode("pt_salt_2026_" + pin);
        var buf2 = await crypto.subtle.digest("SHA-256", enc);
        return Array.from(new Uint8Array(buf2))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }

      function hasPIN() {
        return !!localStorage.getItem(PIN_HASH_KEY);
      }

      // ── Lockout ──
      function isLockedOut() {
        var lockUntil = parseInt(localStorage.getItem(PIN_LOCK_KEY) || "0");
        return Date.now() < lockUntil;
      }
      function getLockRemaining() {
        var lockUntil = parseInt(localStorage.getItem(PIN_LOCK_KEY) || "0");
        return Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      }
      function recordFail() {
        var fails = parseInt(localStorage.getItem(PIN_FAILS_KEY) || "0") + 1;
        localStorage.setItem(PIN_FAILS_KEY, fails);
        if (fails >= MAX_FAILS) {
          localStorage.setItem(
            PIN_LOCK_KEY,
            (Date.now() + LOCKOUT_MS).toString(),
          );
          localStorage.setItem(PIN_FAILS_KEY, "0");
        }
        return fails;
      }
      function clearFails() {
        localStorage.removeItem(PIN_FAILS_KEY);
        localStorage.removeItem(PIN_LOCK_KEY);
      }

      // ── Dots: actualiza los 4 puntitos del teclado ──
      function updateDots(containerId) {
        var dots = document.querySelectorAll("#" + containerId + " .pdot");
        dots.forEach(function (d, i) {
          d.classList.toggle("on", i < buf.length);
        });
      }

      function showErrEl(elId, msg) {
        var el = document.getElementById(elId);
        if (!el) return;
        el.textContent = msg;
        setTimeout(function () {
          if (el) el.textContent = "";
        }, 2500);
      }

      // ── PANTALLA DE DESBLOQUEO (pin-screen) ──
      function initUnlockPad() {
        var pad = document.getElementById("pin-pad");
        if (!pad) return;
        pad.addEventListener("click", function (e) {
          var btn = e.target.closest(".pkey");
          if (!btn) return;
          handleUnlock(btn.dataset.action || btn.textContent.trim());
        });
      }

      function handleUnlock(val) {
        if (isLockedOut()) {
          showErrEl(
            "pin-err",
            "🔒 Bloqueado " + getLockRemaining() + "s. Intentá más tarde.",
          );
          return;
        }
        if (val === "back") {
          buf = buf.slice(0, -1);
          updateDots("pin-dots");
        } else if (val === "ok") {
          if (buf.length > 0) tryUnlock();
        } else if (buf.length < 4) {
          buf += val;
          updateDots("pin-dots");
          if (buf.length === 4) tryUnlock();
        }
      }

      async function tryUnlock() {
        if (isLockedOut()) {
          showErrEl("pin-err", "🔒 Bloqueado " + getLockRemaining() + "s.");
          buf = "";
          updateDots("pin-dots");
          return;
        }
        var h = await hashPIN(buf);
        var stored = localStorage.getItem(PIN_HASH_KEY);
        if (h === stored) {
          clearFails();
          var screen = document.getElementById("pin-screen");
          if (screen) screen.style.display = "none";
          buf = "";
          updateDots("pin-dots");
          enterAppAfterPin();
        } else {
          var fails = recordFail();
          buf = "";
          updateDots("pin-dots");
          if (isLockedOut()) {
            showErrEl("pin-err", "🔒 Demasiados intentos. Bloqueado 5 min.");
          } else {
            var left = MAX_FAILS - fails;
            showErrEl(
              "pin-err",
              "PIN incorrecto · " +
                (left > 0
                  ? left +
                    " intento" +
                    (left !== 1 ? "s" : "") +
                    " restante" +
                    (left !== 1 ? "s" : "")
                  : "Último intento"),
            );
            // Shake animation
            var dots = document.getElementById("pin-dots");
            if (dots) {
              dots.style.animation = "none";
              dots.offsetHeight;
              dots.style.animation = "shake-input .4s ease";
              setTimeout(function () {
                if (dots) dots.style.animation = "";
              }, 500);
            }
          }
        }
      }

      // ── MODAL DE SETUP (abrirSetupPin) ──
      window.abrirSetupPin = function () {
        setupStep = 0;
        setupFirst = "";
        buf = "";
        var hasPinActivo = hasPIN();
        if (hasPinActivo) {
          // Primero verificar el PIN actual
          setupStep = -1; // paso especial: verificar actual
          document.getElementById("pin-setup-emoji").textContent = "🔐";
          document.getElementById("pin-setup-title").textContent =
            "Verificar PIN actual";
          document.getElementById("pin-setup-desc").textContent =
            "Ingresá tu PIN actual para poder cambiarlo.";
        } else {
          document.getElementById("pin-setup-emoji").textContent = "🔑";
          document.getElementById("pin-setup-title").textContent = "Crear PIN";
          document.getElementById("pin-setup-desc").textContent =
            "Elegí un PIN de 4 dígitos para proteger el acceso a tu app.";
        }
        updateSetupDots();
        document.getElementById("modal-pin-setup").classList.add("open");
      };

      window.desactivarPin = function () {
        if (!hasPIN()) return;
        // Pedir confirmación con PIN actual
        setupStep = -2; // paso especial: verificar para desactivar
        buf = "";
        document.getElementById("pin-setup-emoji").textContent = "🔓";
        document.getElementById("pin-setup-title").textContent =
          "Desactivar PIN";
        document.getElementById("pin-setup-desc").textContent =
          "Ingresá tu PIN actual para confirmar que querés desactivar la protección.";
        updateSetupDots();
        document.getElementById("modal-pin-setup").classList.add("open");
      };

      function updateSetupDots() {
        var dots = document.querySelectorAll("#pin-setup-dots .pdot");
        dots.forEach(function (d, i) {
          d.classList.toggle("on", i < buf.length);
        });
      }

      function showSetupErr(msg) {
        showErrEl("pin-setup-err", msg);
      }

      async function handleSetupKey(val) {
        if (val === "back") {
          buf = buf.slice(0, -1);
          updateSetupDots();
          return;
        }
        if (val === "ok") {
          if (buf.length > 0) await processSetup();
          return;
        }
        if (buf.length < 4) {
          buf += val;
          updateSetupDots();
          if (buf.length === 4) await processSetup();
        }
      }

      async function processSetup() {
        if (setupStep === -1) {
          // Verificar PIN actual antes de cambiar
          var h = await hashPIN(buf);
          if (h !== localStorage.getItem(PIN_HASH_KEY)) {
            buf = "";
            updateSetupDots();
            showSetupErr("PIN incorrecto. Intentá de nuevo.");
            return;
          }
          // Correcto — pasar a ingresar nuevo
          setupStep = 0;
          buf = "";
          document.getElementById("pin-setup-emoji").textContent = "🔑";
          document.getElementById("pin-setup-title").textContent = "Nuevo PIN";
          document.getElementById("pin-setup-desc").textContent =
            "Ingresá tu nuevo PIN de 4 dígitos.";
          updateSetupDots();
          return;
        }
        if (setupStep === -2) {
          // Verificar PIN actual para desactivar
          var h2 = await hashPIN(buf);
          if (h2 !== localStorage.getItem(PIN_HASH_KEY)) {
            buf = "";
            updateSetupDots();
            showSetupErr("PIN incorrecto.");
            return;
          }
          localStorage.removeItem(PIN_HASH_KEY);
          clearFails();
          closeModal("modal-pin-setup");
          buf = "";
          actualizarCardPin();
          toast("🔓 PIN desactivado. La app ya no pedirá PIN al abrir.");
          return;
        }
        if (setupStep === 0) {
          // Primer ingreso del nuevo PIN
          if (buf === "0000" || buf === "1234" || /^(.)\1{3}$/.test(buf)) {
            showSetupErr("PIN demasiado simple. Elegí otro.");
            buf = "";
            updateSetupDots();
            return;
          }
          setupFirst = buf;
          buf = "";
          setupStep = 1;
          document.getElementById("pin-setup-emoji").textContent = "🔄";
          document.getElementById("pin-setup-title").textContent =
            "Confirmá el PIN";
          document.getElementById("pin-setup-desc").textContent =
            "Ingresá el mismo PIN de nuevo para confirmar.";
          updateSetupDots();
          return;
        }
        if (setupStep === 1) {
          // Confirmación
          if (buf !== setupFirst) {
            showSetupErr("Los PIN no coinciden. Empezá de nuevo.");
            setupStep = 0;
            setupFirst = "";
            buf = "";
            document.getElementById("pin-setup-emoji").textContent = "🔑";
            document.getElementById("pin-setup-title").textContent =
              "Nuevo PIN";
            document.getElementById("pin-setup-desc").textContent =
              "Ingresá tu nuevo PIN de 4 dígitos.";
            updateSetupDots();
            return;
          }
          // ¡Guardar el hash!
          var finalHash = await hashPIN(buf);
          localStorage.setItem(PIN_HASH_KEY, finalHash);
          clearFails();
          closeModal("modal-pin-setup");
          buf = "";
          setupFirst = "";
          setupStep = 0;
          actualizarCardPin();
          toast("✅ PIN configurado. Se pedirá al abrir la app.");
        }
      }

      // Setup pad event delegation
      var setupPad = document.getElementById("pin-setup-pad");
      if (setupPad) {
        setupPad.addEventListener("click", function (e) {
          var btn = e.target.closest(".pkey");
          if (!btn) return;
          handleSetupKey(btn.dataset.action || btn.textContent.trim());
        });
      }

      // ── Actualizar card de PIN en Ajustes ──
      function actualizarCardPin() {
        var desc = document.getElementById("pin-estado-desc");
        var btnConfig = document.getElementById("btn-configurar-pin");
        var btnDesact = document.getElementById("btn-desactivar-pin");
        if (!desc) return;
        if (hasPIN()) {
          desc.textContent = "✅ PIN activo. La app pedirá el PIN al abrirse.";
          desc.style.color = "var(--success)";
          if (btnConfig) btnConfig.textContent = "🔑 Cambiar PIN";
          if (btnDesact) btnDesact.style.display = "inline-flex";
        } else {
          desc.textContent =
            "Protegé el acceso a tu app con un PIN de 4 dígitos.";
          desc.style.color = "";
          if (btnConfig) btnConfig.textContent = "🔑 Configurar PIN";
          if (btnDesact) btnDesact.style.display = "none";
        }
      }
      window.actualizarCardPin = actualizarCardPin;

      // ── Inicializar pantalla de desbloqueo ──
      initUnlockPad();

      // ── Mostrar pantalla PIN o entrar directo ──
      if (location.search.includes("test")) {
        setTimeout(function () {
          enterAppAfterPin();
        }, 100);
        return;
      }

      if (hasPIN()) {
        var screen = document.getElementById("pin-screen");
        if (screen) {
          screen.style.display = "flex";
          buf = "";
          updateDots("pin-dots");
        }
      } else {
        // Sin PIN configurado → entrar directo
        enterAppAfterPin();
      }

      // Compatibilidad: exponer cambiarPin por si algún otro código lo llama
      window.cambiarPin = window.abrirSetupPin;
    })();
  }); // fin _appDataReady.then
});

async function enterAppAfterPin() {
  var profiles = getProfiles();
  if (profiles.length > 1) {
    showProfileScreen();
  } else {
    if (!profiles.length) {
      saveProfiles([
        {
          id: "default",
          name: "Mi Negocio",
          emoji: "🍶",
          createdAt: Date.now(),
        },
      ]);
    }
    await loadProfile(profiles[0] ? profiles[0].id : "default");
    enterApp();
  }
  checkBackupReminder();
  checkAutoBackup();
  checkTrial();
  checkOnboarding();
}

// ══════════════════════════════════════════════
// ONBOARDING: bienvenida + tour interactivo
// ══════════════════════════════════════════════
var TOUR_STEPS = [
  {
    tab: "add",
    target: "tabbtn-add",
    title: "✦ 1. Nueva venta",
    text: "Lo más importante: acá registrás cada venta al contado o en cuotas.",
  },
  {
    tab: "ventas",
    target: "tabbtn-ventas",
    title: "💰 2. Ventas",
    text: "Todas tus ventas del mes con ganancia, cliente y estado de cobro.",
  },
  {
    tab: "cuotas",
    target: "tabbtn-cuotas",
    title: "🗓 3. Cuotas",
    text: "Quien te debe y cuánto. Cobrás con un toque y mandás aviso por WhatsApp.",
  },
  {
    tab: "caja",
    target: "tabbtn-caja",
    title: "🏦 4. Caja",
    text: "Lo que entró y salió. Tu saldo siempre actualizado.",
  },
  {
    tab: "ajustes",
    target: "tabbtn-ajustes",
    title: "⚙ 5. Ajustes",
    text: "Backup, PIN y configuración. ¡Ya estás listo para empezar!",
  },
];
var tourIndex = 0;

function checkOnboarding() {
  if (localStorage.getItem("pt_onboarding_done")) return;
  // Pequeño delay para que la app termine de renderizar
  setTimeout(function () {
    var el = document.getElementById("ob-welcome-screen");
    if (el) el.classList.add("show");
  }, 600);
}

function cerrarOnboarding() {
  var el = document.getElementById("ob-welcome-screen");
  if (el) el.classList.remove("show");
  localStorage.setItem("pt_onboarding_done", "1");
}

function iniciarTour() {
  var el = document.getElementById("ob-welcome-screen");
  if (el) el.classList.remove("show");
  tourIndex = 0;
  document.getElementById("tour-backdrop").classList.add("show");
  mostrarPasoTour();
}

function mostrarPasoTour() {
  var step = TOUR_STEPS[tourIndex];
  // Cambiar a la tab correspondiente para que se vea el contexto
  if (typeof showTab === "function") showTab(step.tab);

  setTimeout(function () {
    var target = document.getElementById(step.target);
    var hl = document.getElementById("tour-highlight");
    var tip = document.getElementById("tour-tip");
    if (!target) {
      tourSiguiente();
      return;
    }

    var r = target.getBoundingClientRect();
    // Resaltar el botón
    hl.style.left = r.left - 4 + "px";
    hl.style.top = r.top - 4 + "px";
    hl.style.width = r.width + 8 + "px";
    hl.style.height = r.height + 8 + "px";
    hl.classList.add("show");

    // Texto del tooltip
    document.getElementById("tour-tip-title").textContent = step.title;
    document.getElementById("tour-tip-text").textContent = step.text;
    document.getElementById("tour-progress").textContent =
      tourIndex + 1 + " / " + TOUR_STEPS.length;
    document.getElementById("tour-next-btn").textContent =
      tourIndex === TOUR_STEPS.length - 1 ? "¡Empezar!" : "Siguiente";

    // Posicionar el tooltip cerca del botón
    tip.classList.add("show");
    var tipRect = tip.getBoundingClientRect();
    var vw = window.innerWidth,
      vh = window.innerHeight;
    var left, top;
    // Si es desktop (tabs a la izquierda) el tip va a la derecha; en mobile, abajo
    if (vw > 768) {
      left = r.right + 16;
      top = r.top;
      if (left + tipRect.width > vw - 12) left = r.left - tipRect.width - 16;
    } else {
      left = 16;
      top = r.bottom + 12;
      if (top + tipRect.height > vh - 12) top = r.top - tipRect.height - 12;
    }
    left = Math.max(12, Math.min(left, vw - tipRect.width - 12));
    top = Math.max(12, Math.min(top, vh - tipRect.height - 12));
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }, 200);
}

function tourSiguiente() {
  tourIndex++;
  if (tourIndex >= TOUR_STEPS.length) {
    terminarTour();
    return;
  }
  mostrarPasoTour();
}

function terminarTour() {
  document.getElementById("tour-backdrop").classList.remove("show");
  document.getElementById("tour-highlight").classList.remove("show");
  document.getElementById("tour-tip").classList.remove("show");
  localStorage.setItem("pt_onboarding_done", "1");
  if (typeof showTab === "function") showTab("ventas");
  if (typeof toast === "function")
    toast("🎉 ¡Listo! Ya podés empezar a usar Parfum Track");
}

// Permite reabrir el tour desde Ajustes
function reiniciarTour() {
  localStorage.removeItem("pt_onboarding_done");
  tourIndex = 0;
  iniciarTour();
}
window.reiniciarTour = reiniciarTour;

// ══════════════════════════════════════════════
// BOTTOM NAV — lógica de estado y drawer
// ══════════════════════════════════════════════
var masTabsSet = ["caja", "stock", "catalogo", "gastos", "importar", "ajustes"];
var bottomNavMap = {
  ventas: "bn-ventas",
  cuotas: "bn-cuotas",
  add: "bn-add",
  ganancias: "bn-ganancias",
};

// Sobrescribir showTab para actualizar el bottom nav
var _origShowTab = showTab;
showTab = function (t) {
  _origShowTab(t);
  updateBottomNav(t);
};

function updateBottomNav(t) {
  // Limpiar todos los activos
  document
    .querySelectorAll(".bn-item")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".mas-item")
    .forEach((b) => b.classList.remove("active"));

  // Activar el botón correcto
  if (bottomNavMap[t]) {
    var btn = document.getElementById(bottomNavMap[t]);
    if (btn) btn.classList.add("active");
  } else if (masTabsSet.includes(t)) {
    // Las del drawer: resaltar el botón "Más"
    var masBtn = document.getElementById("bn-mas");
    if (masBtn) masBtn.classList.add("active");
    var masItem = document.getElementById("masitem-" + t);
    if (masItem) masItem.classList.add("active");
  }

  // Badge de cuotas pendientes
  updateCuotasBadge();
}

function updateCuotasBadge() {
  var pendientes =
    typeof ventas !== "undefined"
      ? ventas.filter(function (v) {
          return (
            v.esCuotas && typeof calcDebe === "function" && calcDebe(v) > 0
          );
        }).length
      : 0;
  var badge = document.getElementById("bn-badge-cuotas");
  if (badge) {
    badge.textContent =
      pendientes > 0 ? (pendientes > 9 ? "9+" : pendientes) : "";
    badge.classList.toggle("show", pendientes > 0);
  }
}

function abrirMas() {
  document.getElementById("mas-overlay").classList.add("open");
}

function cerrarMas() {
  document.getElementById("mas-overlay").classList.remove("open");
}

function showTabFromMas(t) {
  cerrarMas();
  // Pequeño delay para que el drawer cierre suavemente antes de renderizar
  setTimeout(function () {
    showTab(t);
  }, 80);
}

// Actualizar badge cada vez que se guardan datos
var _origSave = typeof save === "function" ? save : null;
if (_origSave) {
  save = function () {
    _origSave();
    updateCuotasBadge();
  };
}

// Init badge al cargar
setTimeout(updateCuotasBadge, 800);

// ════════════════════════════════════════════
const BACKUP_WARN_DAYS = 3; // Mostrar banner después de X días sin backup
const BACKUP_DANGER_DAYS = 7; // Nivel crítico

function updateSyncStatus() {
  const lastBackup = localStorage.getItem("pt_last_backup");
  const pill = document.getElementById("sync-status-pill");
  const label = document.getElementById("sync-status-label");
  if (!pill || !label) return;
  const isMobile = window.innerWidth < 520;

  if (!lastBackup) {
    pill.className = "sync-status-pill danger";
    label.textContent = isMobile ? "⚠" : "Sin backup";
    return;
  }

  const days = Math.floor((Date.now() - parseInt(lastBackup)) / 86400000);

  if (days === 0) {
    pill.className = "sync-status-pill ok";
    label.textContent = isMobile ? "💾" : "Backup hoy";
  } else if (days < BACKUP_WARN_DAYS) {
    pill.className = "sync-status-pill ok";
    label.textContent = isMobile ? "💾" : "Hace " + days + "d";
  } else if (days < BACKUP_DANGER_DAYS) {
    pill.className = "sync-status-pill warn";
    label.textContent = isMobile ? "⚠" : "Hace " + days + "d";
  } else {
    pill.className = "sync-status-pill danger";
    label.textContent = isMobile ? "⚠" : "Hace " + days + "d ⚠";
  }
}

function checkBackupProactiveBanner() {
  if (!localStorage.getItem("pt_onboarding_done")) return;
  if (ventas.length === 0) return;
  // Si el modal de backup ya está abierto, no mostrar el banner encima
  const modalAbierto =
    document.getElementById("backup-modal") &&
    document.getElementById("backup-modal").classList.contains("open");
  if (modalAbierto) return;

  const lastBackup = localStorage.getItem("pt_last_backup");
  const snooze = localStorage.getItem("pt_backup_banner_snooze");

  // Verificar snooze (8 horas)
  if (snooze && Date.now() - parseInt(snooze) < 8 * 60 * 60 * 1000) return;

  let showBanner = false;
  let title = "💾 Hacé un backup hoy";
  let desc =
    "Guardá tus datos para no perderlos si cambiás de dispositivo o borrás el caché del navegador.";

  if (!lastBackup) {
    showBanner = true;
    title = "⚠ Nunca hiciste un backup";
    desc =
      "Tenés " +
      ventas.length +
      " ventas sin respaldar. Si algo pasa con tu dispositivo, perdés todo.";
  } else {
    const days = Math.floor((Date.now() - parseInt(lastBackup)) / 86400000);
    if (days >= BACKUP_DANGER_DAYS) {
      showBanner = true;
      title = "🔴 Tu último backup fue hace " + days + " días";
      desc =
        "Tus datos están en riesgo. Descargá un backup o generá un QR ahora.";
    } else if (days >= BACKUP_WARN_DAYS) {
      showBanner = true;
      title = "💾 Hace " + days + " días sin backup";
      desc =
        "Es un buen momento para guardar una copia de tus " +
        ventas.length +
        " ventas.";
    }
  }

  if (showBanner) {
    document.getElementById("bpb-title").textContent = title;
    document.getElementById("bpb-desc").textContent = desc;
    setTimeout(() => {
      const backupModalOpen =
        document.getElementById("backup-modal") &&
        document.getElementById("backup-modal").classList.contains("open");
      if (!backupModalOpen) {
        document
          .getElementById("backup-proactive-banner")
          .classList.add("show");
      }
    }, 3500);
  }
}

function cerrarBackupBanner() {
  document.getElementById("backup-proactive-banner").classList.remove("show");
  localStorage.setItem("pt_backup_banner_snooze", Date.now().toString());
}

function backupDesdeBanner() {
  backupData();
  document.getElementById("backup-proactive-banner").classList.remove("show");
  updateSyncStatus();
}

function snoozeBackupBanner() {
  cerrarBackupBanner();
  toast("⏰ Te recordamos en 8 horas");
}

// updateSyncStatus ya es llamado directamente desde backupData()

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", function () {
  // Actualizar pill de estado de backup
  updateSyncStatus();
  // Mostrar banner proactivo de backup si aplica
  checkBackupProactiveBanner();
});

// También actualizar pill cuando se accede a ajustes
const _origShowTab2 = showTab;
showTab = function (t) {
  _origShowTab2(t);
  if (t === "ajustes") {
    updateSyncStatus();
  }
};

// ══════════════════════════════════
// LAZY-LOAD CDNs — se cargan solo cuando se necesitan
// ══════════════════════════════════
const CDN_CHART =
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js";
const CDN_JSPDF =
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const CDN_XLSX =
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureChart() {
  if (typeof Chart !== "undefined") return true;
  try {
    await loadScript(CDN_CHART);
    return typeof Chart !== "undefined";
  } catch (e) {
    toast("📶 Necesitás internet para ver los gráficos");
    return false;
  }
}

async function ensureJsPDF() {
  if (typeof window.jspdf !== "undefined" || typeof jsPDF !== "undefined")
    return true;
  try {
    await loadScript(CDN_JSPDF);
    return true;
  } catch (e) {
    toast("📶 Necesitás internet para generar el PDF");
    return false;
  }
}

async function ensureXLSX() {
  if (typeof XLSX !== "undefined") return true;
  try {
    await loadScript(CDN_XLSX);
    return true;
  } catch (e) {
    toast("📶 Necesitás internet para exportar a Excel");
    return false;
  }
}

// ════════════════════════════════════════════
// ESTADO DEL CATÁLOGO
// ════════════════════════════════════════════
let catModoSeleccion = false;
let catSeleccionados = new Set(); // nombres de perfumes seleccionados
let catTema = "dark";
let catPerfumesParaRender = []; // los que se van a dibujar
let catPaginaActual = 0;
const CAT_POR_PAGINA = 12;

// ─── RENDER PRINCIPAL ───
function renderCatalogo() {
  const q = (
    document.getElementById("search-catalogo").value || ""
  ).toLowerCase();
  const todos = perfumes.filter((p) => p.nombre.toLowerCase().includes(q));

  const el = document.getElementById("catalogo-grid");
  if (!todos.length) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="empty-icon">🛍</div>
      <p>${perfumes.length ? "No hay perfumes con ese nombre." : "Aún no hay perfumes.<br>Agregá desde Stock."}</p>
    </div>`;
    return;
  }

  // Ordenar: con stock primero
  const sorted = [...todos].sort((a, b) => (b.stock || 0) - (a.stock || 0));

  el.className = "catalogo-grid" + (catModoSeleccion ? " modo-seleccion" : "");

  el.innerHTML = sorted
    .map((p) => {
      const thumb = p.foto
        ? `<img src="${p.foto}" alt="${p.nombre}" onerror="this.style.display='none'">`
        : "🍶";
      const stockN = p.stock || 0;
      const stockBadge =
        stockN === 0
          ? `<span class="cat-stock-badge cat-stock-out">Sin stock</span>`
          : stockN <= (p.stockMin || 3)
            ? `<span class="cat-stock-badge cat-stock-low">${stockN} uds</span>`
            : `<span class="cat-stock-badge cat-stock-ok">${stockN} uds</span>`;
      const isSel = catSeleccionados.has(p.nombre);
      const sinStockCls = stockN === 0 ? " sin-stock" : "";
      const selCls = isSel ? " seleccionado" : "";
      return `<div class="cat-card-v2${selCls}${sinStockCls}" onclick="toggleSeleccionPerfume('${p.nombre.replace(/'/g, "\\'")}')">
      <div class="cat-card-img-v2">
        ${thumb}
        ${stockBadge}
        <div class="cat-sel-check">${isSel ? "✓" : ""}</div>
      </div>
      <div class="cat-card-info-v2">
        <div class="cat-card-name-v2">${p.nombre}</div>
        <div class="cat-card-price-v2">${p.pVenta ? fmt(p.pVenta) : p.precio ? fmt(p.precio) : "—"}</div>
        ${p.ml ? `<div class="cat-card-ml-v2">${p.ml} ml</div>` : ""}
      </div>
    </div>`;
    })
    .join("");

  actualizarSelCount();
}

// ─── MODO SELECCIÓN ───
function toggleModoSeleccion() {
  catModoSeleccion = !catModoSeleccion;
  const btn = document.getElementById("btn-modo-seleccion");
  const panel = document.getElementById("catalogo-sel-panel");
  const btnShare = document.getElementById("btn-share-seleccion");
  const btnConStock = document.querySelector(
    '[onclick="compartirCatalogoConStock()"]',
  );

  if (catModoSeleccion) {
    btn.style.background = "var(--gold)";
    btn.style.color = "#1a1a2e";
    btn.textContent = "✕ Cancelar";
    panel.style.display = "block";
    btnShare.style.display = "flex";
    btnConStock.style.display = "none";
    // Pre-seleccionar los que tienen stock
    catSeleccionados = new Set(
      perfumes.filter((p) => (p.stock || 0) > 0).map((p) => p.nombre),
    );
  } else {
    btn.style.background = "var(--gold-dim)";
    btn.style.color = "var(--gold2)";
    btn.textContent = "☑ Seleccionar";
    panel.style.display = "none";
    btnShare.style.display = "none";
    btnConStock.style.display = "flex";
  }
  renderCatalogo();
}

function toggleSeleccionPerfume(nombre) {
  if (!catModoSeleccion) return;
  if (catSeleccionados.has(nombre)) {
    catSeleccionados.delete(nombre);
  } else {
    catSeleccionados.add(nombre);
  }
  actualizarSelCount();
  renderCatalogo();
}

function actualizarSelCount() {
  const el = document.getElementById("sel-count-label");
  if (el) el.textContent = catSeleccionados.size + " seleccionados";
}

function seleccionarTodosConStock() {
  catSeleccionados = new Set(
    perfumes.filter((p) => (p.stock || 0) > 0).map((p) => p.nombre),
  );
  actualizarSelCount();
  renderCatalogo();
}

function seleccionarTodos() {
  catSeleccionados = new Set(perfumes.map((p) => p.nombre));
  actualizarSelCount();
  renderCatalogo();
}

function deseleccionarTodos() {
  catSeleccionados.clear();
  actualizarSelCount();
  renderCatalogo();
}

// ─── INICIAR COMPARTIR ───
function compartirCatalogoConStock() {
  const lista = perfumes.filter((p) => (p.stock || 0) > 0 && p.pVenta);
  if (!lista.length) {
    toast("⚠ No hay perfumes con stock y precio de venta configurado.");
    return;
  }
  catPerfumesParaRender = lista;
  abrirPreviewCatalogo();
}

function compartirCatalogoSeleccion() {
  if (!catSeleccionados.size) {
    toast("⚠ Seleccioná al menos un perfume.");
    return;
  }
  const lista = perfumes.filter((p) => catSeleccionados.has(p.nombre));
  if (!lista.length) return;
  catPerfumesParaRender = lista;
  abrirPreviewCatalogo();
}

// ─── ABRIR MODAL PREVIEW ───
function abrirPreviewCatalogo() {
  catPaginaActual = 0;
  const totalPaginas = Math.ceil(catPerfumesParaRender.length / CAT_POR_PAGINA);
  const hayMultiples = totalPaginas > 1;

  document.getElementById("modal-catalogo-preview").classList.add("open");
  document.getElementById("cat-canvas-loading").style.display = "flex";

  // Mostrar/ocultar paginación
  const panelPag = document.getElementById("cat-paginacion");
  panelPag.style.display = hayMultiples ? "flex" : "none";

  // Botones multi-página
  const btnTodas = document.getElementById("btn-descargar-todas");
  const btnCompartirTodas = document.getElementById("btn-compartir-todas");
  const btnWaEsta = document.getElementById("btn-wa-esta");
  if (btnTodas) btnTodas.style.display = hayMultiples ? "flex" : "none";
  if (btnCompartirTodas)
    btnCompartirTodas.style.display = hayMultiples ? "block" : "none";
  // Renombrar botón WA según contexto
  if (btnWaEsta)
    btnWaEsta.textContent = hayMultiples ? "💬 Esta foto" : "💬 WhatsApp";

  actualizarInfoPaginacion();

  // Contador total
  document.getElementById("cat-preview-count").textContent =
    catPerfumesParaRender.length +
    " perfumes" +
    (hayMultiples ? " · " + totalPaginas + " fotos de 12" : "");

  // Cargar pie de página desde localStorage si existe
  const pieGuardado = localStorage.getItem("pt_cat_pie") || "";
  document.getElementById("cat-pie-input").value = pieGuardado;

  setTimeout(() => generarCanvasCatalogo(), 100);
}

// ─── GENERAR CANVAS ───
async function generarCanvasCatalogo() {
  const canvas = document.getElementById("catalogo-canvas");
  const loading = document.getElementById("cat-canvas-loading");

  const titulo =
    document.getElementById("cat-titulo-input").value ||
    "🍶 Perfumes disponibles";
  const pie = document.getElementById("cat-pie-input").value || "";

  // Guardar pie para próxima vez
  if (pie) localStorage.setItem("pt_cat_pie", pie);

  // Página actual — máximo 12 perfumes
  const inicio = catPaginaActual * CAT_POR_PAGINA;
  const perfumesLista = catPerfumesParaRender.slice(
    inicio,
    inicio + CAT_POR_PAGINA,
  );
  const totalPaginas = Math.ceil(catPerfumesParaRender.length / CAT_POR_PAGINA);

  // Agregar número de página al pie si hay varias
  const pieFinal =
    totalPaginas > 1
      ? (pie ? pie + " · " : "") +
        "Foto " +
        (catPaginaActual + 1) +
        "/" +
        totalPaginas
      : pie;

  const cols =
    perfumesLista.length <= 2 ? 2 : perfumesLista.length <= 6 ? 3 : 4;
  const rows = Math.ceil(perfumesLista.length / cols);

  // Dimensiones de la imagen final (escala alta para calidad)
  const SCALE = Math.max(2, window.devicePixelRatio || 2);
  const CARD_W = 160;
  const TEXT_AREA = 58; // px para nombre (2 líneas) + ml + precio
  const CARD_H = CARD_W + TEXT_AREA; // 218px total
  const PAD = 18;
  const HEADER_H = 80;
  const FOOTER_H = pieFinal ? 55 : 30;
  const GAP = 10;

  const W = cols * CARD_W + (cols - 1) * GAP + PAD * 2;
  const H = HEADER_H + rows * CARD_H + (rows - 1) * GAP + PAD * 2 + FOOTER_H;

  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  canvas.style.width = "100%";
  canvas.style.height = "auto";

  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  // ─ TEMAS ─
  const temas = {
    dark: {
      bg: "#0f0f1a",
      bg2: "#1a1a2e",
      card: "#1e1e35",
      gold: "#e8c97e",
      text: "#f0ece4",
      text2: "#9e9bbf",
      border: "rgba(201,168,76,0.25)",
    },
    light: {
      bg: "#f5f0e8",
      bg2: "#ede8dc",
      card: "#ffffff",
      gold: "#a07830",
      text: "#1a1410",
      text2: "#5a4e3a",
      border: "rgba(160,120,48,0.2)",
    },
    gold: {
      bg: "#1a1200",
      bg2: "#2a1f00",
      card: "#1e1900",
      gold: "#e8c97e",
      text: "#f5dfa0",
      text2: "#c9a84c",
      border: "rgba(232,201,126,0.3)",
    },
  };
  const T = temas[catTema] || temas.dark;

  // ─ FONDO ─
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, W, H);

  // ─ HEADER ─
  // Gradiente sutil
  const grad = ctx.createLinearGradient(0, 0, W, HEADER_H);
  grad.addColorStop(0, T.bg2);
  grad.addColorStop(1, T.bg);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, HEADER_H);

  // Línea dorada
  ctx.fillStyle = T.gold;
  ctx.fillRect(PAD, HEADER_H - 2, W - PAD * 2, 1.5);

  // Texto del título
  ctx.fillStyle = T.gold;
  ctx.font = `bold ${catTema === "dark" ? 22 : 20}px 'Cormorant Garamond', Georgia, serif`;
  ctx.textAlign = "center";
  ctx.fillText(titulo, W / 2, HEADER_H / 2 + 4);
  ctx.font = `300 11px 'DM Sans', Arial, sans-serif`;
  ctx.fillStyle = T.text2;
  ctx.fillText(
    new Date().toLocaleDateString("es-AR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    W / 2,
    HEADER_H / 2 + 20,
  );

  // ─ TARJETAS ─
  const startY = HEADER_H + PAD;
  const startX = PAD;

  // Cargar todas las imágenes primero
  const imgCache = {};
  await Promise.all(
    perfumesLista.map(
      (p) =>
        new Promise((res) => {
          if (!p.foto) {
            res();
            return;
          }
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            imgCache[p.nombre] = img;
            res();
          };
          img.onerror = () => res();
          img.src = p.foto;
        }),
    ),
  );

  perfumesLista.forEach((p, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = startX + col * (CARD_W + GAP);
    const y = startY + row * (CARD_H + GAP);

    // Card background con borde redondeado
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + CARD_W - r, y);
    ctx.quadraticCurveTo(x + CARD_W, y, x + CARD_W, y + r);
    ctx.lineTo(x + CARD_W, y + CARD_H - r);
    ctx.quadraticCurveTo(x + CARD_W, y + CARD_H, x + CARD_W - r, y + CARD_H);
    ctx.lineTo(x + r, y + CARD_H);
    ctx.quadraticCurveTo(x, y + CARD_H, x, y + CARD_H - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = T.card;
    ctx.fill();
    ctx.strokeStyle = T.border;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Área de foto
    const IMG_H = CARD_W; // foto cuadrada = mismo ancho que la tarjeta
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + CARD_W - r, y);
    ctx.quadraticCurveTo(x + CARD_W, y, x + CARD_W, y + r);
    ctx.lineTo(x + CARD_W, y + IMG_H);
    ctx.lineTo(x, y + IMG_H);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.clip();

    if (imgCache[p.nombre]) {
      // Dibujar imagen con object-fit: cover
      const img = imgCache[p.nombre];
      const ratio = Math.max(CARD_W / img.width, IMG_H / img.height);
      const dw = img.width * ratio;
      const dh = img.height * ratio;
      ctx.drawImage(img, x + (CARD_W - dw) / 2, y + (IMG_H - dh) / 2, dw, dh);
      // Overlay sutil
      const overlay = ctx.createLinearGradient(x, y, x, y + IMG_H);
      overlay.addColorStop(0, "rgba(0,0,0,0)");
      overlay.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = overlay;
      ctx.fillRect(x, y, CARD_W, IMG_H);
    } else {
      // Placeholder
      const bg2 = ctx.createLinearGradient(x, y, x + CARD_W, y + IMG_H);
      bg2.addColorStop(0, T.bg2);
      bg2.addColorStop(1, T.bg);
      ctx.fillStyle = bg2;
      ctx.fillRect(x, y, CARD_W, IMG_H);
      ctx.font = "40px serif";
      ctx.textAlign = "center";
      ctx.fillText("🍶", x + CARD_W / 2, y + IMG_H / 2 + 14);
    }
    ctx.restore();

    // Info de la tarjeta
    const INFO_PAD = 8;
    const maxTxtW = CARD_W - INFO_PAD * 2;
    const cx2 = x + CARD_W / 2;
    ctx.textAlign = "center";

    // Partir nombre en palabras y armar líneas que entren en maxTxtW
    function wrapName(ctx2, texto, fontFn, startSz, maxW) {
      let sz = startSz;
      ctx2.font = fontFn(sz);
      // Si entra en 1 línea
      if (ctx2.measureText(texto).width <= maxW) return { lines: [texto], sz };
      // Intentar 2 líneas
      const words = texto.split(" ");
      let best = null;
      for (let i = 1; i < words.length; i++) {
        const l1 = words.slice(0, i).join(" ");
        const l2 = words.slice(i).join(" ");
        if (
          ctx2.measureText(l1).width <= maxW &&
          ctx2.measureText(l2).width <= maxW
        ) {
          best = [l1, l2];
          break;
        }
      }
      if (best) return { lines: best, sz: Math.max(sz - 1, 8) };
      // Reducir fuente y truncar
      while (sz > 7 && ctx2.measureText(texto).width > maxW) {
        sz--;
        ctx2.font = fontFn(sz);
      }
      let t = texto;
      while (ctx2.measureText(t).width > maxW && t.length > 3)
        t = t.slice(0, -2) + "…";
      return { lines: [t], sz };
    }

    const infoY = y + IMG_H + 11;
    const nFontFn = (sz) => `600 ${sz}px 'Cormorant Garamond', Georgia, serif`;
    const { lines: nLines, sz: nSz } = wrapName(
      ctx,
      p.nombre,
      nFontFn,
      12,
      maxTxtW,
    );

    ctx.fillStyle = T.text;
    ctx.font = nFontFn(nSz);
    const lineH = nSz * 1.3;
    nLines.forEach((ln, li) => ctx.fillText(ln, cx2, infoY + li * lineH));
    let curY = infoY + nLines.length * lineH + 3;

    // ML
    if (p.ml) {
      ctx.fillStyle = T.text2;
      ctx.font = `300 9px 'DM Sans', Arial, sans-serif`;
      ctx.fillText(p.ml + " ml", cx2, curY);
      curY += 11;
    }

    // Precio — tamaño fijo 13px, se reduce si no entra
    const precioStr = p.pVenta ? fmt(p.pVenta) : "—";
    const pFontFn = (sz) => `600 ${sz}px 'Cormorant Garamond', Georgia, serif`;
    let pSz = 13;
    ctx.font = pFontFn(pSz);
    while (ctx.measureText(precioStr).width > maxTxtW && pSz > 8) {
      pSz--;
      ctx.font = pFontFn(pSz);
    }
    ctx.fillStyle = T.gold;
    ctx.fillText(precioStr, cx2, curY + 2);
  });

  // ─ FOOTER ─
  const footerY = startY + rows * CARD_H + (rows - 1) * GAP + PAD;

  // Línea separadora
  ctx.fillStyle = T.border;
  ctx.fillRect(PAD, footerY, W - PAD * 2, 0.5);

  if (pieFinal) {
    ctx.textAlign = "center";
    ctx.fillStyle = T.text2;
    ctx.font = `400 12px 'DM Sans', Arial, sans-serif`;
    ctx.fillText(pieFinal, W / 2, footerY + 22);
  }

  // Marca de agua sutil
  ctx.textAlign = "center";
  ctx.fillStyle =
    catTema === "dark" ? "rgba(201,168,76,0.25)" : "rgba(160,120,48,0.2)";
  ctx.font = `300 9px 'DM Sans', Arial, sans-serif`;
  ctx.fillText("Parfum Track", W / 2, H - 8);

  loading.style.display = "none";
}

function regenerarCatalogoCanvas() {
  const loading = document.getElementById("cat-canvas-loading");
  if (loading) loading.style.display = "flex";
  clearTimeout(window._catRegenTimeout);
  window._catRegenTimeout = setTimeout(() => generarCanvasCatalogo(), 400);
}

// ─── PAGINACIÓN ───
function actualizarInfoPaginacion() {
  const total = catPerfumesParaRender.length;
  const totalPaginas = Math.ceil(total / CAT_POR_PAGINA);
  const inicio = catPaginaActual * CAT_POR_PAGINA + 1;
  const fin = Math.min((catPaginaActual + 1) * CAT_POR_PAGINA, total);

  const label = document.getElementById("cat-pagina-label");
  const sub = document.getElementById("cat-pagina-sub");
  const btnPrev = document.getElementById("cat-btn-prev");
  const btnNext = document.getElementById("cat-btn-next");

  if (label)
    label.textContent = "Foto " + (catPaginaActual + 1) + " de " + totalPaginas;
  if (sub)
    sub.textContent = "Perfumes " + inicio + " al " + fin + " de " + total;
  if (btnPrev) btnPrev.disabled = catPaginaActual === 0;
  if (btnPrev) btnPrev.style.opacity = catPaginaActual === 0 ? "0.4" : "1";
  if (btnNext) btnNext.disabled = catPaginaActual >= totalPaginas - 1;
  if (btnNext)
    btnNext.style.opacity = catPaginaActual >= totalPaginas - 1 ? "0.4" : "1";
}

function catCambiarPagina(dir) {
  const totalPaginas = Math.ceil(catPerfumesParaRender.length / CAT_POR_PAGINA);
  const nueva = catPaginaActual + dir;
  if (nueva < 0 || nueva >= totalPaginas) return;
  catPaginaActual = nueva;
  actualizarInfoPaginacion();
  const loading = document.getElementById("cat-canvas-loading");
  if (loading) loading.style.display = "flex";
  setTimeout(() => generarCanvasCatalogo(), 100);
}

// ─── DESCARGAR TODAS LAS FOTOS ───
async function descargarTodasLasFotos() {
  const totalPaginas = Math.ceil(catPerfumesParaRender.length / CAT_POR_PAGINA);
  if (totalPaginas <= 1) {
    descargarImagenCatalogo();
    return;
  }

  const loading = document.getElementById("cat-canvas-loading");
  const paginaOriginal = catPaginaActual;
  toast("⏳ Generando " + totalPaginas + " fotos...", 3000);

  for (let pg = 0; pg < totalPaginas; pg++) {
    catPaginaActual = pg;
    actualizarInfoPaginacion();
    if (loading) loading.style.display = "flex";
    await generarCanvasCatalogo();
    await new Promise((r) => setTimeout(r, 300));
    const canvas = document.getElementById("catalogo-canvas");
    const link = document.createElement("a");
    const fecha = new Date().toLocaleDateString("es-AR").replace(/\//g, "-");
    link.download = "catalogo-parfum-" + fecha + "-foto" + (pg + 1) + ".png";
    link.href = canvas.toDataURL("image/png", 0.95);
    link.click();
    await new Promise((r) => setTimeout(r, 500));
  }

  catPaginaActual = paginaOriginal;
  actualizarInfoPaginacion();
  await generarCanvasCatalogo();
  toast("✅ " + totalPaginas + " fotos descargadas", 3000);
}

// ─── COMPARTIR TODAS LAS FOTOS DE UNA VEZ ───
async function compartirTodasLasFotos() {
  const totalPaginas = Math.ceil(catPerfumesParaRender.length / CAT_POR_PAGINA);
  if (totalPaginas <= 1) {
    compartirImagenCatalogo();
    return;
  }

  const loading = document.getElementById("cat-canvas-loading");
  const paginaOriginal = catPaginaActual;
  const titulo =
    document.getElementById("cat-titulo-input").value ||
    "🍶 Perfumes disponibles";
  const pie = document.getElementById("cat-pie-input").value || "";

  // Mostrar loading mientras genera
  if (loading) loading.style.display = "flex";
  toast("⏳ Preparando " + totalPaginas + " fotos...", 4000);

  try {
    // Generar todos los blobs
    const archivos = [];
    for (let pg = 0; pg < totalPaginas; pg++) {
      catPaginaActual = pg;
      actualizarInfoPaginacion();
      await generarCanvasCatalogo();
      await new Promise((r) => setTimeout(r, 200));
      const blob = await getCanvasBlob();
      const fecha = new Date().toLocaleDateString("es-AR").replace(/\//g, "-");
      archivos.push(
        new File(
          [blob],
          "catalogo-parfum-" + fecha + "-foto" + (pg + 1) + ".png",
          { type: "image/png" },
        ),
      );
    }

    // Restaurar página original en el canvas
    catPaginaActual = paginaOriginal;
    actualizarInfoPaginacion();
    await generarCanvasCatalogo();

    // Intentar Web Share API con múltiples archivos (funciona en Android Chrome, Samsung, etc.)
    if (navigator.canShare && navigator.canShare({ files: archivos })) {
      const lineasTodas = catPerfumesParaRender.map(
        (p) =>
          `🍶 *${p.nombre}*${p.ml ? " " + p.ml + "ml" : ""} — *${p.pVenta ? fmt(p.pVenta) : "—"}*`,
      );
      await navigator.share({
        files: archivos,
        title: titulo,
        text:
          titulo + "\n\n" + lineasTodas.join("\n") + (pie ? "\n\n" + pie : ""),
      });
      toast("📤 ¡Todas las fotos compartidas!", 3000);
    } else {
      // Fallback: descargar todas + abrir WhatsApp con la lista completa
      for (const archivo of archivos) {
        const url = URL.createObjectURL(archivo);
        const link = document.createElement("a");
        link.href = url;
        link.download = archivo.name;
        link.click();
        URL.revokeObjectURL(url);
        await new Promise((r) => setTimeout(r, 400));
      }
      // Abrir WhatsApp con lista completa
      setTimeout(() => {
        const lineas = catPerfumesParaRender.map(
          (p) =>
            `🍶 *${p.nombre}*${p.ml ? " " + p.ml + "ml" : ""} — *${p.pVenta ? fmt(p.pVenta) : "—"}*`,
        );
        const msg = encodeURIComponent(
          `*${titulo}*\n\n` + lineas.join("\n") + (pie ? `\n\n${pie}` : ""),
        );
        window.open("https://wa.me/?text=" + msg, "_blank");
        toast(
          "📲 " +
            totalPaginas +
            " fotos descargadas · WhatsApp abierto con lista completa",
          4000,
        );
      }, 600);
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      // Si falla el share, intentar descargar todo
      toast("⚠ No se pudo compartir. Descargando fotos...", 3000);
      catPaginaActual = paginaOriginal;
      actualizarInfoPaginacion();
      await generarCanvasCatalogo();
      await descargarTodasLasFotos();
    } else {
      // Usuario canceló el share — restaurar vista
      catPaginaActual = paginaOriginal;
      actualizarInfoPaginacion();
      await generarCanvasCatalogo();
    }
  }
}

function setCatTema(tema) {
  catTema = tema;
  document
    .querySelectorAll(".cat-tema-btn")
    .forEach((b) => b.classList.remove("cat-tema-active"));
  document.getElementById("tema-" + tema).classList.add("cat-tema-active");
  regenerarCatalogoCanvas();
}

// ─── COMPARTIR / DESCARGAR ───
function getCanvasBlob() {
  return new Promise((res) => {
    document
      .getElementById("catalogo-canvas")
      .toBlob((blob) => res(blob), "image/png", 0.95);
  });
}

async function compartirImagenCatalogo() {
  const canvas = document.getElementById("catalogo-canvas");

  // Intentar Web Share API con archivo (móvil)
  if (navigator.canShare) {
    try {
      const blob = await getCanvasBlob();
      const file = new File([blob], "catalogo-parfum.png", {
        type: "image/png",
      });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Catálogo de perfumes" });
        toast("📤 Compartido!");
        return;
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        // Fallback a WhatsApp link
      } else return;
    }
  }

  // Fallback: descargar + abrir WhatsApp
  descargarImagenCatalogo();
  setTimeout(() => {
    const titulo =
      document.getElementById("cat-titulo-input").value ||
      "🍶 Perfumes disponibles";
    const pie = document.getElementById("cat-pie-input").value || "";
    const inicio = catPaginaActual * CAT_POR_PAGINA;
    const perfsPagina = catPerfumesParaRender.slice(
      inicio,
      inicio + CAT_POR_PAGINA,
    );
    const totalPaginas = Math.ceil(
      catPerfumesParaRender.length / CAT_POR_PAGINA,
    );
    const paginaInfo =
      totalPaginas > 1
        ? " (foto " + (catPaginaActual + 1) + "/" + totalPaginas + ")"
        : "";
    const lineas = perfsPagina.map(
      (p) =>
        `🍶 *${p.nombre}*${p.ml ? " " + p.ml + "ml" : ""} — *${p.pVenta ? fmt(p.pVenta) : "—"}*`,
    );
    const msg = encodeURIComponent(
      `*${titulo}${paginaInfo}*\n\n` +
        lineas.join("\n") +
        (pie ? `\n\n${pie}` : ""),
    );
    window.open("https://wa.me/?text=" + msg, "_blank");
    toast("📲 Imagen descargada · WhatsApp abierto", 3500);
  }, 800);
}

function descargarImagenCatalogo() {
  const canvas = document.getElementById("catalogo-canvas");
  const link = document.createElement("a");
  const totalPaginas = Math.ceil(catPerfumesParaRender.length / CAT_POR_PAGINA);
  const sufijo = totalPaginas > 1 ? "-foto" + (catPaginaActual + 1) : "";
  link.download =
    "catalogo-parfum-" +
    new Date().toLocaleDateString("es-AR").replace(/\//g, "-") +
    sufijo +
    ".png";
  link.href = canvas.toDataURL("image/png", 0.95);
  link.click();
  toast("🖼 Catálogo descargado");
}

async function copiarImagenCatalogo() {
  try {
    const blob = await getCanvasBlob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("📋 Imagen copiada al portapapeles");
  } catch (e) {
    descargarImagenCatalogo();
    toast("No se pudo copiar directamente. Imagen descargada.");
  }
}

async function descargarPDFCatalogo() {
  const btn = document.getElementById("btn-pdf-catalogo");
  if (btn) {
    btn.textContent = "⏳ Generando PDF...";
    btn.disabled = true;
  }

  try {
    const { jsPDF } = window.jspdf;
    const titulo =
      document.getElementById("cat-titulo-input").value ||
      "🍶 Perfumes disponibles";
    const pie = document.getElementById("cat-pie-input").value || "";
    const perfumesLista = catPerfumesParaRender;
    const T = {
      dark: {
        bg: "#0f0f1a",
        bg2: "#1a1a2e",
        card: "#1e1e35",
        gold: "#e8c97e",
        text: "#f0ece4",
        text2: "#9e9bbf",
        border: "rgba(201,168,76,0.25)",
      },
      light: {
        bg: "#f5f0e8",
        bg2: "#ede8dc",
        card: "#ffffff",
        gold: "#a07830",
        text: "#1a1410",
        text2: "#5a4e3a",
        border: "rgba(160,120,48,0.2)",
      },
      gold: {
        bg: "#1a1200",
        bg2: "#2a1f00",
        card: "#1e1900",
        gold: "#e8c97e",
        text: "#f5dfa0",
        text2: "#c9a84c",
        border: "rgba(232,201,126,0.3)",
      },
    }[catTema] || {
      bg: "#0f0f1a",
      bg2: "#1a1a2e",
      card: "#1e1e35",
      gold: "#e8c97e",
      text: "#f0ece4",
      text2: "#9e9bbf",
      border: "rgba(201,168,76,0.25)",
    };

    // ── Precargar imágenes ──
    const imgCache = {};
    await Promise.all(
      perfumesLista.map(
        (p) =>
          new Promise((res) => {
            if (!p.foto) {
              res();
              return;
            }
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              imgCache[p.nombre] = img;
              res();
            };
            img.onerror = () => res();
            img.src = p.foto;
          }),
      ),
    );

    // ── Configuración de página A4 en mm ──
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const PW = 210,
      PH = 297; // A4 mm
    const MX = 12,
      MY = 10; // márgenes
    const HEADER_H = 18; // altura del header mm
    const FOOTER_H = pie ? 10 : 6; // pie de página
    const GAP_X = 5,
      GAP_Y = 5; // separación entre tarjetas
    const COLS = 3; // 3 columnas: legibles
    const usableW = PW - MX * 2;
    const usableH = PH - MY * 2 - HEADER_H - FOOTER_H;
    const CARD_W = (usableW - GAP_X * (COLS - 1)) / COLS; // ~58mm
    // Foto cuadrada + área de texto generosa
    const TEXT_AREA = 26; // mm fijos para nombre + precio
    const CARD_H = CARD_W + TEXT_AREA; // ~84mm → cabe 3 filas x página
    const ROWS_PER_PAGE = Math.floor((usableH + GAP_Y) / (CARD_H + GAP_Y));

    const CARDS_PER_PAGE = COLS * ROWS_PER_PAGE;
    const totalPages = Math.ceil(perfumesLista.length / CARDS_PER_PAGE);

    // ── Helper: dibujar tarjeta como canvas offline → data URL ──
    async function drawCardToDataURL(p, wMM, hMM) {
      // Renderizar a 4x para máxima nitidez
      const PX_PER_MM = 4;
      const cw = Math.round(wMM * PX_PER_MM);
      const ch = Math.round(hMM * PX_PER_MM);
      // La foto ocupa el ancho completo × ancho (cuadrado)
      const imgHpx = Math.round(wMM * PX_PER_MM); // foto cuadrada
      const R = Math.round(4 * PX_PER_MM);

      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      const cx = c.getContext("2d");

      // ─ Fondo redondeado ─
      cx.beginPath();
      cx.moveTo(R, 0);
      cx.lineTo(cw - R, 0);
      cx.quadraticCurveTo(cw, 0, cw, R);
      cx.lineTo(cw, ch - R);
      cx.quadraticCurveTo(cw, ch, cw - R, ch);
      cx.lineTo(R, ch);
      cx.quadraticCurveTo(0, ch, 0, ch - R);
      cx.lineTo(0, R);
      cx.quadraticCurveTo(0, 0, R, 0);
      cx.closePath();
      cx.fillStyle = T.card;
      cx.fill();
      cx.strokeStyle = T.border;
      cx.lineWidth = 0.5 * PX_PER_MM;
      cx.stroke();

      // ─ Foto (clip superior redondeado) ─
      cx.save();
      cx.beginPath();
      cx.moveTo(R, 0);
      cx.lineTo(cw - R, 0);
      cx.quadraticCurveTo(cw, 0, cw, R);
      cx.lineTo(cw, imgHpx);
      cx.lineTo(0, imgHpx);
      cx.lineTo(0, R);
      cx.quadraticCurveTo(0, 0, R, 0);
      cx.closePath();
      cx.clip();

      if (imgCache[p.nombre]) {
        const img = imgCache[p.nombre];
        const ratio = Math.max(cw / img.width, imgHpx / img.height);
        const dw = img.width * ratio,
          dh = img.height * ratio;
        cx.drawImage(img, (cw - dw) / 2, (imgHpx - dh) / 2, dw, dh);
        const ov = cx.createLinearGradient(0, 0, 0, imgHpx);
        ov.addColorStop(0, "rgba(0,0,0,0)");
        ov.addColorStop(1, "rgba(0,0,0,0.2)");
        cx.fillStyle = ov;
        cx.fillRect(0, 0, cw, imgHpx);
      } else {
        const bg2 = cx.createLinearGradient(0, 0, cw, imgHpx);
        bg2.addColorStop(0, T.bg2);
        bg2.addColorStop(1, T.bg);
        cx.fillStyle = bg2;
        cx.fillRect(0, 0, cw, imgHpx);
        cx.font = `${Math.round(imgHpx * 0.38)}px serif`;
        cx.textAlign = "center";
        cx.fillText("🍶", cw / 2, imgHpx / 2 + imgHpx * 0.12);
      }
      cx.restore();

      // Línea separadora
      cx.fillStyle = T.border;
      cx.fillRect(0, imgHpx, cw, Math.max(1, PX_PER_MM * 0.4));

      // ─ Textos ─
      const PAD = Math.round(5 * PX_PER_MM);
      const maxTxtW = cw - PAD * 2;
      cx.textAlign = "center";

      // Helper wrap: parte texto en hasta 2 líneas que entren en maxTxtW
      function wrapText(ctx2, texto, fontFn, sz, maxW) {
        ctx2.font = fontFn(sz);
        if (ctx2.measureText(texto).width <= maxW)
          return { lines: [texto], sz };
        // probar 2 líneas
        const wds = texto.split(" ");
        for (let i = 1; i < wds.length; i++) {
          const l1 = wds.slice(0, i).join(" "),
            l2 = wds.slice(i).join(" ");
          if (
            ctx2.measureText(l1).width <= maxW &&
            ctx2.measureText(l2).width <= maxW
          ) {
            return { lines: [l1, l2], sz: Math.max(sz - 1, 7) };
          }
        }
        // reducir fuente
        while (sz > 7 && ctx2.measureText(texto).width > maxW) {
          sz--;
          ctx2.font = fontFn(sz);
        }
        let t = texto;
        while (ctx2.measureText(t).width > maxW && t.length > 2)
          t = t.slice(0, -2) + "…";
        return { lines: [t], sz };
      }

      // Nombre — tamaño base proporcional al ancho
      const nBaseSz = Math.round(wMM * PX_PER_MM * 0.19); // ~11px por mm de ancho
      const nFontFn = (sz) =>
        `600 ${sz}px 'Cormorant Garamond', Georgia, serif`;
      const { lines: nLines, sz: nSz } = wrapText(
        cx,
        p.nombre,
        nFontFn,
        nBaseSz,
        maxTxtW,
      );

      cx.fillStyle = T.text;
      cx.font = nFontFn(nSz);
      const lineH = nSz * 1.35;
      const totalNH = nLines.length * lineH;
      // Posición Y centrada en área info
      const infoAreaH = ch - imgHpx;
      const totalTextH = totalNH + (p.ml ? lineH * 0.8 : 0) + lineH * 1.1;
      let curY = imgHpx + (infoAreaH - totalTextH) / 2 + nSz;

      nLines.forEach((ln, li) => {
        cx.fillText(ln, cw / 2, curY + li * lineH);
      });
      curY += totalNH + Math.round(3 * PX_PER_MM);

      // ML
      if (p.ml) {
        const mlSz = Math.round(wMM * PX_PER_MM * 0.14);
        cx.font = `300 ${mlSz}px 'DM Sans', Arial, sans-serif`;
        cx.fillStyle = T.text2;
        cx.fillText(p.ml + " ml", cw / 2, curY);
        curY += mlSz * 1.5;
      }

      // Precio — tamaño proporcional, NO más grande que el nombre
      const precioStr = p.pVenta ? fmt(p.pVenta) : "—";
      const pBaseSz = Math.round(wMM * PX_PER_MM * 0.2);
      const pFontFn = (sz) =>
        `600 ${sz}px 'Cormorant Garamond', Georgia, serif`;
      let pSz = pBaseSz;
      cx.font = pFontFn(pSz);
      while (cx.measureText(precioStr).width > maxTxtW && pSz > 7) {
        pSz--;
        cx.font = pFontFn(pSz);
      }
      cx.fillStyle = T.gold;
      cx.fillText(precioStr, cw / 2, curY);

      return c.toDataURL("image/png", 0.93);
    }

    // ── Helper: dibujar header de página ──
    function drawPageHeader(pdf, titulo, pg, totalPg) {
      // Fondo header
      pdf.setFillColor(T.bg2);
      pdf.roundedRect(MX, MY, usableW, HEADER_H, 3, 3, "F");
      // Línea dorada
      const [gr, gg, gb] = hexToRgb(T.gold);
      pdf.setDrawColor(gr, gg, gb);
      pdf.setLineWidth(0.4);
      pdf.line(
        MX + 4,
        MY + HEADER_H - 0.5,
        MX + usableW - 4,
        MY + HEADER_H - 0.5,
      );
      // Título
      pdf.setTextColor(gr, gg, gb);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text(
        titulo.replace(/[^\x00-\x7F]/g, "").trim() || "Perfumes disponibles",
        PW / 2,
        MY + HEADER_H / 2 + 1,
        { align: "center" },
      );
      // Fecha + página
      pdf.setTextColor(150, 150, 180);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      const fechaStr = new Date().toLocaleDateString("es-AR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      pdf.text(fechaStr, PW / 2, MY + HEADER_H / 2 + 6, { align: "center" });
      if (totalPg > 1) {
        pdf.text(`Pág ${pg}/${totalPg}`, MX + usableW - 2, MY + HEADER_H - 3, {
          align: "right",
        });
      }
    }

    function hexToRgb(hex) {
      const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return r
        ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)]
        : [200, 168, 76];
    }

    // ── Helper: dibujar footer ──
    function drawPageFooter(pdf, pie, pg, totalPg) {
      const fy = PH - MY - FOOTER_H + 3;
      if (pie) {
        pdf.setTextColor(150, 150, 170);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.text(pie.replace(/[^\x00-\x7F]/g, "").trim(), PW / 2, fy + 3, {
          align: "center",
        });
      }
      // Marca de agua
      pdf.setTextColor(100, 90, 60);
      pdf.setFontSize(6);
      pdf.text("Parfum Track", PW / 2, PH - MY / 2, { align: "center" });
    }

    // ── Generar páginas ──
    for (let pg = 0; pg < totalPages; pg++) {
      if (pg > 0) pdf.addPage();

      // Fondo de página
      pdf.setFillColor(T.bg);
      pdf.rect(0, 0, PW, PH, "F");

      drawPageHeader(pdf, titulo, pg + 1, totalPages);
      drawPageFooter(pdf, pie, pg + 1, totalPages);

      const pageCards = perfumesLista.slice(
        pg * CARDS_PER_PAGE,
        (pg + 1) * CARDS_PER_PAGE,
      );
      const contentStartY = MY + HEADER_H + GAP_Y;

      for (let i = 0; i < pageCards.length; i++) {
        const p = pageCards[i];
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const cx = MX + col * (CARD_W + GAP_X);
        const cy = contentStartY + row * (CARD_H + GAP_Y);

        const dataUrl = await drawCardToDataURL(p, CARD_W, CARD_H);
        pdf.addImage(dataUrl, "PNG", cx, cy, CARD_W, CARD_H);
      }
    }

    const fecha = new Date().toLocaleDateString("es-AR").replace(/\//g, "-");
    pdf.save(`catalogo-parfum-${fecha}.pdf`);
    toast(
      "📄 PDF descargado · " +
        totalPages +
        (totalPages === 1 ? " página" : " páginas"),
    );
  } catch (e) {
    console.error("PDF error:", e);
    toast("⚠ Error al generar PDF. Intentá con la imagen.");
  } finally {
    if (btn) {
      btn.textContent = "📄 Descargar PDF";
      btn.disabled = false;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EVENT DELEGATION — replaces static onclick= in index.html
// ══════════════════════════════════════════════════════════════════════════════

// Helper wrappers for onclick= cases that had arguments not expressible as data-arg
function triggerFileImport() {
  document.getElementById("file-import").click();
}
function triggerFileRestore() {
  document.getElementById("file-restore").click();
}
function triggerEditFotoInput() {
  document.getElementById("edit-foto-input").click();
}
function previewFotoUrlTrue() {
  previewFotoUrl(true);
}
function catCambiarPaginaPrev() {
  catCambiarPagina(-1);
}
function catCambiarPaginaNext() {
  catCambiarPagina(1);
}

// Global click delegation — dispatches data-action to matching window function
document.addEventListener("click", function (e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const fnName = el.dataset.action;
  const arg = el.dataset.arg;
  const fn = window[fnName];
  if (typeof fn === "function") {
    fn(arg !== undefined ? arg : undefined);
  } else {
    console.warn("[delegation] función no encontrada:", fnName);
  }
});

// mas-overlay: close only when clicking the backdrop itself (not the drawer)
(function () {
  const overlay = document.getElementById("mas-overlay");
  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === this) cerrarMas();
    });
  }
})();
