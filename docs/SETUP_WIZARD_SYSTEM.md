# Sistema de Asistente de Configuración Inicial

## 📋 Descripción

Sistema completo para guiar a nuevos tenants en la configuración inicial de su negocio, con creación automática de datos predeterminados (unidades, impuestos, métodos de pago, roles).

## ✨ Características Implementadas

### 1. **Asistente de Configuración (Setup Wizard)**

Componente interactivo que muestra el progreso de configuración y guía al usuario.

**Ubicación:** `src/components/SetupWizard.vue`

**Pasos Verificados:**
- ✅ Configuraciones Generales (moneda, prefijo facturas)
- ✅ Ubicaciones (mínimo 1 activa)
- ✅ Cajas Registradoras (mínimo 1 activa)
- ✅ Categorías de Productos (mínimo 1)
- ✅ Unidades de Medida (creadas automáticamente)
- ✅ Impuestos (creados automáticamente)
- ✅ Métodos de Pago (creados automáticamente)
- ✅ Productos (mínimo 1)
- ⭕ Usuarios Adicionales (opcional)

**Funcionalidades:**
- Barra de progreso visual (0-100%)
- Estado de cada paso (completado/pendiente)
- Indicadores de pasos requeridos vs opcionales
- Botón de navegación directa a cada módulo
- Actualización en tiempo real del progreso
- Botón "Ir al POS" cuando todo está completado

### 2. **Creación de Tenant con Defaults**

La función `fn_create_tenant` se actualizó para crear automáticamente todos los datos base necesarios.

**Archivo:** `migrations/UPDATE_CREATE_TENANT_DEFAULTS.sql`

**Cambios Principales:**
- ❌ **Eliminado:** Parámetro `p_copy_from_tenant_id` (ya no copia de otros tenants)
- ✅ **Agregado:** Creación automática de 12 unidades de medida
- ✅ **Agregado:** Creación automática de 3 impuestos (IVA 19%, 5%, 0%)
- ✅ **Agregado:** Creación automática de 5 métodos de pago
- ✅ **Mejorado:** 4 roles predefinidos con permisos completos

**Datos Creados Automáticamente:**

#### Unidades de Medida (12):
- Unidad, Kilogramo, Gramo, Libra
- Metro, Centímetro
- Litro, Mililitro
- Caja, Paquete, Docena, Par

#### Impuestos (3):
- IVA 19% (por defecto)
- IVA 5%
- IVA 0% (Exento)

#### Métodos de Pago (5):
- Efectivo
- Tarjeta Débito
- Tarjeta Crédito
- Transferencia Bancaria
- QR / Nequi / Daviplata

#### Roles con Permisos (4):
1. **ADMINISTRATOR:** Acceso completo a todo
2. **MANAGER:** Gerente (productos, inventario, ventas, compras, reportes)
3. **CASHIER:** Cajero (solo ventas, clientes, layaway)
4. **WAREHOUSE:** Bodeguero (inventario, compras, productos)

### 3. **Simplificación de TenantManagement.vue**

**Cambios:**
- ❌ Eliminado switch "Copiar configuraciones de tenant existente"
- ❌ Eliminado selector de tenant plantilla
- ✅ Agregada alerta informativa sobre configuración automática
- ✅ Mención al Asistente de Configuración post-creación

### 4. **Actualización del Service**

**Archivo:** `src/services/tenants.service.js`

**Cambios:**
- Firma función: `createTenant(tenantData, adminData)` (eliminado 3er parámetro)
- Llamada RPC actualizada: solo `p_tenant_data` y `p_admin_data`

### 5. **Integración en Router y Menú**

**Router:**
- Nueva ruta: `/setup` → `SetupWizard.vue`
- Meta: `requiresAuth: true` (no requiere permisos específicos)

**Menú App.vue:**
- Agregado item "Asistente de Configuración" en sección "Configuración"
- Icono: `mdi-rocket-launch`
- Sin restricciones de permisos (visible para todos)

## 🚀 Flujo de Uso

### Super Admin Crea Nuevo Tenant:

1. **Super Admin** accede a `/tenant-management`
2. Completa formulario con datos del negocio y administrador
3. Hace clic en "Crear Tenant"
4. Sistema crea automáticamente:
   - Tenant con configuraciones base
   - 1 Ubicación "PRINCIPAL"
   - 1 Caja "CAJA PRINCIPAL"
   - 12 Unidades de medida
   - 3 Impuestos
   - 5 Métodos de pago
   - 4 Roles con permisos
   - 1 Usuario administrador

### Nuevo Usuario Administrador Inicia Sesión:

