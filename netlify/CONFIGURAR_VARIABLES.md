# Configurar variables de entorno en Netlify

Sin estas dos variables, la activación de licencias NO funcionará.

## Pasos

1. Ir a **Netlify → tu sitio → Site configuration → Environment variables**
2. Hacer clic en **"Add a variable"** y agregar:

---

### Variable 1: `LICENSE_SERVER_SECRET`

Una clave larga y aleatoria que solo vive en el servidor.
Generarla una sola vez con este comando (Node.js):

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Ejemplo de valor** (generar el tuyo, no usar este):
```
a3f8c2d19e4b7a6f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3
```

⚠️ **IMPORTANTE**: Si cambiás este secreto, todos los usuarios activos tendrán que re-activar su licencia.

---

### Variable 2: `VALID_LICENSE_CODES`

Lista de todos los códigos de activación válidos, separados por coma.

**Ejemplo de valor**:
```
PT-AAAA-1111,PT-BBBB-2222,PT-CCCC-3333
```

Para agregar un cliente nuevo: simplemente agregá el código nuevo a la lista y re-deploy el sitio.
Para revocar un código: eliminarlo de la lista y re-deploy. La licencia se invalida en la próxima verificación (máximo 7 días).

---

## Verificar que funciona

Después de configurar las variables y hacer deploy:

1. Abrir la app
2. Ir al modal de activación
3. Ingresar un código de la lista
4. Si se activa → ✅ funciona
5. Si da error → revisar los logs en Netlify → Functions → validate-license

## Estructura de archivos

```
netlify/
  functions/
    validate-license.js   ← valida el código y emite el token
    verify-token.js       ← verifica tokens existentes (cada 7 días)
```

Los archivos de funciones NO contienen ningún secreto. Todo vive en las env vars.
