# 🤖 Sistema de Sugerencias Inteligentes de Compra con IA

## Descripción General

Sistema avanzado de análisis y recomendaciones de compra que combina **análisis basado en reglas** con **inteligencia artificial (DeepSeek)** para optimizar la gestión de inventario.

## 🎯 Características Principales

### 1. **Análisis Basado en Reglas (Sistema Base)**
- Monitoreo de rotación de inventario en tiempo real
- Análisis de demanda diaria promedio (30/90 días)
- Detección automática de productos agotados
- Cálculo de días de stock restante
- Tendencias de crecimiento/decrecimiento
- Priorización automática (Crítico/Alto/Medio)

### 2. **Análisis IA Avanzado (DeepSeek)**
- **Detección de patrones complejos**: Estacionalidad, correlaciones entre productos
- **Predicción de demanda mejorada**: Considera múltiples variables históricas
- **Insights estratégicos**: Oportunidades, riesgos, anomalías
- **Ajuste inteligente de cantidades**: Basado en tendencias y comportamiento histórico
- **Análisis de confianza**: Score de 0-100% por cada recomendación
- **ROI estimado**: Días estimados para recuperar inversión
- **Alertas inteligentes**: Advertencias críticas personalizadas
- **Consejos de optimización**: Recomendaciones accionables

## 📊 Componentes del Sistema

### Backend

#### `ai-purchase-advisor.service.js`
Servicio principal de IA que:
- Se conecta a la API de DeepSeek
- Formatea datos de inventario y ventas para análisis
- Genera prompts contextuales para el LLM
- Parsea y estructura respuestas de IA
- Calcula métricas de confianza y ROI

**Métodos principales:**
- `generatePurchaseRecommendations()`: Análisis completo con IA
- `generateExecutiveSummary()`: Resumen ejecutivo de resultados
- `isAvailable()`: Verifica disponibilidad del servicio

#### `purchases.service.js`
Servicio integrado que:
- Obtiene sugerencias base del sistema (SQL)
- Coordina análisis de IA
- Combina resultados de ambos sistemas

**Métodos principales:**
- `getPurchaseSuggestions()`: Sugerencias base (SQL)
- `getInventoryRotationAnalysis()`: Métricas de rotación
- `getAIPurchaseAnalysis()`: Análisis IA completo
- `isAIAvailable()`: Estado del servicio de IA

### Frontend

#### `Purchases.vue`
Interfaz completa con:

**Sugerencias Base:**
- Dialog con tabs por prioridad (Crítico/Alto/Medio)
- Vista detallada de cada sugerencia
- Resumen de inversión total
- Agregar productos individuales o en lote

**Análisis IA Avanzado:**
- Panel ejecutivo con métricas clave
- Insights estratégicos expandibles
- Advertencias destacadas
- Consejos de optimización
- Sugerencias enriquecidas con IA
- Filtros por criticidad y confianza
- Comparación: cantidad sistema vs. IA

### Base de Datos

#### Vista: `vw_inventory_rotation_analysis`
CTE complejo que analiza:
- Ventas últimos 30/90 días
- Velocidad de rotación
- Demanda diaria promedio
- Días de stock restante
- Tendencias de crecimiento

#### Función: `fn_get_purchase_suggestions()`
Algoritmo que:
- Prioriza productos según urgencia
- Calcula cantidades sugeridas
- Genera razones detalladas
- Filtra por umbral de prioridad

## 🚀 Configuración

### 1. Obtener API Key de DeepSeek

```bash
# Visitar: https://platform.deepseek.com/
# Crear cuenta y generar API key
```

### 2. Configurar Variable de Entorno

Agregar al archivo `.env`:

```env
VITE_DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Verificar Instalación

El sistema detecta automáticamente si la API key está configurada y muestra/oculta el botón de análisis IA según disponibilidad.

## 📖 Uso

### Sugerencias Base (Sin IA)

1. Ir al módulo **Compras**
2. Clic en **"Sugerencias IA"** (disponible siempre)
3. Revisar productos por prioridad:
   - **Crítico**: Agotados con demanda activa
   - **Alto**: Bajo stock mínimo o <7 días
   - **Medio**: Stock bajo con demanda creciente
4. Agregar productos individuales o crear orden completa

### Análisis IA Avanzado (Con DeepSeek)

1. Clic en **"Análisis IA Avanzado"** (requiere API key)
2. Esperar 10-30 segundos mientras la IA analiza
3. Revisar:
   - **Resumen Ejecutivo**: Métricas clave y recomendación principal
   - **Insights Estratégicos**: Patrones detectados, oportunidades, riesgos
   - **Advertencias**: Alertas críticas
   - **Consejos**: Tips de optimización
   - **Sugerencias Mejoradas**: Productos con análisis IA
4. Filtrar por:
   - Todas las sugerencias
   - Solo críticas
   - Alta confianza (>80%)
5. Agregar productos con cantidades ajustadas por IA

## 🎨 Estructura de Datos

### Respuesta de IA

```typescript
{
  suggestions: [{
    variant_id: uuid,
    product_name: string,
    ai_priority: 1-5,
    ai_suggested_qty: number,
    ai_reasoning: string,
    ai_confidence: 0.0-1.0,
    ai_estimated_roi_days: number,
    has_ai_analysis: boolean
  }],
  insights: [{
    type: 'opportunity' | 'risk' | 'pattern',
    title: string,
    description: string,
    impact: 'high' | 'medium' | 'low'
  }],
  warnings: [{
    severity: 'critical' | 'high' | 'medium',
    product_name: string,
    message: string
  }],
  optimization_tips: [{
    title: string,
    description: string,
    expected_benefit: string
  }],
  executive_summary: {
    critical_products_count: number,
    total_investment: number,
    high_confidence_count: number,
    key_insight: string,
    top_warning: string,
    recommendation: string
  }
}
```

## 🔧 Personalización

### Ajustar Contexto del Negocio

En `Purchases.vue`, método `loadAIAnalysis()`:

```javascript
const result = await purchasesService.getAIPurchaseAnalysis(tenantId.value, {
  businessContext: 'Tu descripción del negocio aquí',
  maxBudget: 10000000, // Presupuesto máximo
  priorityLevel: 3 // 1=Solo críticos, 2=Críticos+Altos, 3=Todos
})
```

### Modificar Prompt del Sistema

En `ai-purchase-advisor.service.js`, método `_getSystemPrompt()`:
- Ajustar instrucciones para la IA
- Cambiar formato de respuesta
- Agregar métricas personalizadas

### Ajustar Parámetros del Modelo

En `ai-purchase-advisor.service.js`, método `generatePurchaseRecommendations()`:

```javascript
{
  model: DEEPSEEK_MODEL,
  temperature: 0.3, // 0.0-1.0 (más bajo = más determinístico)
  max_tokens: 4000, // Tokens máximos de respuesta
  stream: false
}
```

## 📊 Métricas y KPIs

### Sistema Base
- **Productos con sugerencia**: Total de SKUs que requieren reabastecimiento
- **Inversión estimada**: Costo total de compra sugerida
- **Productos críticos**: Items agotados con demanda activa
- **Días promedio de stock**: Cobertura actual del inventario

### Sistema IA
- **Confianza promedio**: Score de confianza de las recomendaciones
- **ROI estimado**: Días para recuperar inversión
- **Insights de alto impacto**: Oportunidades detectadas
- **Alertas críticas**: Riesgos identificados

## ⚠️ Consideraciones

### Costos
- **DeepSeek**: ~$0.001 por análisis (muy económico)
- Cada análisis procesa ~2000-4000 tokens
- Uso recomendado: 1-2 veces por día o cuando sea necesario

### Rendimiento
- Análisis base (SQL): ~100-300ms
- Análisis IA (DeepSeek): ~10-30 segundos
- Caché recomendado para análisis recientes

### Privacidad
- Los datos se envían a DeepSeek para análisis
- No se almacenan datos sensibles del cliente
- Solo se envían métricas agregadas y nombres de productos

## 🔐 Seguridad

- API key almacenada en variables de entorno
- No incluir en repositorio (agregar `.env` a `.gitignore`)
- Validación de disponibilidad antes de llamadas
- Manejo de errores robusto
- Timeout de requests configurado

## 🚦 Estados del Sistema

- **Verde**: IA disponible y funcionando
- **Amarillo**: IA no disponible, usando sistema base
- **Rojo**: Error en análisis (ver consola)

## 📈 Mejoras Futuras

- [ ] Caché de análisis IA (TTL configurable)
- [ ] Historial de análisis y comparación
- [ ] Exportar reportes PDF con insights de IA
- [ ] Integración con proveedores (ordenes automáticas)
- [ ] Machine Learning local para reducir costos
- [ ] Dashboard de métricas de efectividad de sugerencias
- [ ] A/B testing: sugerencias sistema vs. IA
- [ ] Feedback loop: marcar sugerencias como útiles/no útiles

## 🆘 Troubleshooting

### "Servicio de IA no disponible"
- Verificar que `VITE_DEEPSEEK_API_KEY` esté en `.env`
- Reiniciar servidor de desarrollo (`npm run dev`)
- Verificar que la key sea válida en DeepSeek

### "Error al cargar análisis de IA"
- Revisar consola del navegador
- Verificar conectividad a internet
- Verificar límites de uso en DeepSeek
- Revisar formato de datos enviados

### Análisis muy lento (>1 minuto)
- Reducir cantidad de productos analizados
- Verificar velocidad de internet
- Considerar reducir `max_tokens` en configuración

### Sugerencias IA poco útiles
- Ajustar `businessContext` con más detalles
- Modificar prompt del sistema
- Reducir `temperature` para respuestas más conservadoras
- Proporcionar más datos históricos

## 📞 Soporte

Para problemas o mejoras:
1. Revisar logs en consola del navegador
2. Verificar configuración de variables de entorno
3. Consultar documentación de DeepSeek API
4. Revisar estructura de datos enviada/recibida

---

**Desarrollado con:** Vue 3 + Vuetify 3 + PostgreSQL + DeepSeek AI
