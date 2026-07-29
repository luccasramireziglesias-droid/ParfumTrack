# KNOWLEDGE_GRAPH — Qué afecta a qué

**Para qué sirve este archivo.** Antes de tocar algo, mirá qué cuelga de eso. La mayoría de
los bugs de esta app no son "la función está mal": son "cambié X y no me di cuenta de que
Y dependía de X".

---

## 1. El grafo central: una venta

```mermaid
flowchart TD
    V[VENTA registrada] --> S[Descuenta STOCK]
    V --> C{¿en cuotas?}
    C -->|sí| CU[Crea N CUOTAS<br/>la 1ª cobrada por defecto]
    C -->|no| CT[Contado]

    S --> AL[Alertas de stock]
    CU --> DEU[DEUDORES]
    CU --> REC[RECORDATORIOS de cobro]
    REC --> BAD[Badge de la bottom nav]

    V --> GAN[GANANCIA del mes]
    V --> EST[ESTADÍSTICAS]
    V --> RAN[RANKINGS]
    V --> CLI[CLIENTES derivados]

    GAN --> DASH[DASHBOARD]
    DEU --> DASH
    REC --> DASH
    AL --> ST[Pantalla de STOCK]
```

**Leelo así:** tocar cómo se guarda una venta afecta —como mínimo— stock, cuotas,
ganancia, estadísticas, rankings, clientes, deudores, recordatorios, el badge y el
dashboard. **Todo eso es derivado y se recalcula**; ninguno se persiste.

---

## 2. Impacto de cada operación

| Operación | Stock | Cuotas | Ganancia | Clientes | Otros |
|---|---|---|---|---|---|
| `addVenta` | ↓ descuenta | crea N | ↑ suma | + aparece | recordatorios, rankings |
| `updateVenta` | ⟳ solo si cambió perfume/cantidad | — | ⟳ recalcula | ⟳ | — |
| `deleteVenta` | ↑ devuelve exacto | **borra** | ↓ resta | − puede desaparecer | — |
| `devolverVenta` | ↑ repone (opcional) | cancela impagas | ↓ deja de contar | − puede desaparecer | marca `devuelta` |
| `revertirDevolucion` | ↓ vuelve a descontar | **recrea** las canceladas | ↑ vuelve a contar | + reaparece | — |
| `pagarCuota` | — | ↓ baja la deuda | — | ⟳ saldo | recordatorios, badge |
| `registrarCompra` | ↑ suma | — | ⟳ **cambia `precioCompra`** | — | 🟠 afecta la ganancia futura |
| `eliminarCompra` | ↓ resta (nunca negativo) | — | — | — | no revierte el costo |
| `addReserva` | 🔵 **no toca** | — | — | — | lista de espera |
| `entregarReserva` | ↓ vía `addVenta` | según la venta | ↑ suma | + aparece | seña no se re-suma |
| `cancelarReserva` | — | — | — | — | registra si se devolvió la seña |
| `addPerfume` | define stock inicial | — | — | — | — |
| `deletePerfume` | — | — | — | — | 🔵 las ventas sobreviven (`perfume` es string) |
| `addGasto` | — | — | ↓ **ganancia neta** | — | — |
| `addCaja` | — | — | 🔵 independiente | — | — |
| `addPedido` | 🔵 **no toca** | — | — | — | ≠ compras |

**Los tres 🔵 que más se confunden:**
- Una **reserva** no descuenta stock hasta entregarse.
- Un **pedido** al proveedor no toca el stock; la reposición real es una **compra**.
- Borrar un **perfume** no rompe las ventas: guardan el nombre como string.

---

## 3. Grafo de dependencias del código

```mermaid
flowchart TD
    subgraph base [Base — no dependen de nadie]
        UTILS[11-utils.js<br/>esc·fmt·toast·_once]
        ENC[15-encryption.js<br/>AES-GCM]
        I18N[19-i18n.js]
    end

    DB[db.js] --> ENC
    CORE[00-core.js] --> DB
    CORE --> I18N

    subgraph ui [Módulos de UI]
        NV[03-nueva-venta]
        STK[04-stock]
        CUO[05-cuotas]
        EDT[06-ventas-edit-delete]
        DEV[22-devoluciones]
        COM[23-compras]
        RES[24-reservas]
        IMP[26-importar-excel]
    end

    ui --> DB
    ui --> UTILS
    ui --> CORE

    REN[02-render.js] --> UTILS
    REN --> DEV
    CORE --> REN
    NAV[01-navigation.js] --> REN

    CLI[18-clientes] --> DEV
    REC[20-recordatorios] --> CORE
    DM[10-data-management] --> DB
    CTA[12-cuenta-licencia] --> KEY[16-key-management]
    KEY --> ENC
```

### Los cuatro nodos más peligrosos

| Nodo | De quién cuelga | Por qué es peligroso |
|---|---|---|
| **`11-utils.js`** | Todos | `esc()` es la defensa XSS; `_once()` es la anti doble-tap. Romperlos rompe todo |
| **`db.js`** | Todos los que persisten | Un error acá corrompe datos, no solo la UI |
| **`_ventasActivas()`** (en `22-devoluciones`) | Toda agregación de plata | Si algo no la usa, cuenta ventas devueltas |
| **`15-encryption.js`** | `db.js` | Un cambio puede volver **ilegibles** datos de usuarios reales |

