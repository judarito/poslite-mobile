-- Corrige detección de Super Admin para modelo users(auth_user_id)
create or replace function fn_is_super_admin()
returns boolean
language plpgsql
security definer
as $$
declare
  v_auth_user_id uuid;
  v_has_profile boolean := false;
begin
  v_auth_user_id := auth.uid();

  if v_auth_user_id is null then
    return false;
  end if;

  select exists(
    select 1
    from users
    where auth_user_id = v_auth_user_id
  ) into v_has_profile;

  return not v_has_profile;
end;
$$;

comment on function fn_is_super_admin is
'Super Admin = auth user sin perfil en public.users (users.auth_user_id = auth.uid())';
