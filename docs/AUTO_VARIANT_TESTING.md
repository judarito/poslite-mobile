# 🧪 Testing Plan: Auto-generación de Variantes Predeterminadas

## 📋 Checklist de Testing

### ✅ Fase 1: Backend (Base de Datos)

#### 1.1 Testing de Funciones SQL

- [ ] **fn_generate_unique_sku()**
  ```sql
  -- Ejecutar en psql:
  SET app.current_tenant_id = 'tu-tenant-id';
  
  -- Test 1: SKU único generado correctamente
  SELECT fn_generate_unique_sku(
    'tu-tenant-id'::UUID, 
    'Coca Cola 350ml'
  );
  -- Esperado: COC-260218-XXXX (donde XXXX es random de 4 dígitos)
  
  -- Test 2: Producto con pocos caracteres
  SELECT fn_generate_unique_sku(
    'tu-tenant-id'::UUID, 
    'Sal'
  );
  -- Esperado: SAL-260218-XXXX o PRD-260218-XXXX
  
  -- Test 3: Producto con caracteres especiales
  SELECT fn_generate_unique_sku(
    'tu-tenant-id'::UUID, 
    'Arroz (Premium) 500g'
  );
  -- Esperado: ARR-260218-XXXX
  ```

- [ ] **fn_create_default_variant()**
  ```sql
  -- Test 1: Crear variante con datos completos
  SELECT fn_create_default_variant(
    p_tenant_id := 'tu-tenant-id'::UUID,
    p_product_id := (SELECT product_id FROM products LIMIT 1),
    p_product_name := 'Producto Test',
    p_base_cost := 1000,
    p_base_price := 1500,
    p_unit_id := (SELECT unit_id FROM units_of_measure WHERE code = 'UND' LIMIT 1)
  );
  -- Esperado: UUID de variante creada
  
  -- Verificar variante creada:
  SELECT * FROM product_variants WHERE variant_name = 'Predeterminado' ORDER BY created_at DESC LIMIT 1;
  -- Verificar: SKU único, cost=1000, price=1500, is_active=TRUE
  ```

- [ ] **Trigger trg_auto_create_default_variant**
  ```sql
  -- Test 1: Insertar producto nuevo
  INSERT INTO products (tenant_id, name, base_cost, base_price, unit_id)
  VALUES (
    'tu-tenant-id'::UUID,
    'Test Auto Variant',
    2000,
    3000,
    (SELECT unit_id FROM units_of_measure WHERE code = 'UND' LIMIT 1)
  );
  
  -- Verificar variante auto-creada:
  SELECT 
    p.name AS producto,
    pv.sku,
    pv.variant_name,
    pv.cost,
    pv.price,
    pv.is_active
  FROM products p
  JOIN product_variants pv ON pv.product_id = p.product_id
  WHERE p.name = 'Test Auto Variant';
  -- Esperado: 1 variante "Predeterminado" con SKU único, cost=2000, price=3000
  ```

#### 1.2 Testing de Constraints

- [ ] **SKU Único**
  ```sql
  -- Intentar crear variante con SKU duplicado (debe fallar)
  INSERT INTO product_variants (tenant_id, product_id, sku, cost, price)
  VALUES (
    'tu-tenant-id'::UUID,
    (SELECT product_id FROM products LIMIT 1),
    'COC-260218-1234',  -- SKU existente
    0,
    0
  );
  -- Esperado: ERROR duplicate key value violates unique constraint
  ```

- [ ] **Variante NULL Única por Producto**
  ```sql
  -- Verificar que solo existe 1 variante con variant_name='Predeterminado' por producto
  SELECT product_id, COUNT(*) 
  FROM product_variants 
  WHERE variant_name = 'Predeterminado'
  GROUP BY product_id
  HAVING COUNT(*) > 1;
  -- Esperado: 0 resultados (no debe haber duplicados)
  ```

---

### ✅ Fase 2: Frontend (Vue.js)

#### 2.1 Formulario Create Producto

- [ ] **Campos base_cost y base_price visibles**
  - Abrir diálogo "Nuevo Producto"
  - Verificar campos "Costo Base" y "Precio Base" presentes
  - Verificar alert informativo: "Se generará automáticamente una variante..."

- [ ] **Validaciones**
  - Intentar guardar con costo/precio negativos → Debe mostrar error
  - Intentar guardar con campos vacíos → Debe usar defaults (0)
  - Guardar con valores válidos → Debe crear producto + variante

- [ ] **Flujo completo: Crear producto simple**
  ```
  1. Click "Nuevo Producto"
  2. Nombre: "Coca Cola 350ml"
  3. Categoría: Bebidas
  4. Unidad: UND (Unidad)
  5. Costo Base: 1500
  6. Precio Base: 2000
  7. Click "Crear"
  8. Verificar:
     - Mensaje: "Producto creado con variante predeterminada"
     - Diálogo se cierra inmediatamente (NO queda en modo edición)
     - Producto aparece en lista con variante
  ```

