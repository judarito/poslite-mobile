# RD Inicial - POSLite Mobile (React Native)

## 1. Objetivo
Construir una app mobile nativa (Android/iOS) para operaciones de negocio de alta frecuencia, conectada a Supabase, con estrategia offline-first y capacidades de IA asistida sin inventar datos.

## 2. Alcance V1 (MVP)
- Autenticacion (Supabase Auth) + seleccion de tenant.
- Dashboard compacto de alertas.
- POS rapido (venta basica).
- Cartera (consulta + registro de abonos).
- CxP proveedores (consulta + registro de pagos).
- Lotes/vencimientos (consulta y alertas).
- Caja (apertura/cierre y movimientos basicos).

## 3. Fuera de alcance V1
- Configuracion administrativa avanzada.
- Superadmin y gestion completa de menus/permisos.
- Reporteria pesada y BI.

## 4. Stack tecnico propuesto
- React Native con Expo + TypeScript.
- Navegacion: Expo Router (o React Navigation).
- Estado local: Zustand.
- Datos remotos: Supabase JS (auth, rpc, realtime).
- Offline local: SQLite (expo-sqlite) con cola de sincronizacion.
- Monitoreo: Sentry (fase 2).
- IA: Edge Function + modelo externo (DeepSeek/OpenAI) desde backend, no directo desde app.

## 5. Arquitectura funcional
- Capa UI: pantallas y componentes mobile.
- Capa dominio: casos de uso por modulo (ventas, cartera, cxp, caja).
- Capa datos:
  - Remote: servicios Supabase (RPC/REST).
  - Local: SQLite para cache y cola offline.
- Capa sync:
  - Pull incremental por `updated_at`.
  - Push de operaciones pendientes (`pending_ops`).
  - Reintentos con backoff y control de conflictos.

## 6. Offline-first (requerimiento clave)
### 6.1 Tablas locales minimas
- `local_sales_draft`
- `local_sale_lines_draft`
- `local_payments_draft`
- `local_cartera_payments_draft`
- `local_supplier_payments_draft`
- `pending_ops`
- `sync_state`

### 6.2 Estrategia
- Escrituras se guardan primero en local.
- Sync worker envia operaciones cuando hay conectividad.
- Cada operacion lleva `op_id`, `tenant_id`, `user_id`, `device_id`, `created_at`.
- Idempotencia backend por `op_id` para evitar duplicados.

### 6.3 Conflictos
- Reglas:
  - Operaciones financieras: nunca sobreescribir silenciosamente.
  - Si hay conflicto: marcar `REQUIRES_REVIEW`.
  - Auditoria obligatoria por `source_device` y timestamps.

## 7. IA en mobile (sin alucinaciones)
### 7.1 Casos V1
- Sugerencia de compra por sede.
- Sugerencia de precio con limites.

### 7.2 Guardrails obligatorios
- Prompt armado en backend con datos acotados y trazables.
- En respuesta incluir:
  - `confidence`
  - `data_window_days`
  - `assumptions`
  - `warnings`
- Prohibir recomendaciones cuando no hay datos minimos.

## 8. Seguridad
- Auth Supabase + JWT.
- RLS en backend (ya implementado en core web).
- En mobile, no confiar en ocultar UI: backend decide acceso real.
- Tokens en almacenamiento seguro (SecureStore).

## 9. Roadmap sugerido (4 semanas)
### Semana 1
- Bootstrap RN + Expo + auth + tenant + tema + navegacion.
### Semana 2
- POS mobile online + consultas base (stock, precios, metodos pago).
### Semana 3
- Offline queue + sync incremental + manejo de conflictos.
### Semana 4
- IA asistida (2 casos), alertas realtime, hardening QA.

## 10. Instalacion necesaria en tu PC (Windows)
## 10.1 Requeridos
- Node.js LTS (>= 18.18 recomendado por RN docs).
- npm (incluido con Node) o pnpm/yarn.
- Git.
- VS Code.
- Android Studio.
- JDK 17.
- Android SDK Platform 35 + Build-Tools 35.0.0 + Command-line Tools.
- Emulador Android (AVD) o dispositivo fisico con depuracion USB.

## 10.2 Opcionales recomendados
- Expo Go (en celular Android/iOS para pruebas rapidas).
- EAS CLI para builds cloud:
  - `npm i -g eas-cli`
- Sentry CLI (fase observabilidad).

## 10.3 Variables de entorno (Windows)
- `ANDROID_HOME` apuntando al SDK, ejemplo:
  - `C:\Users\<tu_usuario>\AppData\Local\Android\Sdk`
- Agregar al `Path`:
  - `%ANDROID_HOME%\platform-tools`
  - `%ANDROID_HOME%\emulator`
  - `%ANDROID_HOME%\cmdline-tools\latest\bin`

## 10.4 Verificacion rapida
```bash
node -v
npm -v
java -version
adb --version
```

## 11. Comandos para iniciar proyecto (otra ventana VSCode)
```bash
npx create-expo-app@latest poslite-mobile --template
cd poslite-mobile
npx expo install
npx expo start
```

Si quieres TypeScript explicito:
```bash
npx create-expo-app@latest poslite-mobile -t expo-template-blank-typescript
```

## 12. Estructura base recomendada
```txt
src/
  app/                  # rutas/pantallas
  components/
  modules/
    auth/
    pos/
    cartera/
    payables/
    batches/
    cash/
  services/
    api/
    sync/
    ai/
  storage/
    sqlite/
  state/
  utils/
```

## 13. Criterios de aceptacion V1
- Login y tenant funcionan en emulador y dispositivo.
- Venta basica completa en modo online.
- En offline, operaciones quedan en cola sin perder datos.
- Sync posterior sin duplicados.
- IA responde con trazabilidad y nivel de confianza.

## 14. Referencias oficiales
- React Native Environment Setup:
  - https://reactnative.dev/docs/environment-setup
- React Native Set Up Your Environment:
  - https://reactnative.dev/docs/0.78/set-up-your-environment
- Expo docs:
  - https://docs.expo.dev/
- Create Expo App:
  - https://docs.expo.dev/get-started/create-a-project/
