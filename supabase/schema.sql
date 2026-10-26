-- =====================================================================
-- Planilla: esquema de la nube (Supabase)
--
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr
-- cuantas veces haga falta: actualiza lo que ya existe sin borrar datos.
--
-- Modelo:
--   roles            qué puede hacer cada rango (Administrador, Editor, …).
--   companies        una fila por empresa; `data` es el mismo JSON (AppData)
--                    que la app guarda en el navegador.
--   company_members  quién entra a cada empresa y con qué rango.
--
-- Seguridad: la anon key viaja en el sitio público, así que TODA la
-- protección vive aquí. Sin sesión no se lee nada; con sesión, solo las
-- empresas donde uno es miembro y solo lo que su rango permite.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Rangos
--
-- Un rango combina permisos generales y "secciones". Una sección es una
-- parte acotada de la empresa que se puede ver y editar sin recibir el
-- resto (sobre todo sin salarios):
--   asistencia  colaboradores SIN tarifas ni salarios + registro diario
--   costos      lista de pagos a proveedores / terceros
--
-- Para crear un rango nuevo que combine secciones existentes basta con
-- agregar una fila (Table Editor → roles → Insert). Una sección nueva sí
-- requiere programarla aquí (get/save_company_section) y en la app.
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  role            text primary key,
  label           text not null,
  description     text not null default '',
  -- Ve la empresa completa (salarios incluidos).
  reads_all       boolean not null default false,
  -- Modifica la empresa completa.
  writes_all      boolean not null default false,
  -- Agrega y quita personas, borra la empresa de la nube.
  manages_members boolean not null default false,
  -- Secciones que ve y edita aunque no tenga lo anterior.
  sections        text[] not null default '{}',
  sort            int not null default 100
);

alter table public.roles drop constraint if exists roles_sections_check;
alter table public.roles add constraint roles_sections_check
  check (sections <@ array['asistencia', 'costos']::text[]);

-- Rangos de fábrica. Al volver a correr el script se restablecen sus
-- definiciones; los rangos que agregues tú no se tocan.
insert into public.roles (role, label, description, reads_all, writes_all, manages_members, sections, sort) values
  ('owner',      'Administrador', 'Todo, incluido agregar y quitar personas.',                                     true,  true,  true,  '{}',             10),
  ('editor',     'Editor',        'Ve y modifica todos los datos.',                                                true,  true,  false, '{}',             20),
  ('viewer',     'Solo lectura',  'Ve todo, no modifica nada.',                                                    true,  false, false, '{}',             30),
  ('asistencia', 'Asistencia',    'Registra horas en el Registro Diario. No ve salarios, tarifas ni montos.',      false, false, false, '{asistencia}',   40),
  ('costos',     'Caja',          'Registra cobros y pagos en Caja. No ve salarios, registro diario ni dashboard.', false, false, false, '{costos}',       50)
on conflict (role) do update set
  label = excluded.label, description = excluded.description,
  reads_all = excluded.reads_all, writes_all = excluded.writes_all,
  manages_members = excluded.manages_members, sections = excluded.sections,
  sort = excluded.sort;


-- ---------------------------------------------------------------------
-- Empresas y miembros
-- ---------------------------------------------------------------------
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
  role        text not null default 'editor',
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- El rango tiene que existir en `roles`. (Una versión anterior del script
-- usaba una lista fija; se reemplaza por la referencia a la tabla.)
alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members drop constraint if exists company_members_role_fkey;
alter table public.company_members add constraint company_members_role_fkey
  foreign key (role) references public.roles(role) on update cascade;

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


-- ---------------------------------------------------------------------
-- Permisos del usuario actual en una empresa. Security definer para que
-- las políticas no se consulten a sí mismas (recursión infinita).
-- ---------------------------------------------------------------------
create or replace function public.company_role(p_company uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.company_members
  where company_id = p_company and user_id = auth.uid()
$$;

create or replace function public.company_access(p_company uuid)
returns public.roles language sql stable security definer set search_path = public as $$
  select r.* from public.company_members m
  join public.roles r on r.role = m.role
  where m.company_id = p_company and m.user_id = auth.uid()
$$;

create or replace function public.can_read_all(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.company_access(p_company)).reads_all, false)
$$;

