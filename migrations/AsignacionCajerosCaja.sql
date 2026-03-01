/* ============================================================================
   POS PYMES - MODIFICACIONES: ASIGNACIÓN CAJERO→CAJA + SESIÓN ÚNICA + LISTADO CAJAS
   ----------------------------------------------------------------------------
   Objetivo:
   1) Admin asigna cajas a cajeros (el cajero NO se auto-asigna)
   2) Un cajero solo puede tener 1 sesión OPEN a la vez (por tenant)
   3) Una caja solo puede tener 1 sesión OPEN a la vez (por tenant)
   4) SP para abrir sesión validando asignación + restricciones
   5) Vista/función para listar cajas asignadas al usuario
   6) Recomendación: reforzar SP de venta/abonos para validar "dueño" de sesión

   REQUISITOS:
   - Ya existen tablas base:
     tenants, users, cash_registers, cash_sessions
   - Opcional pero recomendado: ya existe tabla roles/permissions; aquí no la tocamos.
   ============================================================================ */

-- =========================
-- 1) TABLA: ASIGNACIONES
-- =========================
create table if not exists cash_register_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  cash_register_id uuid not null references cash_registers(cash_register_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,

  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid not null references users(user_id),

  note text,

  unique (tenant_id, cash_register_id, user_id)
);

create index if not exists ix_cash_register_assignments_lookup
on cash_register_assignments(tenant_id, user_id, cash_register_id, is_active);

-- =========================
-- 2) RESTRICCIONES: SESIÓN ÚNICA
-- =========================
-- 2.1 Un usuario (cajero) solo puede tener 1 sesión OPEN a la vez
create unique index if not exists ux_cash_sessions_one_open_per_user
on cash_sessions(tenant_id, opened_by)
where status = 'OPEN';

-- 2.2 Una caja solo puede tener 1 sesión OPEN a la vez
create unique index if not exists ux_cash_sessions_one_open_per_register
on cash_sessions(tenant_id, cash_register_id)
where status = 'OPEN';

-- =========================
-- 3) FUNCIONES DE VALIDACIÓN
-- =========================
create or replace function fn_user_can_use_cash_register(
  p_tenant uuid,
  p_user uuid,
  p_cash_register uuid
) returns boolean
language sql
as $$
  select exists (
    select 1
    from cash_register_assignments a
    where a.tenant_id = p_tenant
      and a.user_id = p_user
      and a.cash_register_id = p_cash_register
      and a.is_active = true
  );
$$;

-- Devuelve la sesión OPEN actual del usuario (si existe)
create or replace function fn_get_open_cash_session_for_user(
  p_tenant uuid,
  p_user uuid
) returns uuid
language sql
as $$
  select cs.cash_session_id
  from cash_sessions cs
  where cs.tenant_id = p_tenant
    and cs.opened_by = p_user
    and cs.status = 'OPEN'
  order by cs.opened_at desc
  limit 1;
$$;

-- =========================
-- 4) VISTA: CAJAS ASIGNADAS AL USUARIO
-- =========================
create or replace view vw_user_cash_registers as
select
  a.tenant_id,
  a.user_id,
  u.full_name as user_name,
  a.cash_register_id,
  cr.name as cash_register_name,
  cr.location_id,
  l.name as location_name,
  a.is_active,
  a.assigned_at,
  a.assigned_by
from cash_register_assignments a
join users u on u.user_id = a.user_id
join cash_registers cr on cr.cash_register_id = a.cash_register_id
join locations l on l.location_id = cr.location_id;

-- =========================
-- 5) SP: ASIGNAR CAJA A CAJERO (ADMIN)
-- =========================
/*
Este SP lo debe llamar el ADMIN desde la UI.
En el servicio/API valida permiso (ej: CASH.ASSIGN o SECURITY.USERS.MANAGE).
*/
create or replace function sp_assign_cash_register_to_user(
  p_tenant uuid,
  p_cash_register uuid,
  p_user uuid,
  p_assigned_by uuid,
  p_is_active boolean default true,
  p_note text default null
) returns void
language plpgsql
as $$
begin
  -- (opcional) podrías validar que p_assigned_by sea ADMIN en tu capa de negocio.
  insert into cash_register_assignments(
    tenant_id, cash_register_id, user_id, is_active, assigned_at, assigned_by, note
  )
  values(
    p_tenant, p_cash_register, p_user, p_is_active, now(), p_assigned_by, p_note
  )
  on conflict (tenant_id, cash_register_id, user_id)
  do update set
    is_active = excluded.is_active,
    assigned_at = now(),
    assigned_by = excluded.assigned_by,
    note = excluded.note;
