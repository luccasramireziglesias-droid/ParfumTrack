# Parfum Track — Guía para Play Store

## Pre-requisitos

- Android Studio (o Java 17+ y Gradle)
- Cuenta Google Play Developer (USD 25 única vez)

## Paso 1: Generar el AAB

### Opción A: Línea de comandos (más rápido)

```bash
cd PLAYSTORE/twa-project
./gradlew bundleRelease
```

El AAB se genera en `app/build/outputs/bundle/release/app-release.aab`

### Opción B: Android Studio

1. **File > Open** → seleccioná `PLAYSTORE/twa-project`
2. Esperá Gradle sync
3. **Build > Generate Signed Bundle / APK...**
4. Seleccioná **Android App Bundle** > **Next**
5. Keystore: seleccioná `PLAYSTORE/parfumtrack-release.jks`
   - Password: (la que definiste al crear el keystore)
   - Alias: `parfumtrack`
   - Key password: (la que definiste al crear el keystore)
6. **Next** > **release** > **Create**

## Paso 2: assetlinks.json (YA CONFIGURADO)

El archivo `/.well-known/assetlinks.json` ya está creado con el SHA-256 del keystore.
Se sirve automáticamente via Cloudflare Workers.

Verificar después del deploy: `https://parfumtrack.luccasramireziglesias.workers.dev/.well-known/assetlinks.json`

## Paso 3: Subir a Play Console

1. Entrá a [Google Play Console](https://play.google.com/console)
2. **Crear aplicación** → Nombre: "Parfum Track"
3. Completar la ficha:
   - **Título:** Parfum Track — Gestión de ventas de perfumes
   - **Descripción corta (80 chars):** Organizá tus ventas de perfumes. Ganancia, stock, cuotas y cobros en segundos.
   - **Categoría:** Herramientas / Negocios
   - **Política de privacidad:** https://parfumtrack.luccasramireziglesias.workers.dev/privacidad.html
4. **Testing cerrado** → Crear track → Subir el AAB
5. Invitar 20 testers (emails Gmail) → esperar 14 días
6. Solicitar acceso a producción

## Datos del keystore (GUARDAR EN LUGAR SEGURO)

- **Archivo:** `PLAYSTORE/parfumtrack-release.jks`
- **Store password:** (guardada localmente, NO en el repo)
- **Key alias:** `parfumtrack`
- **Key password:** (guardada localmente, NO en el repo)
- **SHA-256:** `89:A3:C1:23:9A:F5:09:6B:D0:2D:B8:34:09:84:A5:4F:84:BC:86:E0:99:71:4C:8A:81:CB:B6:91:D4:47:9A:70`

Para buildear, exportar las variables de entorno:
```bash
export KEYSTORE_PASSWORD=tu_password
export KEY_PASSWORD=tu_password
./gradlew bundleRelease
```

**IMPORTANTE:** Si perdés el keystore no podés actualizar la app nunca más. Hacé backup en Google Drive o similar.

## Assets gráficos necesarios para la ficha

| Asset | Tamaño | Estado |
|-------|--------|--------|
| Ícono | 512x512 PNG | Ya tenés (icon-512.png) |
| Feature graphic | 1024x500 PNG | Pendiente |
| Screenshots (2-8) | Variable | Ya tenés 3 screenshots |

## Configuración de la app

- **Package:** `com.parfumtrack.app`
- **Version:** 1.0.0 (versionCode 1)
- **Min SDK:** 19 (Android 4.4+)
- **Target SDK:** 34 (Android 14)