create or replace function public.can_write_all(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.company_access(p_company)).writes_all, false)
$$;

create or replace function public.can_manage(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.company_access(p_company)).manages_members, false)
$$;

create or replace function public.has_section(p_company uuid, p_section text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_section = any((public.company_access(p_company)).sections), false)
$$;


-- ---------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------
alter table public.roles           enable row level security;
alter table public.companies       enable row level security;
alter table public.company_members enable row level security;

-- Doble cerrojo: aunque una política quedara mal, sin sesión no hay acceso.
revoke all on public.roles           from anon;
revoke all on public.companies       from anon;
revoke all on public.company_members from anon;
-- Los rangos se administran desde el panel de Supabase, no desde la app.
revoke insert, update, delete on public.roles from authenticated;

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated using (true);

-- Leer la fila es leer toda la empresa: solo rangos con reads_all. Los
-- demás entran por get_company_section().
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select to authenticated
  using (public.can_read_all(id));

-- Sin política de insert: las empresas se crean solo con create_company().

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update to authenticated
  using (public.can_write_all(id))
  with check (public.can_write_all(id));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
  for delete to authenticated
  using (public.can_manage(id));

drop policy if exists members_select on public.company_members;
create policy members_select on public.company_members
  for select to authenticated
  using (public.company_role(company_id) is not null);


-- ---------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------

-- Crear empresa y quedar como Administrador en un solo paso. Va por función
-- porque un insert directo no podría devolver la fila: hasta que existe la
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

-- Empresas del usuario con los permisos de su rango, sin el JSON de datos.
drop function if exists public.my_companies();
create or replace function public.my_companies()
returns table (
  id uuid, name text, revision bigint, updated_at timestamptz, updated_by_email text,
  role text, role_label text, reads_all boolean, writes_all boolean,
  manages_members boolean, sections text[]
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.revision, c.updated_at, c.updated_by_email,
         r.role, r.label, r.reads_all, r.writes_all, r.manages_members, r.sections
  from public.company_members m
  join public.companies c on c.id = m.company_id
  join public.roles r on r.role = m.role
  where m.user_id = auth.uid()
  order by c.name
$$;

create or replace function public.company_revision(p_company uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select c.revision from public.companies c
  where c.id = p_company and public.company_role(p_company) is not null
$$;


-- ---------------------------------------------------------------------
-- Secciones: la única puerta de los rangos sin reads_all a los datos.
-- Solo entra y sale lo de la sección; el resto nunca viaja.
-- ---------------------------------------------------------------------

-- Clave de quincena igual a la de la app: 2026-09-1 / 2026-09-2.
create or replace function public.period_key(p_date text)
returns text language sql immutable as $$
  select to_char(p_date::date, 'YYYY-MM') || '-' ||
         case when extract(day from p_date::date) <= 15 then '1' else '2' end
$$;

create or replace function public.section_payload(p_data jsonb, p_section text)
returns jsonb language sql immutable as $$
  select case p_section
    when 'asistencia' then jsonb_build_object(
      'version',           p_data -> 'version',
      'companyName',       p_data -> 'companyName',
      -- Colaboradores sin tarifas, salario, cédula ni deducciones.
      'employees', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e -> 'id', 'name', e -> 'name', 'position', e -> 'position',
          'category', e -> 'category', 'paymentType', e -> 'paymentType',
          'schedule', e -> 'schedule', 'active', e -> 'active'))
        from jsonb_array_elements(coalesce(p_data -> 'employees', '[]')) e), '[]'),
      'timeEntries',       coalesce(p_data -> 'timeEntries', '[]'),
      -- Solo qué quincenas están cerradas, sin los montos congelados.
      'closedPeriods', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', c -> 'key', 'period', c -> 'period', 'closedAt', c -> 'closedAt',
          'summaries', '[]'::jsonb))
        from jsonb_array_elements(coalesce(p_data -> 'closedPeriods', '[]')) c), '[]'),
      -- Reglas de horas (umbral de extra, jornada): necesarias para contar horas.
      'overtimeThreshold', p_data -> 'overtimeThreshold',
      'standardDayHours',  p_data -> 'standardDayHours',
      'holidayRate',       p_data -> 'holidayRate',
      'payVacations',      p_data -> 'payVacations',
      'payHolidays',       p_data -> 'payHolidays',
      'paySickLeave',      p_data -> 'paySickLeave')
    when 'costos' then jsonb_build_object(
      'version',       p_data -> 'version',
      'companyName',   p_data -> 'companyName',
      'costs',         coalesce(p_data -> 'costs', '[]'),
      -- Beneficiarios frecuentes para autorrellenar "a quién se le paga".
      'costTemplates', coalesce(p_data -> 'costTemplates', '[]'),
      -- Encargadas con PIN: viajan para que las mismas personas puedan
      -- registrar pagos desde cualquier estación.
      'costOperators', coalesce(p_data -> 'costOperators', '[]'),
      -- Arqueos de caja al abrir y cerrar turno: efectivo y notas.
      'costCashCounts', coalesce(p_data -> 'costCashCounts', '[]'))
  end
