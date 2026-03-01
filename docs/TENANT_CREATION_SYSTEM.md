# Sistema de Creación de Tenants

## 📋 Descripción

Sistema completo para crear nuevos tenants de forma automatizada, copiando configuraciones de un tenant existente o usando configuraciones por defecto.

## 🗄️ Base de Datos

### Stored Procedure: `fn_create_tenant`

Ubicación: `migrations/CreateTenantSP.sql`

**Parámetros:**
- `p_tenant_data` (jsonb): Datos del nuevo tenant
- `p_admin_data` (jsonb): Datos del usuario administrador
- `p_source_tenant_id` (uuid, opcional): Tenant origen para copiar configuraciones

**Retorna:** JSON con resultado de la operación

### Función Auxiliar: `fn_get_tenant_template_json`

Genera un JSON con todas las configuraciones de un tenant existente para usarlo como template.

## 🎯 Lo que se Crea Automáticamente

Al ejecutar `fn_create_tenant`, se crean:

1. **✅ Tenant nuevo** con datos proporcionados
2. **⚙️ Configuraciones** (`tenant_settings`)
   - Copiadas del tenant origen, o
   - Valores por defecto si no hay origen
3. **🏢 Sede "PRINCIPAL"** con código `PRIN-001`
4. **💰 Caja "CAJA PRINCIPAL"** con código `REG-001`
5. **💳 Métodos de Pago** copiados del origen o los 4 básicos:
   - Efectivo
   - Tarjeta Débito
   - Tarjeta Crédito
   - Transferencia
6. **👥 Roles y Permisos** completos:
   - Si hay origen: copia todos los roles
   - Si no: crea rol ADMINISTRATOR con 16 permisos
7. **💵 Reglas de Precios** (si existen en el origen)
8. **📊 Reglas de Impuestos**
   - Copiadas del origen, o
   - IVA 19% por defecto (Colombia)
9. **👤 Usuario Administrador** con rol asignado

## 🚀 Uso desde SQL

### Opción 1: Con Tenant Origen (Recomendado)

```sql
-- Crear tenant copiando configuraciones de uno existente
select fn_create_tenant(
  '{
    "name": "Mi Nueva Empresa",
    "legal_name": "Mi Nueva Empresa S.A.S.",
    "tax_id": "900123456-7",
    "email": "contacto@nuevaempresa.com",
    "phone": "3001234567",
    "address": "Calle 123 #45-67, Bogotá",
    "invoice_prefix": "FAC",
    "invoice_start_number": 1
  }'::jsonb,
  '{
    "user_id": "uuid-del-usuario-auth",
    "email": "admin@nuevaempresa.com",
    "full_name": "Administrador Principal"
  }'::jsonb,
  'uuid-del-tenant-origen'::uuid
);
```

### Opción 2: Sin Origen (Configuración por Defecto)

```sql
-- Crear tenant con configuraciones por defecto
select fn_create_tenant(
  '{
    "name": "Empresa Nueva",
    "tax_id": "900111222-3",
    "email": "info@empresa.com",
    "phone": "3009876543",
    "address": "Av. Principal 456",
    "invoice_prefix": "INV"
  }'::jsonb,
  '{
    "user_id": "uuid-del-usuario-auth",
    "email": "admin@empresa.com",
    "full_name": "Juan Pérez"
  }'::jsonb,
  null
);
```

### Opción 3: Obtener Template de Configuración

```sql
-- Ver todas las configuraciones de un tenant para usarlas como referencia
select fn_get_tenant_template_json('uuid-del-tenant-actual'::uuid);
```

## 💻 Uso desde JavaScript

### Servicio Creado

Ubicación: `src/services/tenants.service.js`

### Ejemplo de Uso

```javascript
import tenantsService from '@/services/tenants.service'

// 1. Obtener template de configuración actual (opcional)
const template = await tenantsService.getTenantTemplate(currentTenantId)
console.log('Template:', template.data)

// 2. Crear nuevo tenant
const result = await tenantsService.createTenant(
  // Datos del tenant
  {
    name: 'Mi Nueva Empresa',
    legal_name: 'Mi Nueva Empresa S.A.S.',
    tax_id: '900123456-7',
    email: 'contacto@nuevaempresa.com',
    phone: '3001234567',
    address: 'Calle 123 #45-67, Bogotá',
    invoice_prefix: 'FAC',
    invoice_start_number: 1
  },
  // Datos del administrador
  {
    email: 'admin@nuevaempresa.com',
    full_name: 'Administrador Principal',
    password: 'Password123!' // Opcional: si no se proporciona, usar user_id
  },
  // Tenant origen (opcional)
  currentTenantId // O null para usar configuraciones por defecto
)

if (result.success) {
  console.log('Tenant creado:', result.data.tenant_id)
  console.log('Usuario creado:', result.data.user_id)
  console.log('Auth user:', result.data.auth_user_id)
} else {
  console.error('Error:', result.error)
}
```

## 📊 Estructura del JSON de Resultado

```json
{
  "success": true,
  "tenant_id": "uuid-del-tenant-nuevo",
  "user_id": "uuid-del-usuario-en-users",
  "location_id": "uuid-de-sede-principal",
  "register_id": "uuid-de-caja-principal",
  "message": "Tenant creado exitosamente con estructura completa"
}
```

## 🎨 Crear Vista de Administración (Sugerencia)

Puedes crear una vista `TenantManagement.vue` con este formulario:

```vue
<template>
  <v-card>
    <v-card-title>Crear Nuevo Tenant</v-card-title>
    <v-card-text>
      <v-form ref="form">
        <!-- Datos del Tenant -->
        <v-text-field v-model="tenantData.name" label="Nombre Comercial *" />
        <v-text-field v-model="tenantData.legal_name" label="Razón Social" />
        <v-text-field v-model="tenantData.tax_id" label="NIT/RUT *" />
        <v-text-field v-model="tenantData.email" label="Email *" />
        <v-text-field v-model="tenantData.phone" label="Teléfono" />
        <v-textarea v-model="tenantData.address" label="Dirección" rows="2" />
        <v-text-field v-model="tenantData.invoice_prefix" label="Prefijo Facturas" />
        
        <v-divider class="my-4"></v-divider>
        
        <!-- Datos del Administrador -->
        <v-text-field v-model="adminData.full_name" label="Nombre Administrador *" />
        <v-text-field v-model="adminData.email" label="Email Administrador *" />
        <v-text-field v-model="adminData.password" label="Contraseña *" type="password" />
        
        <v-divider class="my-4"></v-divider>
        
        <!-- Opciones -->
        <v-switch 
          v-model="copyFromCurrent" 
          label="Copiar configuraciones del tenant actual"
        ></v-switch>
      </v-form>
    </v-card-text>
    <v-card-actions>
      <v-spacer></v-spacer>
      <v-btn @click="close">Cancelar</v-btn>
      <v-btn color="primary" @click="createTenant" :loading="creating">Crear Tenant</v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { ref } from 'vue'
import { useTenant } from '@/composables/useTenant'
import tenantsService from '@/services/tenants.service'

const { tenantId } = useTenant()
const creating = ref(false)
const copyFromCurrent = ref(true)

const tenantData = ref({
  name: '',
  legal_name: '',
  tax_id: '',
  email: '',
  phone: '',
  address: '',
  invoice_prefix: 'FAC',
  invoice_start_number: 1
})

const adminData = ref({
  full_name: '',
  email: '',
  password: ''
})

const createTenant = async () => {
  creating.value = true
  try {
    const result = await tenantsService.createTenant(
      tenantData.value,
      adminData.value,
      copyFromCurrent.value ? tenantId.value : null
    )
    
    if (result.success) {
      alert('Tenant creado exitosamente')
      close()
    } else {
      alert('Error: ' + result.error)
    }
  } finally {
    creating.value = false
  }
}
</script>
```

## 🔒 Consideraciones de Seguridad

1. **Permisos RLS**: Asegúrate de que solo usuarios con permisos de super admin puedan ejecutar estos SP
2. **Autenticación**: El usuario admin debe crearse primero en Supabase Auth
3. **Validación**: El SP valida campos requeridos pero se recomienda validación adicional en frontend
4. **Transacciones**: Todo el proceso es atómico - si algo falla, se hace rollback completo

## 📝 Notas Importantes

### Creación del Usuario Auth

El servicio JavaScript **crea automáticamente** el usuario en Supabase Auth si se proporciona `password`. Si prefieres crearlo manualmente:

```javascript
// Crear usuario en Auth manualmente
const { data: authData } = await supabaseService.client.auth.signUp({
  email: 'admin@empresa.com',
  password: 'Password123!',
  options: { data: { full_name: 'Admin' } }
})

// Luego crear tenant con el user_id
await tenantsService.createTenant(
  tenantData,
  { 
    user_id: authData.user.id,
    email: 'admin@empresa.com',
    full_name: 'Admin'
  },
  sourceTenantId
)
```

### Configuraciones Copiadas

Cuando se usa un tenant origen, se copian:
- ✅ Todas las configuraciones de `tenant_settings`
- ✅ Todos los métodos de pago
- ✅ Todos los roles con sus permisos completos
- ✅ Todas las reglas de pricing
- ✅ Todas las reglas de impuestos
- ❌ NO se copian: productos, clientes, ventas, usuarios

### Configuraciones por Defecto (sin origen)

Si NO se proporciona tenant origen:
- 📄 Página size: 10
- 🎨 Tema: light
- 💵 Moneda: COP
- 🌐 Locale: es-CO
- 📋 Factura: FAC-1
- 💳 4 métodos de pago básicos
- 👤 1 rol: ADMINISTRATOR con 16 permisos
- 📊 1 impuesto: IVA 19%

## 🔧 Mantenimiento

### Agregar Nuevas Configuraciones

Si agregas campos a `tenant_settings`, actualiza el SP en sección 2:

```sql
-- Agregar nuevo campo en la copia
insert into tenant_settings (
  tenant_id,
  ...,
  nuevo_campo  -- Agregar aquí
)
select
  v_tenant_id,
  ...,
  ts.nuevo_campo  -- Y aquí
from tenant_settings ts
where ts.tenant_id = v_source_tenant_id;
```

### Agregar Nuevas Tablas a Copiar

Si quieres copiar otras tablas (ej: categorías), agregar sección similar:

```sql
-- COPIAR CATEGORÍAS
for v_category in
  select name, description
  from categories
  where tenant_id = v_source_tenant_id
loop
  insert into categories (tenant_id, name, description)
  values (v_tenant_id, v_category.name, v_category.description);
end loop;
```

## 📚 Archivos Relacionados

- `migrations/CreateTenantSP.sql` - Stored Procedures
- `src/services/tenants.service.js` - Servicio JavaScript
- Este documento - Documentación completa

## ✅ Checklist de Implementación

- [x] Crear archivo SQL con SPs
- [x] Crear servicio JavaScript
- [x] Documentar uso completo
- [ ] Ejecutar migración en Supabase
- [ ] Crear vista de administración (opcional)
- [ ] Configurar permisos RLS para SPs
- [ ] Probar creación de tenant de prueba
- [ ] Validar que todas las configuraciones se copian correctamente
