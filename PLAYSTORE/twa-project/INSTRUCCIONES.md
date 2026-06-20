# Cómo generar el AAB (Android App Bundle)

## Opción 1: Android Studio (recomendado)

1. Abrí Android Studio
2. Click en **File > Open** y seleccioná la carpeta `twa-project`
3. Esperá a que Gradle sincronice (puede tardar unos minutos la primera vez)
4. Andá a **Build > Generate Signed Bundle / APK...**
5. Seleccioná **Android App Bundle** y click en **Next**
6. En Key Store:
   - Si no tenés keystore: click en **Create new...**
   - Elegí ubicación, password, alias y completá los datos
   - **GUARDÁ ESTE ARCHIVO Y LA PASSWORD** — los vas a necesitar para cada actualización
7. Click en **Next**, seleccioná **release**, click en **Create**
8. El AAB se genera en `app/release/app-release.aab`

## Opción 2: Línea de comandos

```bash
cd twa-project
./gradlew bundleRelease
```

El AAB se genera en `app/build/outputs/bundle/release/app-release.aab`

## Después de generar el AAB

1. Subí el AAB a Google Play Console > Tu app > Producción > Crear nueva versión
2. Configurá el assetlinks.json en tu servidor (ver paso siguiente)

## Configurar Digital Asset Links

Después de firmar el AAB, necesitás el SHA-256 del certificado:

```bash
keytool -list -v -keystore tu-keystore.jks -alias tu-alias
```

Copiá el SHA-256 fingerprint y creá el archivo `/.well-known/assetlinks.json` en tu servidor con:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.parfumtrack.app",
    "sha256_cert_fingerprints": ["TU_SHA256_FINGERPRINT_ACÁ"]
  }
}]
```