$$;

create or replace function public.get_company_section(p_company uuid, p_section text)
returns table (payload jsonb, revision bigint, updated_at timestamptz, updated_by_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.can_read_all(p_company) or public.has_section(p_company, p_section)) then
    raise exception 'No tienes acceso a esta sección';
  end if;
  return query
    select public.section_payload(c.data, p_section), c.revision, c.updated_at, c.updated_by_email
    from public.companies c where c.id = p_company;
end $$;

-- Devuelve la revisión nueva, o null si otra persona guardó antes.
create or replace function public.save_company_section(
  p_company uuid, p_section text, p_payload jsonb, p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_data   jsonb;
  v_closed text[];
  v_rev    bigint;
begin
  if not (public.can_write_all(p_company) or public.has_section(p_company, p_section)) then
    raise exception 'No tienes permiso para modificar esta sección';
  end if;

  select data into v_data from public.companies
   where id = p_company and revision = p_expected_revision
   for update;
  if v_data is null then
    return null; -- otra persona guardó antes (o la empresa no existe)
  end if;

  if p_section = 'asistencia' then
    if jsonb_typeof(p_payload -> 'timeEntries') is distinct from 'array' then
      raise exception 'Formato de registros inválido';
    end if;
    -- Los días de quincenas cerradas no se tocan: se conservan los que hay
    -- y se ignora lo que llegue para esas fechas.
    select coalesce(array_agg(c ->> 'key'), '{}') into v_closed
      from jsonb_array_elements(coalesce(v_data -> 'closedPeriods', '[]')) c;
    v_data := jsonb_set(v_data, '{timeEntries}', coalesce((
      select jsonb_agg(e) from (
        select e from jsonb_array_elements(coalesce(v_data -> 'timeEntries', '[]')) e
         where public.period_key(e ->> 'date') = any(v_closed)
        union all
        select e from jsonb_array_elements(p_payload -> 'timeEntries') e
         where not (public.period_key(e ->> 'date') = any(v_closed))
      ) t), '[]'));

  elsif p_section = 'costos' then
    if jsonb_typeof(p_payload -> 'costs') is distinct from 'array' then
      raise exception 'Formato de costos inválido';
    end if;
    v_data := jsonb_set(v_data, '{costs}', p_payload -> 'costs', true);
    -- Opcionales: un cliente anterior a ellos no los manda y no se tocan.
    if jsonb_typeof(p_payload -> 'costTemplates') = 'array' then
      v_data := jsonb_set(v_data, '{costTemplates}', p_payload -> 'costTemplates', true);
    end if;
    if jsonb_typeof(p_payload -> 'costOperators') = 'array' then
      v_data := jsonb_set(v_data, '{costOperators}', p_payload -> 'costOperators', true);
    end if;
    if jsonb_typeof(p_payload -> 'costCashCounts') = 'array' then
      v_data := jsonb_set(v_data, '{costCashCounts}', p_payload -> 'costCashCounts', true);
    end if;

  else
    raise exception 'Sección desconocida: %', p_section;
  end if;

  update public.companies set data = v_data
   where id = p_company
  returning revision into v_rev;
  return v_rev;
end $$;

-- Versión anterior del script (solo costos); reemplazada por las de arriba.
drop function if exists public.get_company_costs(uuid);
drop function if exists public.save_company_costs(uuid, jsonb, bigint);


-- ---------------------------------------------------------------------
-- Archivos adjuntos (comprobantes y fotos de incapacidad)
--
-- No viajan dentro del JSON de la empresa: cada guardado reenviaría todas
-- las fotos. Viven en el bucket `adjuntos`, privado, con las rutas
--   <id de la empresa>/movimientos/<archivo>
--   <id de la empresa>/incapacidades/<archivo>
-- y se leen con enlaces firmados de corta duración.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('adjuntos', 'adjuntos', false)
on conflict (id) do nothing;

-- Empresa y carpeta a partir de la ruta del archivo.
create or replace function public.storage_company(p_name text)
returns uuid language plpgsql immutable as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null; -- ruta que no empieza por un id de empresa: sin acceso
end $$;

create or replace function public.storage_scope(p_name text)
returns text language sql immutable as $$
  select coalesce((storage.foldername(p_name))[2], '')
$$;

/*
 * Quién puede ver cada cosa:
 *   movimientos    → cualquiera que pueda leer la empresa (incluye Solo lectura)
 *   incapacidades  → son datos médicos: solo quien edita la empresa
 *                    (Administrador, Editor) y el rango Asistencia, que es
 *                    quien registra la incapacidad y sube la foto.
 * Para subir o borrar hace falta poder editar, en ambos casos.
 */
create or replace function public.can_read_attachment(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.storage_scope(p_name)
    when 'movimientos'   then public.can_read_all(public.storage_company(p_name))
    when 'incapacidades' then public.can_write_all(public.storage_company(p_name))
                           or public.has_section(public.storage_company(p_name), 'asistencia')
    else false
  end
$$;

create or replace function public.can_write_attachment(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.storage_scope(p_name)
    when 'movimientos'   then public.can_write_all(public.storage_company(p_name))
    when 'incapacidades' then public.can_write_all(public.storage_company(p_name))
                           or public.has_section(public.storage_company(p_name), 'asistencia')
    else false
  end
$$;

drop policy if exists adjuntos_select on storage.objects;
create policy adjuntos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'adjuntos' and public.can_read_attachment(name));

drop policy if exists adjuntos_insert on storage.objects;
create policy adjuntos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'adjuntos' and public.can_write_attachment(name));

drop policy if exists adjuntos_update on storage.objects;
create policy adjuntos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'adjuntos' and public.can_write_attachment(name))
  with check (bucket_id = 'adjuntos' and public.can_write_attachment(name));