---

## 4. `_ventasActivas()` — el nodo crítico

```mermaid
flowchart LR
    VA["_ventasActivas()"] --> G[Ganancia del mes]
    VA --> GN[Ganancia neta]
    VA --> ES[Estadísticas]
    VA --> RA[Rankings]
    VA --> CL[Clientes derivados]
    VA --> DE[Deudores]
    VA --> DA[Dashboard]
    VA --> HOY[Ventas de hoy]
```

Definida en `22-devoluciones.js`, consumida desde todos lados.

🔴 **Cualquier `this.ventas.filter(` en `02-render.js` es un bug.** Hay un test que falla
si aparece esa cadena.

---

## 5. Cadenas de efecto en cascada

### Cadena de la plata
```
precio de venta → ganancia bruta → (− gastos) → ganancia neta → dashboard
                → estadísticas → rankings
                → cuotas → deuda del cliente → recordatorios → badge
```
🔴 Un error acá **no lanza ninguna excepción**: muestra un número mal. Es la clase de bug
más cara de esta app, y es la razón de que exista el fuzzer.

### Cadena del stock
```
stock inicial → (− ventas) → (+ devoluciones) → (+ compras) → (− reservas entregadas)
             → alertas de agotados → resumen colapsable → pantalla de stock
```

### Cadena de la identidad del cliente
```
nombre escrito → _clienteKey() normaliza → agrupa ventas + cuotas
              → cliente derivado → lista → ficha → total comprado / saldo
```
🟡 "Ana" y "ana " son el mismo cliente; "Ana Gómez" y "Ana" no.

---

## 6. Cadena del arranque

```mermaid
flowchart TD
    A[openDB v5] --> B[persist storage]
    B --> C[seedDemo · 1 sola vez]
    C --> D[dedupEncryptedRecords]
    D --> E[fixCorruptDates · one-time]
    E --> F[una lectura de cuotas]
    F --> G[fixStringCuotaIds]
    F --> H[fixCuotasSaldadas]
    G --> I[loadData]
    H --> I
    I --> J[preferencias + cifrado]
    J --> K[gates: PIN · consentimiento]
    K --> L[renderAll]
    L --> M[SW · tabSync · autoUpdate]
```

🔴 **Todo lo que agregues acá le pega a todos los usuarios en cada apertura.** Medí antes.

---

## 7. Cadena de build y deploy

```mermaid
flowchart LR
    SRC[src/**] --> BUILD[node scripts/build.js]
    PKG[package.json version] --> BUILD
    BUILD --> IDX[index.html]
    BUILD --> SW[sw.js APP_VERSION]
    BUILD --> VER[functions/version.js]
    IDX --> GIT[commit]
    GIT --> CI[GitHub Actions]
    CI --> T[Vitest 560]
    CI --> E[Playwright 72]
    T --> DEP[Deploy Worker]
    E --> DEP
    DEP --> PROD[Cloudflare]
```

🔴 **Si tocás `src/` y no corrés `build.js`, tu cambio no llega a producción** — y CI falla
por drift entre `src/` e `index.html`.

---

## 8. Grafo de "si toco X, revisá Y"

| Si tocás… | Revisá también |
|---|---|
| `db.js addVenta` | stock, cuotas, ganancia, tests f1/f3/fuzz |
| `db.js devolverVenta` | `revertirDevolucion` (son espejo), clientes, deudores |
| `_ventasActivas()` | **todas** las agregaciones de `02-render.js` y `18-clientes.js` |
| `02-render.js renderCuotas` | el total adeudado, el paginado, el `sort` sin trabajo adentro |
| `11-utils.js esc()` | seguridad XSS de toda la app |
| `11-utils.js _once()` | todos los guardados async |
| `15-encryption.js` | **datos de usuarios reales**. Migración + test de ida y vuelta |
| `openDB()` | las 5 listas de stores, `_encryptedStores`, `loadData()` |
| `showScreen()` | que cada pantalla nueva tenga su `if` de render |
| `worker.js` rutas | CORS, rate limit, tests de worker |
| `_shared.js` | los 10 endpoints a la vez |
| `sw.js` | cacheo, `STATIC_ASSETS`, guard de `controllerchange` |
| `package.json` version | nada: `build.js` propaga sola |
| Un nombre de método público | buscá el string en `src/screens/` y `src/index.template.html` |

---

## 9. Datos que viajan (y los que no)

```mermaid
flowchart LR
    subgraph disp [Dispositivo del usuario]
        VEN[ventas · cuotas · perfumes<br/>compras · reservas · caja · gastos]
    end
    subgraph serv [Servidor]
        LIC[licencias]
        PAG[pagos]
        BAK[backups cifrados]
    end
    VEN -.->|SOLO cifrado + HMAC| BAK
    LIC --> disp
    PAG --> LIC
```

🔴 **La única flecha que lleva datos del negocio al servidor es el backup, y va cifrado del
lado del cliente.** El servidor no puede leerlo. Cualquier feature que rompa esto rompe la
promesa de privacidad del producto (D-03).
