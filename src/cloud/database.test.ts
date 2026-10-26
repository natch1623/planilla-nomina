import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"
import { defaultData } from "../store"

const OWNER = "10000000-0000-4000-8000-000000000001"
const OTHER = "10000000-0000-4000-8000-000000000002"
const COMPANY = "20000000-0000-4000-8000-000000000001"
const db = new PGlite()
const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
const document = { ...defaultData, companyName: "Prueba", openingBalance: 1250,
  employees: [{ id: "e1", name: "Sintético" }],
  timeEntries: [{ id: "t1", employeeId: "e1", date: "2026-10-01" }],
}

beforeAll(async () => {
  await db.exec(source("supabase/tests/bootstrap.sql"))
  await db.exec(source("supabase/schema.sql").split("-- BEGIN DATA INTEGRITY MIGRATION")[0])
  await db.exec("grant select,insert,update,delete,truncate,references,trigger on all tables in schema public to authenticated")
  await db.query("insert into auth.users values ($1,'owner@example.invalid'),($2,'other@example.invalid')", [OWNER, OTHER])
  await db.query("insert into public.companies(id,name,data) values($1,'Prueba',$2::jsonb)", [COMPANY, JSON.stringify(document)])
  await db.query("insert into public.company_members(company_id,user_id,role) values($1,$2,'owner')", [COMPANY, OWNER])
  await db.exec(source("supabase/migrations/20261022143152_data_integrity.sql"))
}, 30000)
afterAll(async () => { await db.close() })

async function asUser<T>(id: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec("set role authenticated")
  try { return await fn() } finally { await db.exec("reset role") }
}