drop policy if exists adjuntos_delete on storage.objects;
create policy adjuntos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'adjuntos' and public.can_write_attachment(name));


-- ---------------------------------------------------------------------
-- Personas. El usuario debe existir ya en Authentication → Users.
-- ---------------------------------------------------------------------
create or replace function public.add_company_member(p_company uuid, p_email text, p_role text default 'editor')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if not public.can_manage(p_company) then
    raise exception 'Solo un administrador de la empresa puede agregar personas';
  end if;
  if not exists (select 1 from public.roles where role = p_role) then
    raise exception 'Rango inválido: %', p_role;
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No existe el usuario %', split_part(p_email, '@', 1);
  end if;
  if v_user = auth.uid() and not exists (
    select 1 from public.roles where role = p_role and manages_members
  ) then
    raise exception 'No puedes quitarte a ti mismo el rango de administrador';
  end if;
  insert into public.company_members (company_id, user_id, role)
  values (p_company, v_user, p_role)
  on conflict (company_id, user_id) do update set role = excluded.role;
end $$;

create or replace function public.remove_company_member(p_company uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage(p_company) then
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
-- Quién puede llamar a cada función: solo usuarios con sesión.
-- ---------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_company(text, jsonb)',
    'public.my_companies()',
    'public.company_revision(uuid)',
    'public.get_company_section(uuid, text)',
    'public.save_company_section(uuid, text, jsonb, bigint)',
    'public.add_company_member(uuid, text, text)',
    'public.remove_company_member(uuid, uuid)',
    'public.list_company_members(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- Tiempo real: avisar a los demás cuando alguien guarda.
-- (Respeta RLS: solo llegan avisos de empresas que uno puede leer; los
-- rangos por sección se enteran consultando la revisión cada tanto.)
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

-- BEGIN DATA INTEGRITY MIGRATION (generated from migrations/20261022143152_data_integrity.sql)
-- Compatible con AppData v13/v14. No recalcula ni reemplaza datos existentes.
-- Ejecutar con respaldo verificado. Las pruebas usan PostgreSQL aislado (PGlite).

create schema if not exists planilla_private;
revoke all on schema planilla_private from public, anon, authenticated;
alter table public.companies add column if not exists deleted_at timestamptz;

create table if not exists planilla_private.company_versions (
  company_id uuid not null,
  revision bigint not null,
  recorded_at timestamptz not null default now(),
  actor_id uuid,
  operation text not null check (operation in ('baseline','insert','update','delete')),
  snapshot jsonb not null,
  members jsonb not null,
  primary key (company_id, revision)
);
alter table planilla_private.company_versions enable row level security;
revoke all on planilla_private.company_versions from public, anon, authenticated;
grant usage on schema planilla_private to service_role;
grant select on planilla_private.company_versions to service_role;

create or replace function planilla_private.immutable_versions()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'El historial de empresas es inmutable';
end $$;
revoke all on function planilla_private.immutable_versions() from public, anon, authenticated;
drop trigger if exists company_versions_immutable on planilla_private.company_versions;
create trigger company_versions_immutable before update or delete on planilla_private.company_versions
for each row execute function planilla_private.immutable_versions();

create or replace function planilla_private.capture_company_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_members jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(m) order by m.user_id), '[]') into v_members
  from public.company_members m where m.company_id = coalesce(new.id, old.id);
  if tg_op <> 'INSERT' then
    insert into planilla_private.company_versions(company_id,revision,actor_id,operation,snapshot,members)
    values(old.id,old.revision,auth.uid(),case when tg_op='DELETE' then 'delete' else 'baseline' end,to_jsonb(old),v_members)
    on conflict (company_id,revision) do nothing;
  end if;
  if tg_op <> 'DELETE' then
    insert into planilla_private.company_versions(company_id,revision,actor_id,operation,snapshot,members)
    values(new.id,new.revision,auth.uid(),lower(tg_op),to_jsonb(new),v_members);
  end if;
  return null;