1. Hace login con sus credenciales
2. Es redirigido al **Home** (dashboard)
3. Ve en el menú "Configuración" → "Asistente de Configuración"
4. Al acceder, ve checklist con progreso:
   ```
   ✅ Unidades de Medida (creadas automáticamente)
   ✅ Impuestos (creados automáticamente)
   ✅ Métodos de Pago (creados automáticamente)
   ⏳ Configuraciones Generales (revisar moneda, prefijos)
   ⏳ Categorías de Productos (crear al menos 1)
   ⏳ Productos (crear al menos 1)
   ```
5. Hace clic en cada paso pendiente y completa la configuración
6. Al alcanzar 100%, botón "Ir al Punto de Venta" se habilita
7. ¡Listo para vender! 🎉

## 📊 Verificación del Progreso

El wizard verifica dinámicamente:

```javascript
// Ejemplo: Verificar si hay ubicaciones configuradas
const { count } = await supabase
  .from('locations')
  .select('*', { count: 'exact', head: true })
  .eq('tenant_id', authStore.currentTenantId)
  .eq('is_active', true)

return count > 0 // ✅ Completado si hay al menos 1
```

Cada paso tiene su propia query de verificación independiente.

## 🎨 Interfaz del Wizard

### Estados Visuales:

**Completado:**
- Avatar verde con ✓
- Fondo verde claro
- Chip "Completado"

**Pendiente Requerido:**
- Avatar naranja con icono
- Chip rojo "Requerido"
- Botón "Configurar"

**Pendiente Opcional:**
- Avatar gris con icono
- Chip gris "Opcional"
- Botón "Ver"

### Barra de Progreso:

- 0-49%: Naranja (warning)
- 50-99%: Azul (primary)
- 100%: Verde (success)

## 📝 Notas Técnicas

### Stored Procedure:

```sql
-- Firma actualizada
CREATE OR REPLACE FUNCTION fn_create_tenant(
  p_tenant_data JSONB,
  p_admin_data JSONB
)
RETURNS JSONB
```

### Llamada desde Frontend:

```javascript
const result = await tenantsService.createTenant(
  {
    name: 'Mi Empresa',
    tax_id: '900123456-7',
    email: 'contacto@miempresa.com',
    invoice_prefix: 'FAC'
  },
  {
    full_name: 'Juan Pérez',
    email: 'admin@miempresa.com',
    password: 'SecurePassword123'
  }
)
```

### Response:

```json
{
  "success": true,
  "tenant_id": "uuid...",
  "user_id": "uuid...",
  "location_id": "uuid...",
  "register_id": "uuid...",
  "message": "Tenant creado exitosamente con configuración por defecto completa"
}
```

## 🔧 Instalación

1. **Ejecutar migración SQL:**
   ```powershell
   psql -U postgres -d pos_lite -f "migrations/UPDATE_CREATE_TENANT_DEFAULTS.sql"
   ```

2. **Reiniciar servidor dev:**
   ```powershell
   npm run dev
   ```

3. **Acceder al wizard:**
   - Login → Menú → Configuración → Asistente de Configuración
   - URL directa: `http://localhost:5173/setup`

## ✅ Checklist de Testing

- [ ] Ejecutar migración SQL sin errores
- [ ] Crear nuevo tenant desde TenantManagement
- [ ] Verificar que se crean 12 unidades automáticamente
- [ ] Verificar que se crean 3 impuestos automáticamente
- [ ] Verificar que se crean 5 métodos de pago automáticamente
- [ ] Verificar que se crean 4 roles automáticamente
- [ ] Login como nuevo admin del tenant
- [ ] Acceder a "Asistente de Configuración"
- [ ] Verificar progreso inicial (~33% por defaults)
- [ ] Crear 1 categoría → Progreso aumenta
- [ ] Crear 1 producto → Progreso aumenta
- [ ] Alcanzar 100% → Botón "Ir al POS" visible
- [ ] Hacer venta de prueba completa

## 🎯 Beneficios

1. **Onboarding más rápido:** Usuario nuevo sabe exactamente qué configurar
2. **Menos errores:** Datos predeterminados correctos desde el inicio
3. **UX mejorada:** Guía visual clara con progreso
4. **Escalable:** Fácil agregar nuevos pasos al wizard
5. **Mantenible:** Cada paso es independiente y verificable

## 🔮 Mejoras Futuras (Sugerencias)

- [ ] Guardar progreso en `localStorage` o tabla DB
- [ ] Agregar tooltips explicativos en cada paso
- [ ] Video tutorial embedded por paso
- [ ] Wizard multi-paso con navegación siguiente/anterior
- [ ] Confeti al alcanzar 100% 🎉
- [ ] Email automático al completar configuración
- [ ] Dashboard widget con progreso (en Home)
- [ ] Recordatorio si configuración incompleta después de 7 días

---

**Implementado por:** AI Agent  
**Fecha:** 2026-02-20  
**Versión:** 1.0
