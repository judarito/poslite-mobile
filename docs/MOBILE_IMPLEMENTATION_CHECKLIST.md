# Mobile Implementation Checklist

Fecha de corte: 2026-03-07
Proyecto: POSLite Mobile (React Native + Expo)

## 1. Base tecnica

- [x] Autenticacion con Supabase (`supabase.auth.signInWithPassword`).
- [x] Carga de perfil, roles y permisos por usuario.
- [x] Menu dinamico + mapeo de rutas a pantallas mobile.
- [x] Capa offline local con SQLite (`pending_ops`, cache auth/menu/paginas).
- [x] Sincronizacion diferida de operaciones pendientes (`CREATE_SALE`).
- [x] Notificaciones in-app + suscripcion realtime.
- [x] Registro de push token y manejo de push en foreground/background.

## 2. Modulos funcionales en mobile

- [x] POS (venta rapida, pagos, descuentos, IA chat-a-venta).
- [x] Historial de ventas (filtros, reintentos offline, devoluciones/anulaciones).
- [x] Plan Separe.
- [x] Cartera.
- [x] Terceros (clientes/proveedores).
- [x] Productos.
- [x] Categorias.
- [x] Unidades de medida.
- [x] Importaciones masivas (incluye importacion por foto con IA/OCR).
- [x] Inventario (stock, movimientos, lotes/reportes relacionados).
- [x] Lotes y vencimientos.
- [x] Compras (consulta y seguimiento).
- [x] Ordenes de produccion (consulta/listado mobile).
- [x] BOMs (consulta/listado mobile).
- [x] Sesiones de caja.
- [x] Cajas registradoras.
- [x] Asignaciones de caja.
- [x] Metodos de pago.
- [x] Reportes (ventas/caja/inventario/financiero/produccion).
- [x] Configuracion general (`Setup`) y Empresa (`TenantConfig`).
- [x] Sedes (`Locations`).
- [x] Impuestos (`Taxes`).
- [x] Acerca de (`About`).

## 3. Modulos parcialmente portados

- [~] Compras: lectura/seguimiento en mobile; alta/edicion avanzada sigue en web.
- [~] Produccion y BOMs: enfoque principal actual en consulta/listado para operacion mobile.
- [~] Configuracion: parte cubierta en mobile, parte continua solo en web.

## 4. Pendientes visibles en UI (placeholders)

- [x] Reglas de impuesto (`TaxRules`) - CRUD mobile + filtros.
- [x] Reglas de precio (`PricingRules`) - CRUD mobile + filtros.
- [x] Usuarios (`Users`) - listado, alta/edicion, activacion y cambio de contrasena.
- [x] Roles y menus (`RolesMenus`) - roles, permisos y asignacion de menus en mobile.

## 5. Pendientes transversales y brechas detectadas

- [ ] Login UI y tema claro/oscuro:
  - La ultima modificacion del UI de login no contempla completamente el cambio de tema claro/oscuro.
  - Falta exponer cambio de tema desde login (antes de entrar a Home) para evitar quedar fijo en oscuro al iniciar sesion.
  - Falta revisar estilos secundarios del bloque login en modo claro para consistencia visual completa.

- [ ] Documentacion vs mobile:
  - Parte de `docs/*.md` describe implementaciones web (Vue) o fases SQL historicas; validar siempre contra `src/screens/*` y `src/services/*` para estado real mobile.

## 6. Prioridad sugerida (siguiente sprint)

- [ ] P0: Estandar de calidad de codigo
  - Configurar linter y formatter (ESLint + Prettier) con scripts en `package.json`.
  - Definir reglas base: imports ordenados, no variables sin uso, no `any` innecesario, complejidad controlada.
  - Agregar convencion de estructura por modulo (`screen`, `service`, `hooks`, `components`, `types`).

- [~] P0: Reducir deuda tecnica principal
  - Dividir `App.js` por responsabilidades (auth shell, app shell, home/dashboard, login view).
  - Extraer utilidades compartidas (formatters, theme helpers, validation helpers).
  - Eliminar duplicacion de logica de carga/caching en pantallas listadas.

- [x] P1: Corregir tema en login (alineado a cache/tenant settings, sin control duplicado).
- [x] P1: POS competitivo y FE minimo operativo (fase 1 + quick wins clave):
  - `third_party_id` enviado en `createSale` (online/offline) para FE.
  - FE usa `customer_id` (tabla terceros) como receptor fiscal, sin input duplicado.
  - Captura de referencia por pago (`reference`) en POS.
  - Historial de ventas con campos FE (`invoice_type`, `dian_status`, `cufe`) y accion de `Reintentar FE`.
  - Modo "venta en espera" (hold/resume ticket) con cache local por tenant/usuario.
  - Favoritos de productos en POS y agregado rapido.
  - Entrada rapida por codigo (barcode/SKU) para agregar al carrito.
  - Atajos de efectivo (`Exacto`, `+5k`, `+10k`, `+20k`, `+50k`).
- [x] P1: Portar `TaxRules` y `PricingRules` (minimo CRUD basico).
- [x] P2: Portar `Users` en modo administracion basica.
- [x] P3: Definir alcance mobile de `RolesMenus` (consulta o gestion limitada).

## 8. Avances aplicados hoy

- [x] Login movido a componente dedicado: `src/screens/LoginScreen.js`.
- [x] Login alineado a la regla de tema existente:
  - Sin switch adicional en login.
  - Se prioriza tema desde cache local de usuario.
  - Si no existe cache de tema, se usa `tenant_settings.theme` cacheado.
- [x] Utilidades de tema extraidas: `src/lib/themePreferences.js`.
- [x] Configuracion de pantallas mobile extraida: `src/navigation/mobileScreenConfig.js`.
- [x] `App.js` simplificado: menos responsabilidad de UI y menos listas hardcodeadas.
- [x] `TaxRules` migrado: `src/screens/TaxRulesScreen.js` + `src/services/taxRules.service.js`.
- [x] `PricingRules` migrado: `src/screens/PricingRulesScreen.js` + `src/services/pricingRules.service.js`.
- [x] `Users` migrado: `src/screens/UsersScreen.js` + `src/services/users.service.js`.
- [x] `RolesMenus` migrado: `src/screens/RolesMenusScreen.js` + `src/services/rolesMenus.service.js`.

## 7. Criterios de codigo limpio (DoD tecnico)

- [ ] Toda pantalla nueva o modificada debe:
  - Tener estado y efectos acotados (evitar componentes monoliticos).
  - Reutilizar componentes comunes para inputs/listas/modales.
  - Manejar errores de red y modo offline de forma consistente.

- [ ] Todo servicio nuevo o modificado debe:
  - Retornar contrato uniforme `{ success, data, error }`.
  - Evitar logica de UI dentro del servicio.
  - Tener funciones pequenas y nombres explicitos.

- [ ] Validacion minima antes de merge:
  - Lint sin errores.
  - Formato consistente.
  - Smoke test manual del flujo tocado (online/offline cuando aplique).
