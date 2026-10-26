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
