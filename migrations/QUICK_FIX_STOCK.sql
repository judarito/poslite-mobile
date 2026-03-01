/* ============================================================================
   SOLUCIÓN INMEDIATA: Sincronizar Stock
   
   Ejecuta este script para solucionar el problema de stock inmediatamente.
   
   Autor: Sistema
   Fecha: Febrero 2026
   ============================================================================ */

-- Refrescar stock_balances (funciona si es vista materializada)
DO $$
BEGIN
  -- Intentar refrescar vista materializada
  BEGIN
    REFRESH MATERIALIZED VIEW stock_balances;
    RAISE NOTICE '✓ Vista materializada stock_balances refrescada';
  EXCEPTION
    WHEN undefined_table THEN
      RAISE NOTICE '⚠️ stock_balances no es vista materializada';
    WHEN OTHERS THEN
      RAISE NOTICE '⚠️ Error al refrescar: %', SQLERRM;
  END;
  
  -- Intentar ejecutar función de refresco
  BEGIN
    PERFORM fn_refresh_stock_balances();
    RAISE NOTICE '✓ Función fn_refresh_stock_balances ejecutada';
  EXCEPTION
    WHEN undefined_function THEN
      RAISE NOTICE '⚠️ Función fn_refresh_stock_balances no existe';
    WHEN OTHERS THEN
      RAISE NOTICE '⚠️ Error en función: %', SQLERRM;
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ Stock sincronizado. Prueba nuevamente la venta.';
END;
$$ LANGUAGE plpgsql;