- [ ] **Network Request (DevTools)**
  - Abrir DevTools → Network
  - Crear producto
  - Verificar payload enviado incluye:
    ```json
    {
      "name": "Coca Cola 350ml",
      "base_cost": 1500,
      "base_price": 2000,
      ...
    }
    ```
  - Verificar respuesta incluye producto Y variante:
    ```json
    {
      "success": true,
      "data": {
        "product_id": "...",
        "name": "Coca Cola 350ml",
        "variants": [
          {
            "variant_id": "...",
            "sku": "COC-260218-1234",
            "variant_name": "Predeterminado",
            "cost": 1500,
            "price": 2000
          }
        ]
      }
    }
    ```

#### 2.2 Editar Producto Existente

- [ ] **Producto con variante única**
  - Abrir edición de producto con variante predeterminada
  - Verificar campos cost/price muestran valores de la variante
  - Modificar valores → Guardar
  - Verificar actualización exitosa

- [ ] **Producto con múltiples variantes**
  - Crear producto
  - Agregar segunda variante manualmente
  - Editar producto
  - Verificar que ambas variantes aparecen en lista
  - Verificar campos base_cost/base_price NO afectan variantes existentes

---

### ✅ Fase 3: Integración

#### 3.1 Ventas (POS)

- [ ] **Vender producto con variante predeterminada**
  ```
  1. Ir a Punto de Venta
  2. Buscar producto creado con auto-variante
  3. Agregar al carrito
  4. Verificar:
     - Precio correcto (base_price configurado)
     - SKU mostrado en item
     - Venta se completa sin errores
  5. Verificar en BD:
     SELECT * FROM sale_items WHERE variant_id IN (
       SELECT variant_id FROM product_variants WHERE variant_name = 'Predeterminado'
     );
  ```

#### 3.2 Inventario

- [ ] **Ajuste de inventario**
  ```
  1. Ir a Inventario → Ajustes
  2. Seleccionar producto con variante predeterminada
  3. Realizar ajuste de entrada (ej: +10 unidades)
  4. Verificar en BD:
     SELECT * FROM inventory_movements WHERE variant_id IN (
       SELECT variant_id FROM product_variants WHERE variant_name = 'Predeterminado'
     );
  ```

- [ ] **Alertas de stock mínimo**
  - Configurar min_stock > 0 en variante predeterminada
  - Reducir stock por debajo del mínimo
  - Verificar alerta se genera correctamente

#### 3.3 Reportes

- [ ] **Reporte de productos**
  - Generar reporte de inventario
  - Verificar productos con variante predeterminada aparecen
  - Verificar columnas: SKU, Costo, Precio, Stock

- [ ] **Reporte de ventas por producto**
  - Vender productos con variantes predeterminadas
  - Generar reporte de ventas
  - Verificar aparecen correctamente agrupados

---

### ✅ Fase 4: Migración de Datos Legacy

#### 4.1 Antes de Ejecutar Migración

- [ ] **Backup de base de datos**
  ```bash
  pg_dump -U postgres -d pos_lite > backup_before_migration.sql
  ```

- [ ] **Identificar productos sin variantes**
  ```sql
  SELECT COUNT(*) FROM products p
  WHERE NOT EXISTS (
    SELECT 1 FROM product_variants pv 
    WHERE pv.product_id = p.product_id
  );
  ```

#### 4.2 Ejecutar Migración

- [ ] **Ejecutar script**
  ```bash
  psql -U postgres -d pos_lite -f "e:\Dev\POSLite\App\migrations\MIGRATE_PRODUCTS_DEFAULT_VARIANTS.sql"
  ```

- [ ] **Revisar output**
  - Verificar "Variantes creadas exitosamente: X"
  - Verificar "Errores encontrados: 0"
  - Si hay errores, revisar warnings en output

#### 4.3 Post-Migración

- [ ] **Verificación SQL**
  ```sql
  -- No debe haber productos sin variantes
  SELECT COUNT(*) FROM products p
  WHERE NOT EXISTS (
    SELECT 1 FROM product_variants pv 
    WHERE pv.product_id = p.product_id
  );
  -- Esperado: 0
  
  -- Ver variantes creadas
  SELECT 
    p.name,
    pv.sku,
    pv.cost,
    pv.price,
    pv.created_at
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE pv.variant_name = 'Predeterminado'
  ORDER BY pv.created_at DESC;
  ```