describe("protección de datos en PostgreSQL", () => {
  it("el instalador incluye exactamente la migración actual", () => {
    expect(source("supabase/schema.sql").replace(/\r\n/g,"\n").trim().endsWith(source("supabase/migrations/20261022143152_data_integrity.sql").replace(/\r\n/g,"\n").trim())).toBe(true)
  })
  it("migra sin alterar el documento ni su revisión", async () => {
    const { rows } = await db.query<{ data: typeof document; revision: number }>("select data,revision from public.companies where id=$1", [COMPANY])
    expect(rows[0].data).toEqual(document)
    expect(Number(rows[0].revision)).toBe(1)
    expect((await db.query("select * from planilla_private.company_versions")).rows).toHaveLength(1)
  })
  it("el guardado legítimo de 1250 a 1500 conserva ambas versiones", async () => {
    await asUser(OWNER, () => db.query("update public.companies set data=jsonb_set(data,'{openingBalance}','1500') where id=$1 and revision=1", [COMPANY]))
    const { rows } = await db.query<{ snapshot: any }>("select snapshot from planilla_private.company_versions order by revision")
    expect(rows.map(r => r.snapshot.data.openingBalance)).toEqual([1250,1500])
  })
  it("bloquea documentos incompletos conservando los datos anteriores", async () => {
    await expect(asUser(OWNER, () => db.query("update public.companies set data='{}' where id=$1", [COMPANY]))).rejects.toThrow("lista")
    await expect(asUser(OWNER, () => db.query("update public.companies set data=jsonb_set(data,'{timeEntries}','null') where id=$1", [COMPANY]))).rejects.toThrow("lista")
    expect((await db.query<any>("select data from public.companies")).rows[0].data.openingBalance).toBe(1500)
  })
  it("un usuario ajeno no lee ni modifica la empresa o su historial", async () => {
    expect((await asUser(OTHER, () => db.query("select * from public.companies"))).rows).toHaveLength(0)
    expect((await asUser(OTHER, () => db.query("update public.companies set name='intruso' returning id"))).rows).toHaveLength(0)
    await expect(asUser(OTHER, () => db.query("select * from public.company_versions($1)", [COMPANY]))).rejects.toThrow("administradores")
    await expect(asUser(OTHER, () => db.query("select * from planilla_private.company_versions"))).rejects.toThrow("permission denied")
  })
  it("TRUNCATE ya no está concedido a authenticated", async () => {
    const { rows } = await db.query<any>("select has_table_privilege('authenticated','public.companies','TRUNCATE') as allowed")
    expect(rows[0].allowed).toBe(false)
  })
  it("sube y lee comprobantes nuevos, pero no reemplaza ni borra objetos históricos", async () => {
    await db.exec("grant select,insert,update,delete on storage.objects to authenticated")
    const path = `${COMPANY}/incapacidades/historico.png`
    await asUser(OWNER, () => db.query("insert into storage.objects(bucket_id,name) values('adjuntos',$1)", [path]))
    expect((await asUser(OWNER, () => db.query("select * from storage.objects where name=$1", [path]))).rows).toHaveLength(1)
    expect((await asUser(OWNER, () => db.query("delete from storage.objects where name=$1 returning id", [path]))).rows).toHaveLength(0)
    expect((await asUser(OWNER, () => db.query("update storage.objects set name='reemplazado' where name=$1 returning id", [path]))).rows).toHaveLength(0)
    expect((await db.query("select * from storage.objects where name=$1", [path])).rows).toHaveLength(1)
  })
  it("el historial no admite modificaciones ni borrados", async () => {
    await expect(db.query("update planilla_private.company_versions set operation='delete'")).rejects.toThrow("inmutable")
    await expect(db.query("delete from planilla_private.company_versions")).rejects.toThrow("inmutable")
  })
  it("el administrador descarga la revisión 1 de 1250 desde el historial", async () => {
    const versions = (await asUser(OWNER, () => db.query("select * from public.company_versions($1)", [COMPANY]))).rows
    expect(versions.length).toBeGreaterThan(0)
    const { rows } = await asUser(OWNER, () => db.query<any>("select public.company_version($1,1) as data", [COMPANY]))
    expect(rows[0].data.openingBalance).toBe(1250)
  })
  it("permite borrar el último registro legítimo y conserva su versión anterior", async () => {
    const id = "20000000-0000-4000-8000-000000000099"
    await db.query("insert into public.companies(id,data) values($1,$2::jsonb)", [id, JSON.stringify({ ...defaultData, employees: [{ id: "e2", name: "Último" }] })])
    await db.query("insert into public.company_members(company_id,user_id,role) values($1,$2,'owner')", [id,OWNER])
    await asUser(OWNER, () => db.query("update public.companies set data=$2::jsonb where id=$1", [id,JSON.stringify(defaultData)]))
    const rows = (await db.query<any>("select snapshot from planilla_private.company_versions where company_id=$1 order by revision", [id])).rows
    expect(rows.map(r => r.snapshot.data.employees.length)).toEqual([1,0])
    // Aislar el resto de las comprobaciones de permisos/listado.
    await asUser(OWNER, () => db.query("select public.delete_company($1)", [id]))
  })
  it("el borrado es lógico, conserva datos y miembros y permite recuperación", async () => {
    await asUser(OWNER, () => db.query("select public.delete_company($1)", [COMPANY]))
    expect((await asUser(OWNER, () => db.query("select * from public.my_companies()"))).rows).toHaveLength(0)
    const row = (await db.query<any>("select data,deleted_at from public.companies where id=$1", [COMPANY])).rows[0]
    expect(row.data.openingBalance).toBe(1500)
    expect(row.deleted_at).not.toBeNull()
    expect((await db.query("select * from public.company_members where company_id=$1", [COMPANY])).rows).toHaveLength(1)
    await expect(asUser(OTHER, () => db.query("select public.restore_deleted_company($1)", [COMPANY]))).rejects.toThrow("permiso")
    await asUser(OWNER, () => db.query("select public.restore_deleted_company($1)", [COMPANY]))
    expect((await asUser(OWNER, () => db.query("select * from public.my_companies()"))).rows).toHaveLength(1)
  })
  it("protege cierres también en UPDATE completo y conserva la reapertura", async () => {
    const closure = { key: "2026-10-1", period: { year: 2026, month: 10, half: 1 }, closedAt: "2026-10-16T12:00:00Z", summaries: [{ netSalary: 400.49 }] }
    const current = (await db.query<any>("select data from public.companies where id=$1", [COMPANY])).rows[0].data
    const closed = { ...current, closedPeriods: [closure] }
    await asUser(OWNER, () => db.query("update public.companies set data=$2::jsonb where id=$1", [COMPANY, JSON.stringify(closed)]))
    // El normalizador legacy puede completar esos campos sin alterar montos.
    const normalized = { ...closure, summaries: [{ netSalary: 400.49, totalPay: 400.49, manualAdjustment: 0 }] }
    await asUser(OWNER, () => db.query("update public.companies set data=jsonb_set(data,'{closedPeriods}',$2::jsonb) where id=$1", [COMPANY,JSON.stringify([normalized])]))
    await expect(asUser(OWNER, () => db.query("update public.companies set data=jsonb_set(data,'{closedPeriods}','[]') where id=$1", [COMPANY]))).rejects.toThrow("historial")
    await expect(asUser(OWNER, () => db.query("update public.companies set data=jsonb_set(data,'{timeEntries}','[]') where id=$1", [COMPANY]))).rejects.toThrow("cerrada")
    const reopened = { ...closed, closedPeriods: [], payrollArchives: [normalized] }
    await asUser(OWNER, () => db.query("update public.companies set data=$2::jsonb where id=$1", [COMPANY, JSON.stringify(reopened)]))
    await expect(asUser(OWNER, () => db.query("update public.companies set data=jsonb_set(data,'{payrollArchives}','[]') where id=$1", [COMPANY]))).rejects.toThrow("historial")
  })
  it("reabrir y recerrar offline conserva las dos versiones", async () => {
    const before = (await db.query<any>("select data from public.companies where id=$1", [COMPANY])).rows[0].data
    const first = { id: "closure-a", key: "2026-10-1", revision: 1, period: { year: 2026, month: 10, half: 1 }, closedAt: "2026-10-16T12:00:00Z", summaries: [] }
    await asUser(OWNER, () => db.query("update public.companies set data=$2::jsonb where id=$1", [COMPANY,JSON.stringify({ ...before, closedPeriods: [first] })]))
    const next = { ...before, timeEntries: [], closedPeriods: [{ ...first, id: "closure-b", revision: 2, supersedes: first.id }], payrollArchives: [...before.payrollArchives,first] }
    await asUser(OWNER, () => db.query("update public.companies set data=$2::jsonb where id=$1", [COMPANY,JSON.stringify(next)]))
    const after = (await db.query<any>("select data from public.companies where id=$1", [COMPANY])).rows[0].data
    expect(after.payrollArchives).toContainEqual(first)
    expect(after.closedPeriods[0].id).toBe("closure-b")
  })
  it("reejecutar el instalador no expone empresas borradas ni concede TRUNCATE", async () => {
    await db.exec(source("supabase/schema.sql"))
    expect((await asUser(OWNER, () => db.query("select * from public.my_companies()"))).rows).toHaveLength(1)
    expect((await db.query<any>("select has_table_privilege('authenticated','public.companies','TRUNCATE') as allowed")).rows[0].allowed).toBe(false)
  })
})
