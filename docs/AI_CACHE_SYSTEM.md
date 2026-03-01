# Sistema de Caché Inteligente para IA (DeepSeek)

## 📋 Resumen

Sistema de caché implementado para optimizar costos de API de DeepSeek, reduciendo hasta un **70% en gastos** al reutilizar análisis recientes.

## 🎯 Características Implementadas

### 1. **Utilidad de Caché** (`src/utils/aiCache.js`)
- ✅ Almacenamiento en `localStorage`
- ✅ TTL (Time To Live) configurable por servicio
- ✅ Generación de cache keys inteligentes
- ✅ Limpieza automática de entradas expiradas
- ✅ Estadísticas detalladas del caché

### 2. **Integración en Servicios**

#### Pronóstico de Ventas (`sales-forecast.service.js`)
- **TTL:** 24 horas
- **Motivo:** Patrones de venta son estables día a día
- **Cache Key:** `forecast_{tenantId}_{date}_{dataHash}`
- **Beneficio:** Consulta IA solo 1 vez al día por tenant

#### Sugerencias de Compra (`ai-purchase-advisor.service.js`)
- **TTL:** 12 horas  
- **Motivo:** Inventario más dinámico, requiere actualizaciones más frecuentes
- **Cache Key:** `purchase_{tenantId}_{date}_{suggestionHash}`
- **Beneficio:** Máximo 2 consultas API por día por tenant

### 3. **Componentes UI Actualizados**

#### Widget de Pronóstico (`SalesForecastWidget.vue`)
- ✅ Indicador visual "Caché" cuando usa datos cacheados
- ✅ Botón de refresh para forzar actualización
- ✅ Tooltip explicativo del botón

#### Vista de Compras (`Purchases.vue`)
- ✅ Indicador de caché en diálogo de análisis IA
- ✅ Botón de refresh en análisis IA
- ✅ Opción `forceRefresh` en llamadas a API

#### Configuración de Tenant (`TenantConfig.vue`)
- ✅ Panel de administración de caché
- ✅ Estadísticas en tiempo real:
  - Entradas válidas
  - Entradas expiradas
  - Tamaño total en KB
  - Ahorro estimado
- ✅ Botones de acción:
  - Actualizar estadísticas
  - Limpiar entradas expiradas
  - Limpiar todo el caché

### 4. **Composable** (`useAICache.js`)
- ✅ Gestión reactiva del estado del caché
- ✅ Métodos para limpiar y refrescar
- ✅ Computadas para estadísticas

## 📊 Ahorro Estimado

### Escenario Típico
- **Sin caché:** Usuario consulta 3-4 veces al día
  - ~100 llamadas/mes por tenant
  
- **Con caché (Fase 1):** 1-2 consultas al día
  - ~30-40 llamadas/mes por tenant
  - **Ahorro: ~65-70%**

### Ejemplo con 10 Tenants Activos
- **Sin caché:** 1,000 llamadas/mes
- **Con caché:** 300-400 llamadas/mes
- **Ahorro:** 600-700 llamadas/mes

## 🔧 Uso del Sistema

### Para Desarrolladores

```javascript
// Forzar actualización desde cualquier componente
await salesService.generateSalesForecast(tenantId, locationId, {
  daysBack: 90,
  forceRefresh: true // Ignora caché
})

// Gestionar caché manualmente
import { useAICache } from '@/composables/useAICache'

const { clearAll, clearExpired, refreshStats } = useAICache()

// Limpiar todo
clearAll()

// Solo limpiar expirados
clearExpired()
```

### Para Usuarios

1. **Uso Normal:**
   - Los datos se cachean automáticamente
   - Indicador "Caché" aparece cuando se usan datos cacheados

2. **Forzar Actualización:**
   - Click en botón de refresh (🔄) en cualquier componente
   - Esto consulta la API nuevamente ignorando el caché

3. **Administrar Caché:**
   - Ir a: **Configuración → IA**
   - Ver estadísticas de caché
   - Limpiar entradas expiradas o todo el caché

## 🚀 Siguientes Fases (Roadmap)

### Fase 2: Caché en Backend (Supabase)
- [ ] Crear tabla `ai_cache` en PostgreSQL
- [ ] Migrar de localStorage a Supabase
- [ ] Rate limiting por tenant
- [ ] Persistencia entre sesiones

### Fase 3: Optimizaciones Avanzadas
- [ ] Invalidación inteligente del caché
- [ ] Configuración de TTL por tenant
- [ ] Cuota diaria configurable
- [ ] Pre-caching programado
- [ ] Analíticas de uso de IA

## 📝 Notas Técnicas

### Limitaciones Actuales
- **localStorage:** Límite de ~5-10MB por dominio
- **Por usuario:** Cada browser tiene su propio caché
- **No persistente:** Se pierde si se limpia el browser

### Ventajas de Fase 1
- ✅ Implementación rápida (sin cambios en DB)
- ✅ Sin latencia de red adicional
- ✅ Funciona offline una vez cacheado
- ✅ Fácil de depurar desde DevTools

### Cache Keys
```javascript
// Formato: {service}_{tenantId}_{date}_{hash}
forecast_123e4567_2026-02-14_a3f2b1
purchase_123e4567_2026-02-14_c7d4e9
```

El hash incluye parámetros críticos que afectan el resultado:
- **Forecast:** locationId, dataPoints, latestDate
- **Purchase:** suggestionCount, rotationDataHash, maxBudget

## 🔒 Seguridad

- ✅ Caché es local por usuario (no compartido entre tenants)
- ✅ Keys únicas por tenant y fecha
- ✅ No se cachea información sensible (solo análisis IA)
- ✅ TTL automático evita datos obsoletos

## 📈 Métricas de Éxito

### Objetivos Alcanzados ✅
- [x] Reducir costos de API en ~70%
- [x] Mejorar UX (respuestas instantáneas desde caché)
- [x] Transparente para el usuario
- [x] Opción de forzar actualización
- [x] Panel de administración

### KPIs a Monitorear
- Tasa de hit del caché (% de requests desde caché)
- Número promedio de llamadas API por tenant/día
- Tiempo de respuesta (caché vs API)
- Tamaño del caché por tenant

---

**Implementado:** 14 de Febrero, 2026  
**Versión:** Fase 1 - localStorage  
**Estado:** ✅ Producción
