# Mobile Web Module Migration (2026-03-10)

Proyecto: POSLite Mobile  
Fecha: 2026-03-10  
Alcance: documentar estado actual y plan de migracion de modulos web -> mobile.

## 1) Resumen ejecutivo

- Se centralizo el sistema de colores en tokens de tema.
- Se migro `src/components/*` para eliminar colores hardcode.
- Se habilitaron aliases de modulos web que estaban incompletos en mobile:
  - `Customers` -> `ThirdPartiesScreen` con filtro forzado `customer`.
  - `Suppliers` -> `ThirdPartiesScreen` con filtro forzado `supplier`.
  - `TenantManagement` -> `TenantConfigScreen`.

## 2) Cambios tecnicos aplicados

### 2.1 Tokens de tema

Archivo base:
- `src/theme/colors.js`

Bloques principales:
- `APP_THEME_COLORS`: shell global (header, status bar, avatar, chips, etc).
- `COMPONENT_THEME_COLORS`: componentes reutilizables.
- `SCREEN_ACCENT_COLORS`: acentos por modulo.
- `HOME_BAR_THEME_COLORS`: colores de barra/modulos en Home.

### 2.2 Componentes migrados a tokens

Sin colores hardcode en `src/components`:
- `src/components/DatePickerField.js`
- `src/components/MultiSelectField.js`
- `src/components/PaginatedList.js`
- `src/components/SearchableSelectField.js`

### 2.3 Modulos web incompletos habilitados en mobile

Archivos:
- `src/navigation/menuMapper.js`
- `src/navigation/mobileScreenConfig.js`
- `App.js`
- `src/screens/ThirdPartiesScreen.js`

Rutas nuevas/normalizadas:
- `/clientes` -> `Customers`
- `/suppliers` -> `Suppliers`
- `/proveedores` -> `Suppliers`
- `/tenant_management` -> `TenantManagement`

## 3) Matriz de estado web -> mobile

### 3.1 Completos o funcionales en mobile

- POS, Ventas, Plan Separe, Terceros, Productos, Inventario, Lotes, Caja, Reportes, Setup, Empresa, Impuestos, Usuarios, RolesMenus.
- Aliases ahora operativos:
  - Clientes (`Customers`)
  - Proveedores (`Suppliers`)
  - Gestion Empresa (`TenantManagement`)

### 3.2 Parciales (scope mobile actual)

- Compras: consulta/seguimiento (sin flujo completo de alta/edicion avanzada).
- Produccion: consulta/seguimiento (sin flujo operativo completo de ejecucion).
- BOMs: consulta/listado (sin editor operativo completo).

## 4) Plan de migracion siguiente (propuesto)

1. Compras (P0):
- Crear flujo mobile de registro simple de compra.
- Mantener edicion avanzada en web hasta completar paridad.

2. Produccion (P1):
- Agregar detalle de orden y acciones de cambio de estado permitidas en mobile.
- Registrar avance de produccion desde mobile (si backend habilita endpoint dedicado).

3. BOMs (P1):
- Agregar vista de detalle de componentes.
- Definir alcance de creacion/edicion minima en mobile.

## 5) Regla de implementacion para nuevos modulos

Para cada modulo web nuevo que se migre a mobile:

1. Mapear ruta en `src/navigation/menuMapper.js`.
2. Registrar titulo y soporte en `src/navigation/mobileScreenConfig.js`.
3. Agregar rama de render en `App.js`.
4. Reutilizar componentes base (`PaginatedList`, `SearchableSelectField`, etc).
5. Usar tokens en `src/theme/colors.js` (sin hardcode).
6. Definir alcance: completo vs parcial, y documentarlo.

## 6) Riesgos y notas

- Algunos modulos parciales dependen de endpoints transaccionales no expuestos aun en `src/services`.
- Para evitar regressiones visuales, toda UI nueva debe usar tokens de tema y componentes compartidos.
