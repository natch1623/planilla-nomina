-- =====================================================================
-- Planilla: esquema de la nube (Supabase)
--
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr:
-- todo usa "if not exists" / "or replace".
--
-- Modelo:
--   companies        una fila por empresa; `data` es el mismo JSON (AppData)
--                    que la app guarda hoy en localStorage.
--   company_members  quién puede ver/editar cada empresa.
--
-- Seguridad: la anon key viaja en el sitio público, así que TODA la
-- protección vive en las políticas RLS de abajo. Sin sesión iniciada no se
-- lee ni una fila; con sesión, solo las empresas donde el usuario es miembro.
-- =====================================================================

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  data        jsonb not null,
  -- Sube en 1 con cada guardado. El cliente guarda "si revision = la que
  -- conozco"; si otra persona guardó antes, no pisa nada y se entera.
  revision    bigint not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  -- Copia del correo para poder decir "cambios de fulano" sin leer auth.users.
  updated_by_email text,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- owner:  Administrador. Todo, incluido manejar personas y borrar la empresa.
  -- editor: ve y modifica todos los datos.
  -- viewer: ve todos los datos, no modifica nada.
  -- costos: SOLO la lista de costos (ver, agregar, editar). Nunca recibe
  --         salarios, registro diario ni el resto de la empresa: no puede
  --         leer la tabla companies y trabaja con get/save_company_costs().
  role        text not null default 'editor',
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- Fuera del create para que al volver a correr el script se actualice la
-- lista de roles aunque la tabla ya exista.
alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members add constraint company_members_role_check
  check (role in ('owner', 'editor', 'viewer', 'costos'));

create index if not exists company_members_user_idx on public.company_members(user_id);

-- ---------------------------------------------------------------------
-- Revisión, fecha y autor los pone el servidor, no el cliente.
-- ---------------------------------------------------------------------
create or replace function public.companies_before_update()
returns trigger language plpgsql as $$
begin
  new.revision   := old.revision + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_email := auth.jwt() ->> 'email';
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists companies_before_update on public.companies;
create trigger companies_before_update
  before update on public.companies
  for each row execute function public.companies_before_update();

