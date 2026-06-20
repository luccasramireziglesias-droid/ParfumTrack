# Configuración TWA — Parfum Track para Play Store

## ¿Qué es una TWA?

TWA (Trusted Web Activity) permite empaquetar una PWA como app Android nativa. La app abre tu sitio web en Chrome sin barra de navegación — se ve y se siente como una app nativa. No hay que reescribir código.

---

## Requisitos previos

| Requisito | Estado |
|-----------|--------|
| PWA con manifest.json | LISTO |
| Service Worker (sw.js) | LISTO |
| HTTPS | LISTO (Cloudflare Workers) |
| icon-512.png (512x512) | LISTO |
| icon-192.png (192x192) | LISTO |
| Cuenta Google Play Developer ($25 USD, pago único) | PENDIENTE |
| Android Studio instalado | PENDIENTE |
| Java JDK 11+ instalado | PENDIENTE |

---

## Paso 1: Crear cuenta de desarrollador en Google Play

1. Ir a https://play.google.com/console
2. Iniciar sesión con la cuenta parfumtrack@gmail.com
3. Pagar la tarifa única de USD $25
4. Completar la verificación de identidad (puede tardar 2-7 días)

---

## Paso 2: Instalar herramientas

### Node.js (si no lo tenés)
```bash
# Descargar desde https://nodejs.org (versión LTS)
```

### Bubblewrap CLI
```bash
npm install -g @nicedoc/bubblewrap
```

### Android Studio
- Descargar desde https://developer.android.com/studio
- Instalar el SDK de Android (API level 33+)
- Anotar la ruta del SDK (ej: `C:\Users\lucca\AppData\Local\Android\Sdk`)

### Java JDK
- Descargar JDK 17 desde https://adoptium.net
- Configurar JAVA_HOME en variables de entorno

---

## Paso 3: Inicializar proyecto con Bubblewrap

Desde la carpeta PLAYSTORE, ejecutar:

```bash
bubblewrap init --manifest="https://parfumtrack.com/manifest.json"
```

Bubblewrap va a preguntar varios datos. Usar estos valores:

| Campo | Valor |
|-------|-------|
| **Domain** | parfumtrack.com |
| **URL path** | /index.html |
| **App name** | Parfum Track |
| **Short name** | ParfumTrack |
| **App package** | com.parfumtrack.app |
| **App version name** | 1.0.0 |
| **App version code** | 1 |
| **Display mode** | standalone |
| **Status bar color** | #0f0f1a |
| **Navigation bar color** | #0f0f1a |
| **Splash screen color** | #0f0f1a |
| **Icon path** | (usa el del manifest automáticamente) |
| **Signing key** | Crear una nueva (guardar el keystore seguro) |

---

## Paso 4: Generar el APK/AAB

```bash
bubblewrap build
```

Esto genera:
- `app-release-bundle.aab` — el archivo que se sube a Play Store
- `app-release-signed.apk` — para testing directo en celular

---

## Paso 5: Verificar Digital Asset Links

Para que la app se abra sin barra de Chrome, hay que verificar la propiedad del dominio.

1. Después de firmar la app, obtener el fingerprint SHA-256:
```bash
keytool -list -v -keystore ./ptrack.keystore -alias ptrack
```

2. Crear el archivo `/.well-known/assetlinks.json` en el servidor con:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.parfumtrack.app",
    "sha256_cert_fingerprints": ["XX:XX:XX:...TU_FINGERPRINT_ACA..."]
  }
}]
```

3. Verificar que sea accesible en:
```
https://parfumtrack.com/.well-known/assetlinks.json
```

---

## Paso 6: Subir a Play Store

1. Ir a Google Play Console → Crear aplicación
2. Completar la ficha de la tienda (ver `ficha-tienda.md`)
3. Subir los assets gráficos (ver `assets-graficos.md`)
4. Ir a **Producción** → **Crear nueva versión**
5. Subir el archivo `app-release-bundle.aab`
6. Completar el cuestionario de clasificación de contenido
7. Configurar precio (Gratis) y distribución (países)
8. Enviar a revisión

---

## Paso 7: Revisión de Google

- La primera revisión puede tardar entre 3 y 7 días
- Google revisa que la app cumpla sus políticas
- Si hay compras in-app (plan Pro), declararlo en la ficha
- Tener la política de privacidad publicada antes de enviar

---

## Archivos importantes que se generan

| Archivo | Descripción | Guardar seguro |
|---------|-------------|----------------|
| `ptrack.keystore` | Clave de firma de la app | SI — si se pierde no podés actualizar la app nunca más |
| `app-release-bundle.aab` | Bundle para Play Store | No (se regenera) |
| `assetlinks.json` | Verificación de dominio | No (se sube al servidor) |
| `twa-manifest.json` | Configuración de Bubblewrap | Sí |

---

## Resumen de pasos

1. Crear cuenta Google Play Developer ($25)
2. Instalar Bubblewrap + Android Studio + JDK
3. `bubblewrap init` con el manifest de la app
4. `bubblewrap build` para generar el AAB
5. Configurar assetlinks.json en el servidor
6. Subir AAB + ficha + assets a Play Console
7. Enviar a revisión