end;
$$;

-- =========================
-- 6) SP: ABRIR SESIÓN (CAJERO)
-- =========================
/*
Reglas:
- Usuario debe estar asignado a la caja
- DB garantiza:
  - 1 sesión OPEN por usuario
  - 1 sesión OPEN por caja
*/
create or replace function sp_open_cash_session(
  p_tenant uuid,
  p_cash_register uuid,
  p_opened_by uuid,
  p_opening_amount numeric(14,2)
) returns uuid
language plpgsql
as $$
declare
  v_session uuid;
  v_existing uuid;
begin
  if not fn_user_can_use_cash_register(p_tenant, p_opened_by, p_cash_register) then
    raise exception 'User is not assigned to this cash register';
  end if;

  -- Si ya tiene una sesión abierta, devolvemos esa (UX friendly)
  v_existing := fn_get_open_cash_session_for_user(p_tenant, p_opened_by);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into cash_sessions(
    tenant_id, cash_register_id, opened_by, opened_at, opening_amount, status
  )
  values(
    p_tenant, p_cash_register, p_opened_by, now(), coalesce(p_opening_amount,0), 'OPEN'
  )
  returning cash_session_id into v_session;

  return v_session;
exception
  when unique_violation then
    -- Por concurrencia: si otro proceso abrió casi al mismo tiempo, devolvemos la existente
    v_existing := fn_get_open_cash_session_for_user(p_tenant, p_opened_by);
    if v_existing is not null then
      return v_existing;
    end if;
    raise;
end;
$$;

-- =========================
-- 7) SP: CERRAR SESIÓN (CAJERO)
-- =========================
/*
Recomendación: cerrar solo si el usuario es dueño de la sesión.
Si tu sp_close_cash_session ya existe y lo quieres mantener, usa este wrapper.
*/
create or replace function sp_close_cash_session_secure(
  p_tenant uuid,
  p_cash_session uuid,
  p_closed_by uuid,
  p_counted_amount numeric(14,2)
) returns void
language plpgsql
as $$
begin
  perform 1
  from cash_sessions cs
  where cs.tenant_id = p_tenant
    and cs.cash_session_id = p_cash_session
    and cs.status = 'OPEN'
    and cs.opened_by = p_closed_by
  for update;

  if not found then
    raise exception 'Cash session not found/OPEN or not owned by user';
  end if;

  -- Llama tu SP de cierre (debe existir)
  perform sp_close_cash_session(p_tenant, p_cash_session, p_closed_by, p_counted_amount);
end;
$$;

-- =========================
-- 8) FUNCIÓN ÚTIL: "HOME POS" (qué mostrar al login)
-- =========================
/*
Devuelve:
- open_cash_session_id (si ya tiene)
- cantidad de cajas asignadas activas
- si solo tiene 1 caja, su cash_register_id recomendado
*/
create or replace function fn_pos_home_context(
  p_tenant uuid,
  p_user uuid
) returns table(
  open_cash_session_id uuid,
  assigned_registers_count int,
  single_cash_register_id uuid
)
language sql
as $$
  with open_s as (
    select fn_get_open_cash_session_for_user(p_tenant, p_user) as sid
  ),
  regs as (
    select a.cash_register_id
    from cash_register_assignments a
    where a.tenant_id=p_tenant and a.user_id=p_user and a.is_active=true
  )
  select
    (select sid from open_s) as open_cash_session_id,
    (select count(*) from regs) as assigned_registers_count,
    (case when (select count(*) from regs)=1 then (select cash_register_id from regs limit 1) else null end) as single_cash_register_id;
$$;

-- =========================
-- 9) RECOMENDACIÓN DE SEGURIDAD (NO OBLIGATORIO, PERO CLAVE)
-- =========================
/*
En tus SP operativos (sp_create_sale, sp_add_layaway_payment, cash_movements)
asegúrate de validar:
- la sesión de caja está OPEN
- y cs.opened_by = usuario que ejecuta
Ejemplo patrón:

perform 1 from cash_sessions cs
where cs.tenant_id=p_tenant
  and cs.cash_session_id=p_cash_session
  and cs.status='OPEN'
  and cs.opened_by=p_user;

if not found then raise exception ...; end if;
*/
