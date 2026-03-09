# Documentación del Sistema

Este directorio contiene la documentación del sistema POS Lite.

## 📚 Contexto Técnico Mobile

- Documento recomendado para contexto rápido del proyecto mobile:
  - `/docs/MOBILE_CONTEXT.md`
- Checklist de estado y prioridades:
  - `/docs/MOBILE_IMPLEMENTATION_CHECKLIST.md`
- Analisis de competitividad del POS mobile:
  - `/docs/POS_COMPETITIVE_GAP_ANALYSIS_2026.md`
- Setup de LLM local (Qwen2.5-1.5B + Ollama):
  - `/docs/QWEN_LOCAL_LLM_SETUP.md`

## 📘 Manual de Usuario

El manual de usuario completo está disponible en dos ubicaciones:

1. **Versión Web (Accesible desde la app):**
   - Ubicación: `/public/MANUAL_USUARIO.html`
   - Acceso: Desde el menú lateral de la aplicación → "Manual de Usuario"
   - Se abre en una nueva pestaña del navegador

2. **Versión de Desarrollo:**
   - Ubicación: `/docs/MANUAL_USUARIO.html`
   - Para desarrollo y edición

## 🎯 Uso

### Para Usuarios
- Iniciar sesión en la aplicación
- Hacer clic en "Manual de Usuario" en el menú lateral
- El manual se abrirá en una nueva pestaña

### Para Desarrolladores
Si necesitas editar el manual:

1. Editar el archivo en `/docs/MANUAL_USUARIO.html`
2. Copiar los cambios a `/public/MANUAL_USUARIO.html`:
   ```powershell
   Copy-Item "docs\MANUAL_USUARIO.html" "public\MANUAL_USUARIO.html"
   ```

## 📄 Convertir a PDF

Para generar una versión PDF del manual:

1. Abrir `public/MANUAL_USUARIO.html` en Chrome/Edge
2. Presionar `Ctrl + P` (Imprimir)
3. Seleccionar "Guardar como PDF"
4. Ajustar márgenes a "Mínimo"
5. Guardar el archivo

## 📝 Contenido del Manual

El manual incluye documentación completa de:

- ✅ Introducción y primeros pasos
- ⚙️ Configuración inicial
- 📍 Ubicaciones y cajas registradoras
- 📂 Catálogos base
- 📦 Gestión de productos
- 📊 Control de inventario
- 🏭 Manufactura (BOMs + Producción)
- 🛒 Compras
- 💵 Punto de venta
- 💎 Plan Separe
- 💼 Sesiones de caja
- 📊 Reportes
