# Centro IA Mobile

Fecha: 2026-03-10  
Pantalla: `AIInsights`  
Ruta interna: `AIInsights` (acceso desde Home y Setup)

## Objetivo

Concentrar en mobile 8 analisis operativos con enfoque accionable:

1. Inventario IA (`inventory_watch`)
2. Compras IA (`purchase_advisor`)
3. Ventas IA (`sales_analyst`)
4. Cajas IA (`cash_audit`)
5. Cartera IA (`portfolio_collector`)
6. Produccion IA (`production_planner`)
7. Terceros IA (`thirdparty_segmenter`)
8. Dashboard IA (`executive_brief`)

## Implementacion

- Servicio: `src/services/aiInsights.service.js`
  - Analitica deterministica por insight.
  - Cache local por insight usando `offlineCache.saveSimpleCache/getSimpleCache`.
  - Parser deterministico de consulta natural (`resolveAiInsightByText`).
  - Motor de ruteo natural con fallback (`resolveAiInsightByTextWithFallback`):
    - `cache_lookup -> deterministic_parser -> local_llm -> cloud_llm`
    - En offline: `cache_lookup -> deterministic_parser -> local_llm` (sin cloud).
- Servicio de narrativa IA: `src/services/aiInsightNarrative.service.js`
  - Toma el resultado deterministico como contexto.
  - Genera resumen narrativo y acciones por fallback `local llm -> cloud llm`.
  - Si falla red/LLM, usa cache local de narrativa por insight.
- UI: `src/screens/AIInsightsScreen.js`
  - Ejecutar insight individual.
  - Ejecutar los 8 insights.
  - Consulta natural para enrutar al insight correcto.
  - Visualizacion de KPIs, hallazgos, recomendaciones y narrativa IA.

## Modo offline

- Si `offlineMode=true`, el centro IA intenta devolver el ultimo resultado cacheado del insight.
- Si no existe cache para ese insight, devuelve error de disponibilidad offline.
- Para narrativa IA aplica la misma regla: cache de narrativa por insight.

## Fuentes de datos por insight

- Inventario/Compras/Produccion: `inventoryCatalog.service`.
- Ventas/Dashboard: `sales`, `sale_lines`, `reports.service`.
- Cajas: `cashMenu.service`.
- Cartera: `credit.service` + `customer_credit_movements`.
- Terceros: `thirdParties.service` + `sales`.

## Notas

- Los valores numericos del negocio se mantienen deterministas.
- La capa LLM solo agrega interpretacion, prioridades y lenguaje natural.
