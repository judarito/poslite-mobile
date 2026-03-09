# POS Mobile - Analisis de Competitividad y Usabilidad (2026)

Fecha: 2026-03-07  
Alcance: Modulo `PointOfSale` mobile + capacidades de facturacion electronica para Colombia

## 1) Resumen ejecutivo

El POS actual es funcional para venta rapida con buen baseline (offline queue, calculo de impuestos, pagos mixtos, IA para OCR/chat).  
Para ser mas competitivo y mantener facilidad de uso, faltan dos bloques grandes:

1. **Experiencia de caja** (velocidad operativa, menos toques, errores evitables).
2. **Flujo FE Colombia end-to-end** (no solo bandera de configuracion, sino emision/seguimiento/reintento).

## 2) Lo que ya esta bien (fortalezas)

- Venta online/offline con encolado y sincronizacion diferida.
- Idempotencia de venta por `operation_id`.
- Soporte impuestos con `price_includes_tax`.
- Multiples metodos de pago y calculo de cambio.
- IA opcional para cargar carrito desde foto de factura o texto de chat.
- Validacion de caja abierta para vender.

## 3) Hallazgos clave en codigo (gaps)

## 3.1 Gaps de experiencia (competitividad)

- No hay escaneo de codigo de barras 1D/2D para agregar items en caja.
- No hay modo "venta en espera" (hold/resume ticket) para filas con interrupciones.
- No hay favoritos/teclas rapidas de productos de alta rotacion.
- No hay descuentos globales en UI POS mobile (solo por linea para admin).
- No hay captura de referencia por pago en POS (voucher/transferencia).
- No hay atajos de montos de efectivo (ej: +5k, +10k, +20k) para cierre rapido.
- No hay impresion/envio de comprobante desde POS mobile tras cobrar.

## 3.2 Gaps FE Colombia (criticos)

- En creacion de venta, `p_third_party` se envia siempre `null` en RPC:
  - `src/services/pos.service.js` (llamadas `sp_create_sale_idempotent` y `sp_create_sale`).
- En payload de POS no existe seleccion de receptor fiscal FE:
  - `src/screens/PointOfSaleScreen.js` usa `customer_id`, pero no `third_party_id`.
- El POS no muestra tipo de documento fiscal a emitir (`FV/FE/...`), ni estado de emision FE.
- `SalesHistory` y `sales.service` no consultan campos FE (`dian_status`, `cufe`, `third_party_id`, etc.).
- No existe accion de reintento FE en mobile.
- `TenantConfig` tiene `electronic_invoicing_enabled` y datos fiscales del emisor, pero falta UI para:
  - Proveedor tecnologico (`fe_provider_config`)
  - Resoluciones (`invoice_resolutions`)
  - Monitoreo de consecutivo/rango/agotamiento

## 4) Evidencia tecnica (archivos)

- POS payload y procesamiento venta:
  - `src/screens/PointOfSaleScreen.js`
  - Bloque `handleProcessSale` (lineas, pagos, enqueue offline, createSale)
- RPC venta con `p_third_party: null`:
  - `src/services/pos.service.js`
- Ventas sin campos FE en list/detail:
  - `src/services/sales.service.js`
- Configuracion FE parcial (bandera + datos emisor):
  - `src/screens/TenantConfigScreen.js`
- Backend preparado para FE (migraciones):
  - `migrations/ADD_ELECTRONIC_INVOICING.sql`
  - `migrations/ADD_FE_COMPLEMENTARY.sql`
  - `migrations/UPDATE_SP_CREATE_SALE_FE.sql`

## 5) Contexto normativo Colombia (para priorizacion)

Referencias oficiales DIAN indican, entre otros puntos:

- Resolucion 000165 de 2023: adopta anexo tecnico 1.9 de FEV y anexo 1.0 de documento equivalente electronico.
- Cronograma de implementacion (ampliado con Resolucion 008 de 2024) para documento equivalente electronico POS.
- Desde **1 de julio de 2024** no es valido el tiquete POS en papel como documento equivalente.

Fuentes (oficiales):

- DIAN - Normatividad del sistema de facturacion:  
  https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/normatividad/
- DIAN - Documentacion tecnica FE:  
  https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documentacion-tecnica/
- DIAN - Comunicado 013 de 2024 (cronograma POS electronico):  
  https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-013-2024.aspx
- DIAN - Concepto 6259 de 2024 (normograma):  
  https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_6259_2024.htm

## 6) Plan recomendado (competitivo + facil de usar)

## Fase 1 (P0, 2-3 semanas) - FE minima operativa en mobile

- Agregar selector simple "Receptor fiscal FE (opcional)" en POS.
- Enviar `third_party_id` real en `createSale` (online y offline payload).
- Mostrar en historial de ventas: `dian_status`, `invoice_type`, `cufe` (si aplica).
- Boton "Reintentar FE" en detalle de venta cuando estado sea `PENDING/REJECTED/ERROR`.
- Capturar `reference` por metodo de pago (opcional) y enviarla en payload.

Resultado: cumplimiento operativo visible sin complejizar la caja.

## Fase 2 (P1, 2-4 semanas) - UX de caja competitiva

- Escaneo de barras en POS (camara/lector).
- Hold/Resume de ticket.
- Atajos de efectivo y pago rapido.
- Grid de favoritos/productos top por sede.
- Descuento global simplificado (monto o %) con UX guiada.

Resultado: menos tiempo por transaccion y mejor experiencia de cajero.

## Fase 3 (P1/P2) - FE avanzada y gobierno

- Pantalla mobile de proveedor tecnologico y resoluciones (lectura + validaciones).
- Alertas de agotamiento de rango de resolucion.
- Auditoria FE por venta (timeline de envios y respuestas PT/DIAN).
- Export y conciliacion diaria FE vs ventas.

## 7) Criterios de exito (KPIs)

- Tiempo promedio de venta (objetivo: -20%).
- Toques promedio para cobrar venta simple (objetivo: <= 8).
- % ventas con error de pago/referencia (objetivo: < 1%).
- % ventas FE enviadas exitosamente en primer intento (objetivo: > 98%).
- Tiempo de recuperacion de FE rechazada (objetivo: < 15 min en caja).

## 8) Riesgos a controlar

- Mezclar FE y UX sin separar fases puede degradar simplicidad de caja.
- Sin validaciones de datos fiscales (tercero/emisor), aumentan rechazos FE.
- Cambios normativos DIAN: revisar periodicamente micrositio y anexos tecnicos vigentes.

## 9) Estado de implementacion mobile (2026-03-07)

- Implementado en app mobile:
  - `third_party_id` en creacion de venta (`createSale`) para RPC FE.
  - Receptor FE simplificado: se toma del cliente seleccionado (sin selector fiscal separado).
  - Referencia por metodo de pago en POS.
  - Historial y detalle de ventas con `invoice_type`, `dian_status`, `cufe`.
  - Accion `Reintentar FE` con fallback seguro cuando no exista RPC dedicado.
  - Ticket en espera (`hold/resume`) persistido en cache local.
  - Favoritos de productos de alta rotacion.
  - Entrada rapida por codigo (barcode/SKU) y atajos de efectivo.
