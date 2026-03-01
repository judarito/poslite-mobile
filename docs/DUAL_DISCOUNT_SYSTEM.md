# Sistema de Descuentos Duales (Línea + Global)

## 📋 Resumen

El sistema ahora soporta **dos tipos de descuentos independientes y acumulativos**:

1. **Descuento de Línea**: Aplicado individualmente a cada producto
2. **Descuento Global**: Distribuido proporcionalmente sobre el subtotal después de descuentos de línea

## 🎯 Orden de Aplicación (Correcto Según Estándares)

```
1. Precio Base × Cantidad = Subtotal Línea
2. Aplicar Descuento de Línea
3. Subtotal con Desc. Línea
4. Distribuir Descuento Global Proporcionalmente
5. Base Gravable (Subtotal - Desc. Línea - Desc. Global)
6. Calcular Impuestos sobre Base Gravable
7. Total Final
```

## 💡 Ejemplo Práctico

### Escenario: Venta con 2 productos

| Producto | Precio | Cantidad | Subtotal | Desc. Línea (10%) | Subtotal c/Desc |
|----------|--------|----------|----------|-------------------|-----------------|
| A        | $10.000| 1        | $10.000  | -$1.000           | $9.000          |
| B        | $3.000 | 1        | $3.000   | $0                | $3.000          |
| **TOTAL**| -      | -        | **$13.000** | **-$1.000**    | **$12.000**     |

**Aplicar Descuento Global: $1.200 fijo**

Distribución proporcional:
- Producto A: 9.000 / 12.000 × 1.200 = $900
- Producto B: 3.000 / 12.000 × 1.200 = $300

### Resultado Final

| Producto | Subtotal | Desc. Línea | Desc. Global | Base Gravable | IVA (19%) | Total |
|----------|----------|-------------|--------------|---------------|-----------|-------|
| A        | $10.000  | -$1.000     | -$900        | $8.100        | $1.539    | $9.639|
| B        | $3.000   | $0          | -$300        | $2.700        | $513      | $3.213|
| **TOTAL**| **$13.000** | **-$1.000** | **-$1.200** | **$10.800** | **$2.052** | **$12.852** |

## 🏗 Estructura de Datos

### Objeto de Línea de Venta (Frontend)

```javascript
{
  variant_id: 'uuid',
  productName: 'Producto X',
  quantity: 1,
  unit_price: 10000,
  
  // Descuento de línea (editable por usuario)
  discount_line: 1000,
  discount_line_type: 'AMOUNT', // o 'PERCENT'
  
  // Descuento global distribuido (calculado automáticamente)
  discount_global: 900,
  
  // Total de descuentos (suma de ambos, se envía al backend)
  discount: 1900,
  discount_type: 'AMOUNT', // Siempre AMOUNT porque ya está calculado
  
  // Impuestos y totales
  tax_rate: 0.19,
  tax_amount: 1539,
  line_total: 9639
}
```

### Backend (Database)

El backend recibe `discount` como valor total calculado en `AMOUNT`, por lo que **no requiere cambios en la base de datos**.

## 🎨 UI/UX

### Panel de Totales

```
Subtotal:          $13.000
Desc. Línea:       - $1.000
Desc. Global:      - $1.200
─────────────────────────────
Impuestos:         + $2.052
═════════════════════════════
TOTAL:             $12.852
```

### Descuento de Línea (por producto)

- Toggle button: **$** (monto fijo) o **%** (porcentaje)
- Campo numérico para ingresar valor
- Se aplica individualmente a cada producto

### Descuento Global (administrador)

- Botón: "Aplicar Descuento Global"
- Dialog con:
  - Radio button: Porcentaje o Monto Fijo
  - Campo numérico
- Se distribuye proporcionalmente
- Botón "X" para remover descuento global

## ✅ Reglas de Negocio

### Validaciones

1. ✅ Descuento de línea no puede exceder el subtotal de la línea
2. ✅ Descuento global no puede exceder el subtotal después de descuentos de línea
3. ✅ Solo usuarios ADMINISTRADOR pueden aplicar descuento global
4. ✅ Porcentajes limitados según configuración del tenant (`maxDiscountWithoutAuth`)
5. ✅ El total final nunca puede ser negativo

### Distribución Proporcional

El descuento global se distribuye **proporcionalmente** según el subtotal de cada línea después de su descuento individual:

```javascript
proportion = (lineSubtotal - lineDiscount) / totalBeforeGlobalDiscount
lineGlobalDiscount = globalDiscountAmount × proportion
```

Esto asegura que:
- Los impuestos se calculen correctamente por línea
- La contabilidad sea precisa
- El total sea consistente

## 🔄 Flujo de Trabajo

### 1. Usuario agrega productos al carrito
- Cada producto inicia con `discount_line = 0`

### 2. Usuario aplica descuentos de línea (opcional)
- Edita campo de descuento por producto
- Cambia tipo ($ o %)
- Se recalculan impuestos automáticamente

### 3. Usuario aplica descuento global (opcional, solo admin)
- Abre dialog "Aplicar Descuento Global"
- Selecciona tipo (porcentaje o monto fijo)
- Ingresa valor
- Sistema distribuye proporcionalmente
- Se recalculan impuestos

### 4. Usuario puede ajustar descuento global
- Botón cambia a "Ajustar Descuento Global"
- Puede remover con botón "X"
- Puede aplicar nuevo valor (reemplaza el anterior)

### 5. Procesamiento de venta
- Backend recibe `discount` total (línea + global) por línea
- Stored procedure calcula impuestos y totales
- Se registra la venta

## 🚀 Ventajas del Sistema

### Contabilidad Precisa
- Cada línea registra el descuento total aplicado
- Los impuestos se calculan sobre la base correcta
- Auditoría clara de descuentos

### Flexibilidad Comercial
- Promociones por producto (descuento de línea)
- Negociación comercial (descuento global)
- Ambos pueden coexistir

### UX Clara
- Usuario ve ambos descuentos separados en totales
- Sabe exactamente qué descuento proviene de dónde
- Fácil ajustar o remover descuento global

### Mantenibilidad
- Estructura de datos clara
- Lógica separada y documentada
- Fácil extender con nuevas reglas

## 📝 Archivos Modificados

- [src/views/PointOfSale.vue](../src/views/PointOfSale.vue) - Vista principal de POS con sistema dual
- [src/views/LayawayContracts.vue](../src/views/LayawayContracts.vue) - Plan Separé (solo desc. línea por ahora)
- [docs/FLEXIBLE_DISCOUNTS_SYSTEM.md](./FLEXIBLE_DISCOUNTS_SYSTEM.md) - Sistema de tipos de descuento

## 🔮 Futuras Mejoras

### Layaway/Plan Separé
- Agregar descuento global también en contratos de plan separé
- Misma lógica de distribución proporcional

### Autorización de Descuentos
- Requerir PIN de supervisor para descuentos > X%
- Log de auditoría de descuentos aplicados

### Reportes
- Reporte de descuentos por tipo (línea vs global)
- Análisis de margen con descuentos desagregados
- Comparativa de efectividad de promociones

### Reglas de Descuento
- Sistema de reglas automáticas (ej: 2x1, 3x2)
- Descuentos por cliente (fidelidad)
- Descuentos por método de pago

---

**Fecha de implementación**: 2026-02-14  
**Versión**: 1.0  
**Estado**: ✅ Implementado en PointOfSale.vue
