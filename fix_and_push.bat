@echo off
echo Subiendo Parfum Track a Netlify...
echo.

del /f ".git\index.lock" 2>nul

git add index.html sw.js manifest.json netlify.toml

git commit -m "feat: mejoras UI/UX - favicon, splash iOS, CSV export, undo stock, debounce busqueda, version en ajustes"

git push

echo.
echo =========================================
echo  Listo! Los cambios se subieron a Netlify
echo  En 1-2 minutos se actualiza la app
echo =========================================
pause
