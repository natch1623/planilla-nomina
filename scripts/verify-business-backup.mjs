/** Verifica una copia de negocio en PostgreSQL aislado; no conecta con Supabase. */
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { PGlite } from "@electric-sql/pglite"

const path = process.argv[2]
if (!path) throw new Error("Uso: node scripts/verify-business-backup.mjs <respaldo-negocio.json>")
const bytes = await readFile(path)
const backup = JSON.parse(bytes.toString("utf8"))
if (backup.format !== "planilla-business-backup-v1") throw new Error("Formato desconocido")
const db = new PGlite()
const sql = name => readFile(new URL(`../supabase/${name}`, import.meta.url), "utf8")
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
  return JSON.stringify(v)
}
try {
  await db.exec(await sql("tests/bootstrap.sql"))
  await db.exec((await sql("schema.sql")).split("-- BEGIN DATA INTEGRITY MIGRATION")[0])
  const userIds = new Set(backup.tables.company_members.map(m => m.user_id))
  for (const c of backup.tables.companies) for (const field of ["created_by", "updated_by"]) if (c[field]) userIds.add(c[field])
  for (const id of userIds) await db.query("insert into auth.users(id,email) values($1,'restauracion@example.invalid')", [id])
  for (const r of backup.tables.roles) await db.query("insert into public.roles(role,label,description,reads_all,writes_all,manages_members,sections,sort) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(role) do update set label=excluded.label,description=excluded.description,reads_all=excluded.reads_all,writes_all=excluded.writes_all,manages_members=excluded.manages_members,sections=excluded.sections,sort=excluded.sort", [r.role,r.label,r.description,r.reads_all,r.writes_all,r.manages_members,r.sections,r.sort])
  for (const c of backup.tables.companies) await db.query("insert into public.companies(id,name,data,revision,updated_at,updated_by,updated_by_email,created_by,created_at) values($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)", [c.id,c.name,JSON.stringify(c.data),c.revision,c.updated_at,c.updated_by,c.updated_by_email,c.created_by,c.created_at])
  for (const m of backup.tables.company_members) await db.query("insert into public.company_members(company_id,user_id,role,created_at) values($1,$2,$3,$4)", [m.company_id,m.user_id,m.role,m.created_at])
  for (const table of ["companies", "company_members", "roles"]) {
    const restored = (await db.query(`select to_jsonb(t) as row from public.${table} t`)).rows.map(r => r.row)
    const expected = backup.tables[table]
    const stable = rows => rows.map(canonical).sort()
    if (canonical(stable(restored)) !== canonical(stable(expected))) throw new Error(`No se restauraron todos los campos de ${table}`)
  }
  for (const fn of backup.functions) await db.exec(fn)
  await db.exec(await sql("migrations/20261022143152_data_integrity.sql"))
  const rows = (await db.query("select id,data,revision from public.companies order by id")).rows
  for (const c of backup.tables.companies) {
    const restored = rows.find(r => r.id === c.id)
    if (!restored || canonical(restored.data) !== canonical(c.data) || Number(restored.revision) !== Number(c.revision)) throw new Error("La migración alteró el documento o su revisión")
  }
  // Comprueba también que la versión nueva abre todos los registros sin filtrarlos.
  const { createServer } = await import("vite")
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } })
  try {
    const { decodeStoredData } = await vite.ssrLoadModule("/src/store.ts")
    for (const c of backup.tables.companies) decodeStoredData(JSON.stringify(c.data))
  } finally { await vite.close() }
  // Preflight de todos los documentos reales sin escribir en la base remota.
  await db.exec("update public.companies set data=data")
  console.log(JSON.stringify({ verified: true, sha256: createHash("sha256").update(bytes).digest("hex"), companies: rows.length, members: backup.tables.company_members.length, roles: backup.tables.roles.length, revisions_before_migration: rows.map(r => Number(r.revision)), storage_objects: backup.storage_object_count, scope: "Datos públicos de negocio y esquema. No incluye cuentas Auth, credenciales ni archivos Storage." }, null, 2))
} finally { await db.close() }
