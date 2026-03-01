/* ============================================================================
   SISTEMA DE MANUFACTURA - FASE 1: FUNCIONES HELPER
   
   ALCANCE:
   Funciones auxiliares para resolver configuración efectiva (jerarquía) y
   validaciones básicas:
   
   1. fn_get_effective_inventory_behavior() - Resolver COALESCE(variant, product, 'RESELL')
   2. fn_get_effective_production_type() - Resolver COALESCE(variant, product, NULL)
   3. fn_get_effective_track_expiry() - Resolver COALESCE(variant, product, category, FALSE)
   4. fn_get_effective_is_component() - Resolver COALESCE(variant, product, FALSE)
   5. fn_get_active_bom() - Obtener BOM activo de variant o product
   6. fn_detect_bom_circular_reference() - Validar ciclos en BOM recursivos
   7. fn_validate_bom_depth() - Validar profundidad máxima BOM
   
   ORDEN DE EJECUCIÓN: 3/6
   PREREQUISITO: MANUFACTURING_PHASE1_ALTER_TABLES.sql
   ============================================================================ */

-- =====================================================================
-- 1. RESOLVER INVENTORY_BEHAVIOR EFECTIVO
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_get_effective_inventory_behavior(
  p_tenant UUID,
  p_variant UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_variant_behavior TEXT;
  v_product_behavior TEXT;
BEGIN
  -- Obtener configuración de variante y producto
  SELECT 
    pv.inventory_behavior,
    p.inventory_behavior
  INTO v_variant_behavior, v_product_behavior
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE pv.tenant_id = p_tenant
    AND pv.variant_id = p_variant
    AND pv.is_active = TRUE
    AND p.is_active = TRUE;
  
  -- Jerarquía: variante > producto > default
  RETURN COALESCE(v_variant_behavior, v_product_behavior, 'RESELL');
END;
$$;

COMMENT ON FUNCTION fn_get_effective_inventory_behavior IS 
  'Resuelve el inventory_behavior efectivo aplicando jerarquía: variant > product > DEFAULT(RESELL)';

-- =====================================================================
-- 2. RESOLVER PRODUCTION_TYPE EFECTIVO
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_get_effective_production_type(
  p_tenant UUID,
  p_variant UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_variant_type TEXT;
  v_product_type TEXT;
BEGIN
  SELECT 
    pv.production_type,
    p.production_type
  INTO v_variant_type, v_product_type
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE pv.tenant_id = p_tenant
    AND pv.variant_id = p_variant
    AND pv.is_active = TRUE
    AND p.is_active = TRUE;
  
  RETURN COALESCE(v_variant_type, v_product_type);
END;
$$;

COMMENT ON FUNCTION fn_get_effective_production_type IS 
  'Resuelve el production_type efectivo. NULL si no es MANUFACTURED.';

-- =====================================================================
-- 3. RESOLVER TRACK_EXPIRY EFECTIVO (YA EXISTE, MEJORAR)
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_variant_requires_expiration(
  p_tenant UUID,
  p_variant UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_variant_track BOOLEAN;
  v_product_track BOOLEAN;
  v_category_track BOOLEAN;
BEGIN
  SELECT 
    pv.track_expiry,
    p.track_expiry,
    c.track_expiry
  INTO v_variant_track, v_product_track, v_category_track
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  LEFT JOIN categories c ON c.category_id = p.category_id
  WHERE pv.tenant_id = p_tenant
    AND pv.variant_id = p_variant
    AND pv.is_active = TRUE
    AND p.is_active = TRUE;
  
  -- Jerarquía: variante > producto > categoría > FALSE
  RETURN COALESCE(v_variant_track, v_product_track, v_category_track, FALSE);
END;
$$;

COMMENT ON FUNCTION fn_variant_requires_expiration IS 
  'Resuelve si variante requiere vencimiento. Jerarquía: variant > product > category > FALSE';

-- =====================================================================
-- 4. RESOLVER IS_COMPONENT EFECTIVO
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_get_effective_is_component(
  p_tenant UUID,
  p_variant UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_variant_is_comp BOOLEAN;
  v_product_is_comp BOOLEAN;
BEGIN
  SELECT 
    pv.is_component,
    p.is_component
  INTO v_variant_is_comp, v_product_is_comp
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE pv.tenant_id = p_tenant
    AND pv.variant_id = p_variant
    AND pv.is_active = TRUE
    AND p.is_active = TRUE;
  
  RETURN COALESCE(v_variant_is_comp, v_product_is_comp, FALSE);
END;
$$;

COMMENT ON FUNCTION fn_get_effective_is_component IS 
  'Resuelve si variante puede ser componente de BOM. Jerarquía: variant > product > FALSE';

-- =====================================================================
-- 5. OBTENER BOM ACTIVO
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_get_active_bom(
  p_tenant UUID,
  p_variant UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_bom_id UUID;
  v_variant_bom UUID;
  v_product_bom UUID;
  v_product_id UUID;
BEGIN
  -- Obtener IDs de BOM de variante y producto
  SELECT 
    pv.bom_id,
    p.bom_id,
    p.product_id
  INTO v_variant_bom, v_product_bom, v_product_id
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE pv.tenant_id = p_tenant
    AND pv.variant_id = p_variant
    AND pv.is_active = TRUE
    AND p.is_active = TRUE;
  
  -- Jerarquía: BOM específico de variante > BOM de producto
  v_bom_id := COALESCE(v_variant_bom, v_product_bom);
  
  -- Validar que el BOM existe y está activo
  IF v_bom_id IS NOT NULL THEN
    SELECT bom_id INTO v_bom_id
    FROM bill_of_materials
    WHERE bom_id = v_bom_id
      AND tenant_id = p_tenant
      AND is_active = TRUE
      AND (
        (variant_id = p_variant) OR 
        (product_id = v_product_id AND variant_id IS NULL)
      );
  END IF;
  
  RETURN v_bom_id;
END;
$$;

COMMENT ON FUNCTION fn_get_active_bom IS 
  'Retorna BOM_ID activo de una variante. Jerarquía: variant.bom_id > product.bom_id. NULL si no tiene BOM.';

-- =====================================================================
-- 6. DETECTAR REFERENCIAS CIRCULARES EN BOM
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_detect_bom_circular_reference(
  p_bom UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_visited UUID[];
  v_stack UUID[];
  v_current_bom UUID;
  v_component_record RECORD;
  v_component_bom UUID;
BEGIN
  v_visited := ARRAY[p_bom];
  v_stack := ARRAY[p_bom];
  
  WHILE array_length(v_stack, 1) > 0 LOOP
    -- Pop del stack
    v_current_bom := v_stack[array_length(v_stack, 1)];
    v_stack := v_stack[1:array_length(v_stack, 1)-1];
    
    -- Obtener todos los componentes del BOM actual
    FOR v_component_record IN
      SELECT bc.component_variant_id, bom.tenant_id
      FROM bom_components bc
      JOIN bill_of_materials bom ON bom.bom_id = bc.bom_id
      WHERE bc.bom_id = v_current_bom
    LOOP
      -- Obtener BOM del componente (si tiene)
      v_component_bom := fn_get_active_bom(
        v_component_record.tenant_id,
        v_component_record.component_variant_id
      );
      
      IF v_component_bom IS NOT NULL THEN
        -- Verificar si ya visitamos este BOM (ciclo detectado)
        IF v_component_bom = ANY(v_visited) THEN
          RETURN TRUE; -- Ciclo detectado
        END IF;
        
        -- Agregar a visited y stack
        v_visited := array_append(v_visited, v_component_bom);
        v_stack := array_append(v_stack, v_component_bom);
      END IF;
    END LOOP;
  END LOOP;
  
  RETURN FALSE; -- No se detectó ciclo
END;
$$;

COMMENT ON FUNCTION fn_detect_bom_circular_reference IS 
  'Detecta si un BOM tiene referencias circulares (componente que se incluye a sí mismo directa o indirectamente). TRUE = ciclo existe.';

-- =====================================================================
-- 7. VALIDAR PROFUNDIDAD DE BOM
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_validate_bom_depth(
  p_tenant UUID,
  p_bom UUID,
  p_max_depth INTEGER DEFAULT 5
)
RETURNS TABLE (
  valid BOOLEAN,
  actual_depth INTEGER,
  deepest_path TEXT[]
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_depth INTEGER := 0;
  v_current_level UUID[];
  v_next_level UUID[];
  v_component_record RECORD;
  v_component_bom UUID;
  v_path TEXT[];
  v_is_valid BOOLEAN;
BEGIN
  -- Iniciar con el BOM raíz
  v_current_level := ARRAY[p_bom];
  v_path := ARRAY['ROOT'];
  
  WHILE array_length(v_current_level, 1) > 0 AND v_depth < p_max_depth LOOP
    v_depth := v_depth + 1;
    v_next_level := ARRAY[]::UUID[];
    
    -- Explorar componentes de todos los BOMs del nivel actual
    FOR v_component_record IN
      SELECT DISTINCT 
        bc.component_variant_id,
        bom.tenant_id,
        pv.sku
      FROM bom_components bc
      JOIN bill_of_materials bom ON bom.bom_id = bc.bom_id
      JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
      WHERE bc.bom_id = ANY(v_current_level)
    LOOP
      -- Obtener BOM del componente (si tiene)
      v_component_bom := fn_get_active_bom(
        v_component_record.tenant_id,
        v_component_record.component_variant_id
      );
      
      IF v_component_bom IS NOT NULL THEN
        v_next_level := array_append(v_next_level, v_component_bom);
        v_path := array_append(v_path, v_component_record.sku);
      END IF;
    END LOOP;
    
    v_current_level := v_next_level;
  END LOOP;
  
  -- Calcular resultado
  v_is_valid := v_depth <= p_max_depth;
  
  -- Retornar resultado usando RETURN QUERY
  RETURN QUERY SELECT v_is_valid, v_depth, v_path;
END;
$$;

COMMENT ON FUNCTION fn_validate_bom_depth IS 
  'Valida que la profundidad de un BOM no exceda el máximo permitido. Retorna: valid, actual_depth, deepest_path.';

-- =====================================================================
-- 8. TRIGGER PARA VALIDAR BOM AL GUARDAR COMPONENTES
-- =====================================================================

CREATE OR REPLACE FUNCTION trg_validate_bom_on_save()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant UUID;
  v_max_depth INTEGER := 5; -- Default
  v_has_cycle BOOLEAN;
  v_depth_result RECORD;
BEGIN
  -- Obtener tenant
  SELECT tenant_id INTO v_tenant
  FROM bill_of_materials
  WHERE bom_id = NEW.bom_id;
  
  -- Intentar obtener configuración (si existe la columna)
  BEGIN
    SELECT max_bom_depth INTO v_max_depth
    FROM tenant_settings
    WHERE tenant_id = v_tenant;
    
    v_max_depth := COALESCE(v_max_depth, 5);
  EXCEPTION 
    WHEN undefined_column THEN
      v_max_depth := 5; -- Usar default si la columna no existe
    WHEN OTHERS THEN
      v_max_depth := 5;
  END;
  
  -- Validar ciclos
  v_has_cycle := fn_detect_bom_circular_reference(NEW.bom_id);
  
  IF v_has_cycle THEN
    RAISE EXCEPTION 'Referencia circular detectada en BOM. El componente % está incluido en su propia cadena de fabricación.', NEW.component_variant_id;
  END IF;
  
  -- Validar profundidad
  SELECT * INTO v_depth_result
  FROM fn_validate_bom_depth(v_tenant, NEW.bom_id, v_max_depth);
  
  IF NOT v_depth_result.valid THEN
    RAISE EXCEPTION 'BOM excede profundidad máxima de %. Profundidad actual: %. Ruta: %', 
      v_max_depth, v_depth_result.actual_depth, array_to_string(v_depth_result.deepest_path, ' → ');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Aplicar trigger
DROP TRIGGER IF EXISTS trg_validate_bom_components ON bom_components;

CREATE TRIGGER trg_validate_bom_components
  AFTER INSERT OR UPDATE ON bom_components
  FOR EACH ROW
  EXECUTE FUNCTION trg_validate_bom_on_save();

COMMENT ON FUNCTION trg_validate_bom_on_save IS 
  'Valida automáticamente que BOM no tenga ciclos ni exceda profundidad máxima al agregar/modificar componentes.';

-- =====================================================================
-- 9. FUNCIÓN PARA OBTENER INFORMACIÓN COMPLETA DE VARIANTE
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_get_variant_manufacturing_info(
  p_tenant UUID,
  p_variant UUID
)
RETURNS TABLE (
  variant_id UUID,
  sku TEXT,
  product_name TEXT,
  
  effective_behavior TEXT,
  effective_production_type TEXT,
  effective_track_expiry BOOLEAN,
  effective_is_component BOOLEAN,
  
  active_bom_id UUID,
  bom_components_count INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pv.variant_id,
    pv.sku,
    p.name,
    
    fn_get_effective_inventory_behavior(p_tenant, pv.variant_id),
    fn_get_effective_production_type(p_tenant, pv.variant_id),
    fn_variant_requires_expiration(p_tenant, pv.variant_id),
    fn_get_effective_is_component(p_tenant, pv.variant_id),
    
    fn_get_active_bom(p_tenant, pv.variant_id),
    (
      SELECT COUNT(*)::INTEGER
      FROM bom_components bc
      WHERE bc.bom_id = fn_get_active_bom(p_tenant, pv.variant_id)
    )
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE pv.tenant_id = p_tenant
    AND pv.variant_id = p_variant
    AND pv.is_active = TRUE
    AND p.is_active = TRUE;
END;
$$;

COMMENT ON FUNCTION fn_get_variant_manufacturing_info IS 
  'Retorna información completa de configuración de manufactura de una variante con jerarquía resuelta.';

-- =====================================================================
-- 10. VERIFICACIÓN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ FUNCIONES HELPER DE MANUFACTURA CREADAS';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones de configuración efectiva (jerarquía):';
  RAISE NOTICE '  ✓ fn_get_effective_inventory_behavior() - COALESCE(variant, product, RESELL)';
  RAISE NOTICE '  ✓ fn_get_effective_production_type() - COALESCE(variant, product, NULL)';
  RAISE NOTICE '  ✓ fn_variant_requires_expiration() - COALESCE(variant, product, category, FALSE)';
  RAISE NOTICE '  ✓ fn_get_effective_is_component() - COALESCE(variant, product, FALSE)';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones de BOM:';
  RAISE NOTICE '  ✓ fn_get_active_bom() - Obtiene BOM activo de variante';
  RAISE NOTICE '  ✓ fn_detect_bom_circular_reference() - Detecta ciclos en BOM recursivos';
  RAISE NOTICE '  ✓ fn_validate_bom_depth() - Valida profundidad máxima BOM';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones auxiliares:';
  RAISE NOTICE '  ✓ fn_get_variant_manufacturing_info() - Info completa variante';
  RAISE NOTICE '';
  RAISE NOTICE 'Triggers:';
  RAISE NOTICE '  ✓ trg_validate_bom_components - Valida BOM al guardar componentes';
  RAISE NOTICE '';
  RAISE NOTICE 'FASE 1 COMPLETADA. SIGUIENTE: Ejecutar MANUFACTURING_PHASE2_SERVICE_BOM.sql';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