- [ ] **Actualizar precios/costos**
  - Revisar productos migrados con cost=0, price=0
  - Actualizar manualmente en frontend o con SQL:
    ```sql
    UPDATE product_variants pv
    SET 
      cost = 1000,  -- Ajustar por producto
      price = 1500
    WHERE variant_name = 'Predeterminado'
    AND cost = 0;
    ```

---

### ✅ Fase 5: Casos Especiales

#### 5.1 Tipos de Inventario

- [ ] **Producto RESELL**
  - Crear producto tipo RESELL
  - Verificar variante creada con track_inventory=TRUE
  - Verificar puede registrar entradas/salidas stock

- [ ] **Producto SERVICE**
  - Crear producto tipo SERVICE
  - Verificar variante creada con track_inventory=FALSE
  - Verificar NO permite ajustes de inventario

- [ ] **Producto MANUFACTURED**
  - Crear producto tipo MANUFACTURED
  - Verificar variante creada correctamente
  - Verificar puede crear BOM asociado

- [ ] **Producto BUNDLE**
  - Crear producto tipo BUNDLE
  - Verificar variante creada con track_inventory=FALSE
  - Verificar inventario calculado de componentes

#### 5.2 Multi-tenant

- [ ] **Productos en diferentes tenants**
  ```sql
  -- Crear producto en Tenant A
  SET app.current_tenant_id = 'tenant-a-id';
  INSERT INTO products (tenant_id, name, base_cost, base_price)
  VALUES ('tenant-a-id'::UUID, 'Producto Tenant A', 1000, 1500);
  
  -- Crear producto en Tenant B con mismo nombre
  SET app.current_tenant_id = 'tenant-b-id';
  INSERT INTO products (tenant_id, name, base_cost, base_price)
  VALUES ('tenant-b-id'::UUID, 'Producto Tenant A', 2000, 3000);
  
  -- Verificar SKUs únicos por tenant
  SELECT tenant_id, sku FROM product_variants 
  WHERE variant_name = 'Predeterminado' 
  ORDER BY created_at DESC LIMIT 2;
  -- Esperado: 2 SKUs diferentes (no colisionan entre tenants)
  ```

#### 5.3 Performance

- [ ] **Tiempo de creación**
  - Medir tiempo de crear producto (DevTools → Network)
  - Esperado: < 500ms (incluye trigger + variante)

- [ ] **Carga de lista de productos**
  - Lista con 100+ productos (algunos con variante única, otros con múltiples)
  - Esperado: Carga < 1 segundo

---

## 🐛 Troubleshooting

### Problema: Trigger no crea variante

**Síntomas:**
- Producto creado sin error
- Variante NO aparece en product_variants

**Diagnóstico:**
```sql
-- Verificar trigger existe
SELECT * FROM pg_trigger WHERE tgname = 'trg_auto_create_default_variant';

-- Verificar función existe
\df fn_create_default_variant
\df fn_generate_unique_sku

-- Ejecutar manualmente función
SELECT fn_create_default_variant(
  'tenant-id'::UUID,
  'product-id'::UUID,
  'Test Product',
  1000,
  1500,
  NULL
);
```

**Solución:**
- Re-ejecutar script AUTO_CREATE_DEFAULT_VARIANT.sql

---

### Problema: SKU duplicados

**Síntomas:**
- Error: "duplicate key value violates unique constraint"

**Diagnóstico:**
```sql
-- Ver SKUs duplicados
SELECT sku, COUNT(*) FROM product_variants GROUP BY sku HAVING COUNT(*) > 1;
```

**Solución:**
- Aumentar aleatoridad en fn_generate_unique_sku()
- Considerar agregar timestamp con microsegundos

---

### Problema: Frontend no envía base_cost/base_price

**Síntomas:**
- Variantes creadas con cost=0, price=0 siempre

**Diagnóstico:**
- Revisar DevTools → Network → Payload de POST /products
- Verificar campos base_cost/base_price en payload

**Solución:**
- Verificar formData.value incluye base_cost y base_price
- Verificar campos NO tienen :disabled

---

## 📊 Métricas de Éxito

- [✅] 100% productos tienen al menos 1 variante
- [✅] 0 errores al crear productos nuevos
- [✅] Tiempo creación < 500ms
- [✅] Ventas con variantes predeterminadas funcionan
- [✅] Inventario con variantes predeterminadas funciona
- [✅] Reportes muestran productos correctamente
- [✅] Migración completada sin errores

---

## 🎯 Sign-off

| Fase | Estado | Fecha | Responsable | Notas |
|------|--------|-------|-------------|-------|
| Backend SQL | ⏳ Pendiente | | | |
| Frontend Vue | ⏳ Pendiente | | | |
| Integración | ⏳ Pendiente | | | |
| Migración | ⏳ Pendiente | | | |
| UAT | ⏳ Pendiente | | | |

**Aprobado para producción:** [ ] Sí  [ ] No

**Comentarios:**
