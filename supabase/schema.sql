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
