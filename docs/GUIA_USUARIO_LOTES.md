# Guía: Sistema Integrado de Compras y Lotes

## 📦 Flujo Completo: Del Proveedor al Inventario

### 1️⃣ Registrar Compra de Mercancía (✅ FORMA CORRECTA)

**Ruta:** Compras → Nueva Compra

#### Pasos:
1. Clic en **"Nueva Compra"**
2. Seleccionar **Sede** donde llega la mercancía
3. Agregar **Nota** (opcional): ej. "Factura #123 - Proveedor ABC"
4. Clic en **"Agregar"** para añadir productos

#### Al Agregar Productos:

##### Si el producto NO requiere vencimiento:
```
✏️ Producto: Seleccionar de la lista
🔢 Cantidad: Ingresar cantidad recibida
💵 Costo Unitario: Costo de compra
```

##### Si el producto REQUIERE vencimiento (aparece icono ⚠️):
```
✏️ Producto: Seleccionar de la lista
🔢 Cantidad: Ingresar cantidad recibida  
💵 Costo Unitario: Costo de compra

📦 CAMPOS ADICIONALES (aparecen automáticamente):
└─ Número de Lote: Se genera automático o ingresar manualmente
└─ Fecha de Vencimiento ⚠️ REQUERIDO
└─ Ubicación Física: Ej: "NEVERA-2" (opcional)
```

5. Clic en **"Guardar Compra"**

#### ✅ ¿Qué hace el sistema automáticamente?
- ✅ Crea el lote con toda la información
- ✅ Registra la trazabilidad (proveedor, fecha, costo)
- ✅ Actualiza el inventario
- ✅ Registra el movimiento contable
- ✅ Vincula el lote con la compra

---

### 2️⃣ Consultar y Gestionar Lotes

**Ruta:** Inventario → Lotes y Vencimientos

#### Pestaña "Lotes"
- Ver todos los lotes registrados
- Filtrar por sede, estado, alerta
- **Editar ubicación física** del lote
- **Ajustar** manualmente si es necesario (casos especiales)

#### Pestaña "Alertas"
- Ver productos vencidos
- Ver productos críticos (≤7 días)
- Ver productos con advertencia (≤30 días)
- Filtrar y exportar reportes

#### Pestaña "Reportes"
- Dashboard por sede
- Valor en riesgo
- Top 10 productos próximos a vencer

---

### 3️⃣ Venta de Productos (FEFO Automático)

**Ruta:** Punto de Venta

El sistema aplica **FEFO (First Expired First Out)** automáticamente:
- ✅ Consume primero el lote que vence antes
- ✅ Genera alertas si vende producto próximo a vencer
- ✅ Registra trazabilidad del lote vendido
- ✅ Actualiza stock de cada lote

**No necesitas hacer nada especial**, el sistema maneja todo automáticamente.

---

## 🔧 Casos Especiales

### Ajuste Manual de Lote
**Cuándo usarlo:**
- Encontraste producto dañado
- Conteo físico difiere del sistema
- Devolución de cliente

**Cómo:**
1. Inventario → Lotes y Vencimientos
2. Buscar el lote
3. Editar cantidad manualmente

---

### Producto Sin Vencimiento que ahora lo Requiere
**Escenario:** Tienes stock de "Arroz" que nunca tuvo vencimiento, pero ahora la nueva regulación exige fechas.

**Solución:**
1. Productos → Editar "Arroz"
2. Activar "Requiere control de vencimiento"
3. Guardar
4. La **próxima compra** pedirá fecha de vencimiento
5. Stock antiguo permanece sin fecha (NULL)

---

### Crear Lote Manualmente (No Recomendado)
**Solo si es absolutamente necesario:**
1. Inventario → Lotes y Vencimientos
2. Clic en "Nuevo Lote (Ajuste Manual)"

**⚠️ IMPORTANTE:** Este método NO queda vinculado a una compra, por lo que pierdes trazabilidad contable. Úsalo solo para ajustes o correcciones.

---

## ❌ Errores Comunes

### ❌ Error: "Expiration date required"
**Causa:** Estás comprando un producto marcado como "Requiere vencimiento" pero no ingresaste fecha.

**Solución:** 
- Opción 1: Ingresar la fecha de vencimiento
- Opción 2: Si NO requiere vencimiento, editar el producto y desactivar esa opción

---

### ❌ Error: Usuarios confundidos sobre dónde registrar compras
**Causa:** Creen que deben crear lotes en "Lotes y Vencimientos"

**Solución:** 
- ✅ **Compras nuevas → Módulo "Compras"**
- 📊 **Consultar/Ajustar → "Lotes y Vencimientos"**

---

## 📋 Checklist Rápido

**Al recibir mercancía del proveedor:**
- [ ] Ir a Compras → Nueva Compra
- [ ] Seleccionar Sede
- [ ] Agregar cada producto
- [ ] Si tiene vencimiento, completar fecha
- [ ] Opcional: Agregar ubicación física (ej: NEVERA-2)
- [ ] Guardar Compra
- [ ] ✅ El lote se crea automáticamente

**Para ver productos próximos a vencer:**
- [ ] Ir a Inventario → Lotes y Vencimientos
- [ ] Pestaña "Alertas"
- [ ] Filtrar por nivel crítico

**Para encontrar ubicación de un producto:**
- [ ] Ir a Inventario → Lotes y Vencimientos
- [ ] Buscar por SKU o nombre
- [ ] Ver columna "Ubicación"

---

## 🎯 Resumen Ejecutivo

| Acción | Dónde Ir | Propósito |
|--------|----------|-----------|
| 📦 Registrar compra nueva | **Compras** → Nueva Compra | Crear lotes automáticamente |
| 📊 Ver lotes existentes | **Inventario** → Lotes y Vencimientos → Lotes | Consultar inventario por lote |
| ⚠️ Ver alertas vencimiento | **Inventario** → Lotes y Vencimientos → Alertas | Control de vencidos/críticos |
| 📈 Ver reportes | **Inventario** → Lotes y Vencimientos → Reportes | Análisis de riesgo |
| 🔧 Ajustar lote manualmente | **Inventario** → Lotes y Vencimientos → Editar | Correcciones puntuales |
| 💳 Vender productos | **Punto de Venta** | FEFO automático |

---

## 🔐 Permisos Requeridos

- **Registrar compras:** Permiso `INVENTORY.ADJUST`
- **Ver lotes:** Permiso `INVENTORY.VIEW`
- **Editar lotes:** Permiso `INVENTORY.ADJUST`
- **Ver reportes:** Permiso `REPORTS.INVENTORY.VIEW`

---

## 📞 Soporte

Para más información técnica:
- `docs/SISTEMA_LOTES_VENCIMIENTO.md` - Documentación completa
- `docs/FRONTEND_LOTES_INTEGRACION.md` - Guía de desarrollo
- `migrations/INTEGRATE_BATCHES_WITH_PURCHASES.sql` - Script SQL de integración

---

**Última actualización:** Febrero 2026
**Versión:** 2.0 - Integración Compras + Lotes