end $$;
revoke all on function planilla_private.capture_company_version() from public, anon, authenticated;

-- Foto inicial exacta: no dispara el contador de revisión de las empresas.
insert into planilla_private.company_versions(company_id,revision,actor_id,operation,snapshot,members)
select c.id,c.revision,c.updated_by,'baseline',to_jsonb(c),
  coalesce((select jsonb_agg(to_jsonb(m) order by m.user_id) from public.company_members m where m.company_id=c.id),'[]')
from public.companies c on conflict (company_id,revision) do nothing;

drop trigger if exists companies_capture_version on public.companies;
create trigger companies_capture_version after insert or update or delete on public.companies
for each row execute function planilla_private.capture_company_version();

-- Equivale únicamente al relleno legacy de normalizeData; no permite cambiar
-- montos existentes. Mantiene guardables cierres anteriores a esos dos campos.
create or replace function public.payroll_closure_value(p_closure jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_set(p_closure,'{summaries}',coalesce((select jsonb_agg(s || jsonb_build_object(
    'manualAdjustment',case when jsonb_typeof(s->'manualAdjustment')='number' then s->'manualAdjustment' else '0'::jsonb end,
    'totalPay',case when jsonb_typeof(s->'totalPay')='number' then s->'totalPay' else s->'netSalary' end))
    from jsonb_array_elements(p_closure->'summaries') s),'[]'::jsonb))
$$;
revoke all on function public.payroll_closure_value(jsonb) from public,anon;
grant execute on function public.payroll_closure_value(jsonb) to authenticated;

create or replace function public.validate_company_document()
returns trigger language plpgsql set search_path = '' as $$
declare
  field text;
  closed jsonb;
  kept jsonb;
  old_entries jsonb;
  new_entries jsonb;
  old_adjustments jsonb;
  new_adjustments jsonb;
  old_charges jsonb;
  new_charges jsonb;
begin
  if jsonb_typeof(new.data) is distinct from 'object' then raise exception 'Documento de empresa inválido'; end if;
  foreach field in array array['employees','timeEntries','closedPeriods','manualAdjustments','transactions','counterparties','budgets','loans','goals','costs','costTemplates','costOperators','costCashCounts'] loop
    if jsonb_typeof(new.data -> field) is distinct from 'array' then
      -- Campos añadidos en versiones anteriores son opcionales si no existían.
      if field in ('employees','timeEntries') or (tg_op='UPDATE' and old.data ? field) or new.data ? field then
        raise exception 'Falta una lista válida: %', field;
      end if;
    end if;
  end loop;
  if new.data ? 'payrollArchives' and jsonb_typeof(new.data->'payrollArchives') is distinct from 'array' then raise exception 'Historial de cierres inválido'; end if;
  if tg_op <> 'UPDATE' then return new; end if;
  for closed in select value from jsonb_array_elements(coalesce(old.data->'payrollArchives','[]')) loop
    if not exists(select 1 from jsonb_array_elements(coalesce(new.data->'payrollArchives','[]')) a
      where public.payroll_closure_value(a)=public.payroll_closure_value(closed)) then
      raise exception 'No se puede borrar o modificar el historial de cierres';
    end if;
  end loop;
  for closed in select value from jsonb_array_elements(coalesce(old.data->'closedPeriods','[]')) loop
    select value into kept from jsonb_array_elements(coalesce(new.data->'closedPeriods','[]')) where value->>'key'=closed->>'key';
    if kept is null then
      if not exists(select 1 from jsonb_array_elements(coalesce(new.data->'payrollArchives','[]')) a
        where public.payroll_closure_value(a)=public.payroll_closure_value(closed)) then
        raise exception 'Reabrir requiere conservar el cierre anterior en el historial';
      end if;
      continue;
    end if;
    if public.payroll_closure_value(kept) <> public.payroll_closure_value(closed) then
      if kept->>'id' is not null and kept->>'id' is distinct from closed->>'id'
        and coalesce((kept->>'revision')::integer,0)>coalesce((closed->>'revision')::integer,1)
        and exists(select 1 from jsonb_array_elements(coalesce(new.data->'payrollArchives','[]')) a
          where public.payroll_closure_value(a)=public.payroll_closure_value(closed)) then continue; end if;
      raise exception 'No se puede modificar un cierre existente';
    end if;
    select coalesce(jsonb_agg(e order by e->>'id'),'[]') into old_entries
      from jsonb_array_elements(coalesce(old.data->'timeEntries','[]')) e where public.period_key(e->>'date')=closed->>'key';
    select coalesce(jsonb_agg(e order by e->>'id'),'[]') into new_entries
      from jsonb_array_elements(coalesce(new.data->'timeEntries','[]')) e where public.period_key(e->>'date')=closed->>'key';
    select coalesce(jsonb_agg(e order by e->>'id'),'[]') into old_adjustments
      from jsonb_array_elements(coalesce(old.data->'manualAdjustments','[]')) e where e->>'periodKey'=closed->>'key';
    select coalesce(jsonb_agg(e order by e->>'id'),'[]') into new_adjustments
      from jsonb_array_elements(coalesce(new.data->'manualAdjustments','[]')) e where e->>'periodKey'=closed->>'key';
    select coalesce(jsonb_agg(jsonb_build_array(l->>'id',l->'charges'->(closed->>'key')) order by l->>'id'),'[]') into old_charges
      from jsonb_array_elements(coalesce(old.data->'loans','[]')) l where l->'charges' ? (closed->>'key');
    select coalesce(jsonb_agg(jsonb_build_array(l->>'id',l->'charges'->(closed->>'key')) order by l->>'id'),'[]') into new_charges
      from jsonb_array_elements(coalesce(new.data->'loans','[]')) l where l->'charges' ? (closed->>'key');
    if old_entries <> new_entries or old_adjustments <> new_adjustments or old_charges <> new_charges then
      raise exception 'No se puede modificar asistencia, ajustes o cuotas de una quincena cerrada';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.validate_company_document() from public, anon, authenticated;
drop trigger if exists companies_validate_document on public.companies;
create trigger companies_validate_document before insert or update on public.companies
for each row execute function public.validate_company_document();

-- Los usuarios de la app no necesitan operaciones que omiten RLS.
revoke truncate, references, trigger on public.companies, public.company_members, public.roles from authenticated;
-- Las rutas de comprobantes son inmutables: se sube un archivo nuevo con otro
-- UUID. Desvincularlo del documento no autoriza destruir una revisión pasada.
drop policy if exists adjuntos_update on storage.objects;
drop policy if exists adjuntos_delete on storage.objects;
drop policy if exists adjuntos_no_update on storage.objects;
drop policy if exists adjuntos_no_delete on storage.objects;
create policy adjuntos_no_update on storage.objects as restrictive for update to authenticated
using(bucket_id <> 'adjuntos') with check(bucket_id <> 'adjuntos');
create policy adjuntos_no_delete on storage.objects as restrictive for delete to authenticated
using(bucket_id <> 'adjuntos');
alter function public.companies_before_update() set search_path = '';
alter function public.section_payload(jsonb,text) set search_path = '';
alter function public.period_key(text) set search_path = '';
alter function public.storage_company(text) set search_path = '';
alter function public.storage_scope(text) set search_path = '';

-- Borrado lógico. Un cliente viejo que intente DELETE recibe un error.
revoke delete on public.companies from authenticated;
create or replace function public.company_role(p_company uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.company_members m join public.companies c on c.id=m.company_id
  where m.company_id=p_company and m.user_id=auth.uid() and c.deleted_at is null
$$;
create or replace function public.company_access(p_company uuid)
returns public.roles language sql stable security definer set search_path = '' as $$
  select r.* from public.company_members m join public.roles r on r.role=m.role
  join public.companies c on c.id=m.company_id
  where m.company_id=p_company and m.user_id=auth.uid() and c.deleted_at is null
$$;
create or replace function public.my_companies()
returns table(id uuid,name text,revision bigint,updated_at timestamptz,updated_by_email text,role text,role_label text,reads_all boolean,writes_all boolean,manages_members boolean,sections text[])
language sql stable security definer set search_path = '' as $$
  select c.id,c.name,c.revision,c.updated_at,c.updated_by_email,r.role,r.label,r.reads_all,r.writes_all,r.manages_members,r.sections
  from public.company_members m join public.companies c on c.id=m.company_id join public.roles r on r.role=m.role
  where m.user_id=auth.uid() and c.deleted_at is null order by c.name
$$;
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
using(public.can_write_all(id) and deleted_at is null) with check(public.can_write_all(id) and deleted_at is null);

create or replace function public.delete_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.can_manage(p_company) and public.can_read_all(p_company)) then
    raise exception 'No tienes permiso para eliminar esta empresa';
  end if;
  update public.companies set deleted_at=now() where id=p_company and deleted_at is null;
end $$;
revoke all on function public.delete_company(uuid) from public, anon;
grant execute on function public.delete_company(uuid) to authenticated;

create or replace function public.restore_deleted_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.company_members m join public.roles r on r.role=m.role
    where m.company_id=p_company and m.user_id=auth.uid() and r.manages_members and r.reads_all) then
    raise exception 'No tienes permiso para recuperar esta empresa';
  end if;
  update public.companies set deleted_at=null where id=p_company and deleted_at is not null;
end $$;
revoke all on function public.restore_deleted_company(uuid) from public, anon;
grant execute on function public.restore_deleted_company(uuid) to authenticated;

create or replace function public.company_versions(p_company uuid)
returns table(revision bigint,recorded_at timestamptz,actor_id uuid,operation text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.can_manage(p_company) and public.can_read_all(p_company)) then raise exception 'Solo administradores pueden consultar el historial'; end if;
  return query select v.revision,v.recorded_at,v.actor_id,v.operation from planilla_private.company_versions v
    where v.company_id=p_company order by v.revision desc limit 100;
end $$;
revoke all on function public.company_versions(uuid) from public, anon;
grant execute on function public.company_versions(uuid) to authenticated;

create or replace function public.company_version(p_company uuid,p_revision bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.can_manage(p_company) and public.can_read_all(p_company)) then raise exception 'Solo administradores pueden consultar el historial'; end if;
  return (select v.snapshot->'data' from planilla_private.company_versions v where v.company_id=p_company and v.revision=p_revision);
end $$;
revoke all on function public.company_version(uuid,bigint) from public, anon;
grant execute on function public.company_version(uuid,bigint) to authenticated;
