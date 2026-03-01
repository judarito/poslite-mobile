# Cómo Usar el Servicio de Creación de Tenants

## 📝 Ejemplos Prácticos

### 1. Ejemplo Básico (Más Simple)

```javascript
import tenantsService from '@/services/tenants.service'
import { useTenant } from '@/composables/useTenant'

// En tu componente Vue
const { tenantId } = useTenant()

// Crear tenant nuevo
const crearTenant = async () => {
  const resultado = await tenantsService.createTenant(
    // 👇 Datos del tenant
    {
      name: 'Mi Nueva Tienda',
      tax_id: '900123456-7',
      email: 'contacto@mitienda.com',
      phone: '3001234567',
      address: 'Calle 123 #45-67',
      invoice_prefix: 'VTA'
    },
    // 👇 Datos del admin
    {
      email: 'admin@mitienda.com',
      full_name: 'Juan Pérez',
      password: 'MiPassword123!'
    },
    // 👇 Copiar del tenant actual
    tenantId.value
  )

  if (resultado.success) {
    console.log('✅ Tenant creado:', resultado.data)
    console.log('ID del tenant:', resultado.data.tenant_id)
    console.log('ID del usuario:', resultado.data.user_id)
  } else {
    console.error('❌ Error:', resultado.error)
  }
}
```

### 2. Ejemplo con Validación (Recomendado)

```javascript
import tenantsService from '@/services/tenants.service'

const crearTenantConValidacion = async (formData) => {
  try {
    // 1. Validar campos requeridos
    if (!formData.tenant_name || !formData.admin_email) {
      alert('Faltan campos requeridos')
      return
    }

    // 2. Mostrar loader
    const loading = ref(true)

    // 3. Llamar servicio
    const result = await tenantsService.createTenant(
      {
        name: formData.tenant_name,
        tax_id: formData.tax_id,
        email: formData.tenant_email,
        phone: formData.phone,
        address: formData.address,
        invoice_prefix: formData.invoice_prefix || 'FAC'
      },
      {
        email: formData.admin_email,
        full_name: formData.admin_name,
        password: formData.admin_password
      },
      formData.copy_from_current ? currentTenantId : null
    )

    // 4. Manejar resultado
    loading.value = false

    if (result.success) {
      alert(`✅ Tenant creado: ${result.data.tenant_id}`)
      // Opcional: redirigir, recargar lista, etc.
    } else {
      alert(`❌ Error: ${result.error}`)
    }

  } catch (error) {
    console.error('Error inesperado:', error)
    alert('Error inesperado creando tenant')
  }
}
```

### 3. Ejemplo Completo en Componente Vue

```vue
<template>
  <div>
    <v-btn @click="crearNuevoTenant" :loading="creando">
      Crear Tenant
    </v-btn>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useTenant } from '@/composables/useTenant'
import tenantsService from '@/services/tenants.service'

const { tenantId } = useTenant()
const creando = ref(false)

const crearNuevoTenant = async () => {
  creando.value = true
  
  const result = await tenantsService.createTenant(
    {
      name: 'Nueva Empresa',
      tax_id: '900999888-7',
      email: 'info@empresa.com',
      invoice_prefix: 'FAC'
    },
    {
      email: 'admin@empresa.com',
      full_name: 'Admin Principal',
      password: 'Password123!'
    },
    tenantId.value // Copiar del actual
  )
  
  creando.value = false
  
  if (result.success) {
    console.log('✅ Creado:', result.data)
  } else {
    console.error('❌ Error:', result.error)
  }
}
</script>
```

### 4. Sin Copiar Configuraciones (Usar Defaults)

```javascript
// Pasar null como tercer parámetro
const result = await tenantsService.createTenant(
  tenantData,
  adminData,
  null  // 👈 null = usa configuraciones por defecto
)
```

### 5. Ver Template de Configuración

```javascript
import tenantsService from '@/services/tenants.service'

// Obtener JSON con todas las configs del tenant actual
const verTemplate = async () => {
  const result = await tenantsService.getTenantTemplate(tenantId.value)
  
  if (result.success) {
    console.log('Template:', result.data)
    // Contiene: tenant_settings, payment_methods, roles, 
    // pricing_rules, tax_rules
  }
}
```

### 6. Listar Todos los Tenants

```javascript
const verTodosLosTenants = async () => {
  const result = await tenantsService.getAllTenants()
  
  if (result.success) {
    console.log('Tenants:', result.data)
    result.data.forEach(tenant => {
      console.log(`- ${tenant.name} (${tenant.tenant_id})`)
    })
  }
}
```

### 7. Con Usuario Auth Existente

```javascript
// Si ya creaste el usuario en Supabase Auth
const authUserId = 'uuid-del-usuario-en-auth'

const result = await tenantsService.createTenant(
  tenantData,
  {
    user_id: authUserId,  // 👈 Usar ID existente
    email: 'admin@empresa.com',
    full_name: 'Admin'
    // No enviar password si ya existe
  },
  sourceTenantId
)
```

## 🎯 Vista Completa Ya Creada

Ya creé una vista completa en:
- **Archivo**: `src/views/TenantManagement.vue`
- **Ruta**: `/tenant-management`
- **Menú**: Configuración → Gestión de Tenants

Esta vista incluye:
- ✅ Formulario completo con validaciones
- ✅ Opción de copiar configuraciones
- ✅ Lista de tenants existentes
- ✅ Ver templates de configuración
- ✅ Feedback visual (loading, errores, éxito)

## 📊 Estructura de Respuesta

```javascript
// Si todo salió bien:
{
  success: true,
  data: {
    tenant_id: "uuid-del-tenant",
    user_id: "uuid-del-usuario",
    location_id: "uuid-de-sede-principal",
    register_id: "uuid-de-caja-principal",
    auth_user_id: "uuid-del-usuario-en-auth",
    message: "Tenant creado exitosamente con estructura completa"
  }
}

// Si hubo error:
{
  success: false,
  error: "Mensaje de error"
}
```

## 🔐 Notas Importantes

1. **Usuario Auth**: El servicio crea automáticamente el usuario en Supabase Auth si proporcionas `password`
2. **Atomicidad**: Si algo falla, se hace rollback completo (todo o nada)
3. **Permisos**: Requiere permisos de `SETTINGS.TENANT.MANAGE`
4. **Campos Requeridos**:
   - Tenant: `name`
   - Admin: `email`, `full_name`

## 🚀 Acceso Rápido

Para probar rápidamente:

1. Ir a: `/tenant-management`
2. Llenar formulario
3. Click en "Crear Tenant"

¡Listo! 🎉