-- Crear empresa y quedar como owner en un solo paso. Va por función porque
-- un insert directo no podría devolver la fila: hasta que existe la
-- membresía, RLS no deja leerla.
create or replace function public.create_company(p_name text, p_data jsonb)
returns table (id uuid, revision bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión';
  end if;
  insert into public.companies (name, data, created_by, updated_by, updated_by_email)
  values (coalesce(p_name, ''), p_data, auth.uid(), auth.uid(), auth.jwt() ->> 'email')
  returning companies.id into v_id;
  insert into public.company_members (company_id, user_id, role)
  values (v_id, auth.uid(), 'owner');
  return query select c.id, c.revision from public.companies c where c.id = v_id;
end $$;

-- ---------------------------------------------------------------------
-- Helpers para RLS. Son security definer para que la política de
-- company_members no se consulte a sí misma (recursión infinita).
-- ---------------------------------------------------------------------
create or replace function public.company_role(p_company uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.company_members
  where company_id = p_company and user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------
alter table public.companies       enable row level security;
alter table public.company_members enable row level security;

-- Doble cerrojo: aunque una política quedara mal, sin sesión no hay acceso.
revoke all on public.companies       from anon;
revoke all on public.company_members from anon;

-- El rol costos queda fuera a propósito: leer la fila es leer toda la
-- empresa, salarios incluidos.
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select to authenticated
  using (public.company_role(id) in ('owner', 'editor', 'viewer'));

-- Sin política de insert: las empresas se crean solo con create_company().

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update to authenticated
  using (public.company_role(id) in ('owner', 'editor'))
  with check (public.company_role(id) in ('owner', 'editor'));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
  for delete to authenticated
  using (public.company_role(id) = 'owner');

-- Cada miembro ve la lista de miembros de sus empresas; solo el owner la
-- modifica (y lo hace por medio de las funciones de abajo).
drop policy if exists members_select on public.company_members;
create policy members_select on public.company_members
  for select to authenticated
  using (public.company_role(company_id) is not null);

-- ---------------------------------------------------------------------
-- Invitar / quitar miembros por correo. El usuario debe existir ya en
-- Authentication → Users.
-- ---------------------------------------------------------------------
create or replace function public.add_company_member(p_company uuid, p_email text, p_role text default 'editor')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if public.company_role(p_company) is distinct from 'owner' then
    raise exception 'Solo un administrador de la empresa puede agregar personas';
  end if;
  if p_role not in ('owner', 'editor', 'viewer', 'costos') then
    raise exception 'Rol inválido: %', p_role;
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No existe el usuario %', split_part(p_email, '@', 1);
  end if;
  insert into public.company_members (company_id, user_id, role)
  values (p_company, v_user, p_role)
  on conflict (company_id, user_id) do update set role = excluded.role;
end $$;

create or replace function public.remove_company_member(p_company uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.company_role(p_company) is distinct from 'owner' then
    raise exception 'Solo un administrador de la empresa puede quitar personas';
  end if;
  if p_user = auth.uid() then
    raise exception 'No puedes quitarte a ti mismo';
  end if;
  delete from public.company_members where company_id = p_company and user_id = p_user;
end $$;

-- Lista de miembros con su correo (auth.users no es legible desde el cliente).
create or replace function public.list_company_members(p_company uuid)
returns table (user_id uuid, email text, role text)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role
  from public.company_members m
  join auth.users u on u.id = m.user_id
  where m.company_id = p_company
    and public.company_role(p_company) is not null
  order by u.email
$$;

-- ---------------------------------------------------------------------
-- Lectura liviana para todos los roles (costos incluido): lista de
-- empresas y revisión, sin el JSON de datos.
-- ---------------------------------------------------------------------
create or replace function public.my_companies()
returns table (id uuid, name text, revision bigint, updated_at timestamptz, updated_by_email text, role text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.revision, c.updated_at, c.updated_by_email, m.role
  from public.company_members m
  join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid()
  order by c.name
$$;

create or replace function public.company_revision(p_company uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select c.revision from public.companies c
  where c.id = p_company and public.company_role(p_company) is not null
$$;

-- ---------------------------------------------------------------------
-- Costos: la única puerta del rol costos a los datos. Solo entra y sale
-- la lista `costs` del JSON; el resto de la empresa nunca viaja.
-- ---------------------------------------------------------------------
create or replace function public.get_company_costs(p_company uuid)
returns table (costs jsonb, revision bigint, updated_at timestamptz, updated_by_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.company_role(p_company) is null then
    raise exception 'No tienes acceso a esta empresa';
  end if;
  return query
    select coalesce(c.data -> 'costs', '[]'::jsonb), c.revision, c.updated_at, c.updated_by_email
    from public.companies c where c.id = p_company;
end $$;

-- Devuelve la revisión nueva, o null si otra persona guardó antes
-- (misma regla de "solo si la revisión sigue siendo la que conozco").
create or replace function public.save_company_costs(p_company uuid, p_costs jsonb, p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_rev bigint;
begin
  if coalesce(public.company_role(p_company), '') not in ('owner', 'editor', 'costos') then
    raise exception 'No tienes permiso para modificar costos en esta empresa';
  end if;
  if jsonb_typeof(p_costs) is distinct from 'array' then
    raise exception 'Formato de costos inválido';
  end if;
  update public.companies
     set data = jsonb_set(data, '{costs}', p_costs, true)
   where id = p_company and revision = p_expected_revision
  returning revision into v_rev;
  return v_rev;
end $$;

revoke all on function public.my_companies()                         from public, anon;
revoke all on function public.company_revision(uuid)                 from public, anon;
revoke all on function public.get_company_costs(uuid)                from public, anon;
revoke all on function public.save_company_costs(uuid, jsonb, bigint) from public, anon;
grant execute on function public.my_companies()                         to authenticated;
grant execute on function public.company_revision(uuid)                 to authenticated;
grant execute on function public.get_company_costs(uuid)                to authenticated;
grant execute on function public.save_company_costs(uuid, jsonb, bigint) to authenticated;

revoke all on function public.create_company(text, jsonb)            from public, anon;
grant execute on function public.create_company(text, jsonb)          to authenticated;
revoke all on function public.add_company_member(uuid, text, text)   from public, anon;
revoke all on function public.remove_company_member(uuid, uuid)      from public, anon;
revoke all on function public.list_company_members(uuid)             from public, anon;
grant execute on function public.add_company_member(uuid, text, text) to authenticated;
grant execute on function public.remove_company_member(uuid, uuid)    to authenticated;
grant execute on function public.list_company_members(uuid)           to authenticated;

-- ---------------------------------------------------------------------
-- Tiempo real: avisar a los demás cuando alguien guarda.
-- (Respeta RLS: solo llegan avisos de empresas donde uno es miembro.)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'companies'
  ) then
    alter publication supabase_realtime add table public.companies;
  end if;
end $$;
