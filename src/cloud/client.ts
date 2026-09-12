import { createClient } from "@supabase/supabase-js"
import type { Session, SupabaseClient } from "@supabase/supabase-js"
import type { AppData } from "../types"
import { isSection } from "./sections"
import type { Section } from "./sections"

/**
 * Acceso a Supabase. Las credenciales salen de variables de entorno del build
 * (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); si faltan, la nube no existe
 * para la app y todo funciona exactamente como la versión solo-local.
 *
 * La anon key es pública por diseño: lo que protege los datos son las
 * políticas RLS de `supabase/schema.sql`, que exigen sesión iniciada y
 * membresía en la empresa.
 */

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ""
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ""

export const cloudAvailable = Boolean(URL && KEY)

let client: SupabaseClient | null = null

function sb(): SupabaseClient {
  if (!cloudAvailable) throw new Error("La nube no está configurada")
  if (!client) {
    client = createClient(URL, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "planilla_auth" },
    })
  }
  return client
}

/**
 * Nombre de un rango. Los de fábrica son owner, editor, viewer, asistencia y
 * costos, pero la tabla `roles` admite más: no es una lista cerrada.
 */
export type CompanyRole = string

/** Qué permite el rango de uno en una empresa (fila de `roles`). */
export interface RoleAccess {
  role: CompanyRole
  label: string
  readsAll: boolean
  writesAll: boolean
  managesMembers: boolean
  sections: Section[]
}

export interface RoleDef extends RoleAccess {
  description: string
}

function toAccess(r: any): RoleAccess {
  return {
    role: String(r.role),
    label: String(r.role_label ?? r.label ?? r.role),
    readsAll: r.reads_all === true,
    writesAll: r.writes_all === true,
    managesMembers: r.manages_members === true,
    sections: (Array.isArray(r.sections) ? r.sections : []).filter(isSection),
  }
}

/** ¿Puede este rango cambiar algo en la nube? */
export function canWrite(access: RoleAccess | null): boolean {
  return !!access && (access.writesAll || access.sections.length > 0)
}

/**
 * Las cuentas se crean en Supabase como `usuario@planilla.local`: Auth exige
 * un correo, pero nadie tiene que escribirlo ni recibirlo. Quien entra escribe
 * solo "douglas"; un correo completo también se acepta tal cual.
 */
export const USERNAME_DOMAIN = "planilla.local"

export function toLoginEmail(user: string): string {
  const clean = user.trim().toLowerCase()
  return clean.includes("@") ? clean : `${clean}@${USERNAME_DOMAIN}`
}

/** Cómo se muestra una cuenta: el usuario a secas si es de las internas. */
export function displayUser(email: string | null | undefined): string {
  if (!email) return ""
  const suffix = `@${USERNAME_DOMAIN}`
  return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : email
}

export interface CloudCompany {
  id: string
  name: string
  revision: number
  updatedAt: string
  updatedByEmail: string
  access: RoleAccess
}

export interface CloudSnapshot {
  data: AppData
  revision: number
  updatedAt: string
  updatedByEmail: string
}

export interface CompanyMember {
  userId: string
  email: string
  role: CompanyRole
}

/** Traduce los errores más comunes de Supabase a algo que se entienda. */
function message(err: unknown): string {
  const raw = (err as any)?.message ? String((err as any).message) : String(err)
  if (/invalid login credentials/i.test(raw)) return "Usuario o contraseña incorrectos."
  if (/email not confirmed/i.test(raw)) return "El correo todavía no está confirmado."
  if (/failed to fetch|network/i.test(raw)) return "Sin conexión con la nube."
  if (/jwt expired/i.test(raw)) return "La sesión venció. Vuelve a iniciar sesión."
  return raw
}

export class CloudError extends Error {}

function fail(err: unknown): never {
  throw new CloudError(message(err))
}

/* ------------------------------ Sesión ------------------------------- */

export async function getSession(): Promise<Session | null> {
  const { data } = await sb().auth.getSession()
  return data.session
}

export function onSessionChange(cb: (session: Session | null) => void): () => void {
  const { data } = sb().auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await sb().auth.signInWithPassword({ email: toLoginEmail(email), password })
  if (error) fail(error)
}

export async function signOut(): Promise<void> {
  const { error } = await sb().auth.signOut()
  if (error) fail(error)
}

export async function changePassword(password: string): Promise<void> {
  const { error } = await sb().auth.updateUser({ password })
  if (error) fail(error)
}

/* ----------------------------- Empresas ------------------------------ */

/**
 * Empresas donde el usuario es miembro. No trae `data`: puede pesar mucho, y
 * el rol costos no debe recibirlo nunca. Va por función porque ese rol no
 * puede leer la tabla directamente.
 */
export async function listCompanies(): Promise<CloudCompany[]> {
  const { data, error } = await sb().rpc("my_companies")
  if (error) fail(error)
  return (data ?? [])
    .map((c: any) => ({
      id: c.id,
      name: c.name ?? "",
      revision: Number(c.revision),
      updatedAt: c.updated_at,
      updatedByEmail: c.updated_by_email ?? "",
      access: toAccess(c),
    }))
    .sort((a: CloudCompany, b: CloudCompany) => a.name.localeCompare(b.name, "es"))
}

export async function fetchCompany(id: string): Promise<CloudSnapshot> {
  const { data, error } = await sb()
    .from("companies")
    .select("data, revision, updated_at, updated_by_email")
    .eq("id", id)
    .single()
  if (error) fail(error)
  return {
    data: data.data as AppData,
    revision: Number(data.revision),
    updatedAt: data.updated_at,
    updatedByEmail: data.updated_by_email ?? "",
  }
}

/** Solo la revisión: para saber si hay algo nuevo sin bajar todo el JSON. */
export async function fetchRevision(id: string): Promise<number> {
  const { data, error } = await sb().rpc("company_revision", { p_company: id })
  if (error) fail(error)
  if (data === null || data === undefined) fail("No tienes acceso a esta empresa.")
  return Number(data)
}

export async function createCompany(
  name: string,
  data: AppData,
): Promise<{ id: string; revision: number }> {
  const { data: rows, error } = await sb().rpc("create_company", { p_name: name, p_data: data })
  if (error) fail(error)
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row) fail("La nube no devolvió la empresa creada.")
  return { id: row.id, revision: Number(row.revision) }
}

export type SaveResult =
  | { ok: true; revision: number }
  /** Otra persona guardó después de la revisión que teníamos. */
  | { ok: false; conflict: true }

/**
 * Guarda solo si la nube sigue en `expectedRevision`. Si no cambió ninguna
 * fila es porque alguien guardó antes (o se perdió el permiso de edición, que
 * RLS también presenta como "cero filas"; se distingue releyendo).
 */
export async function saveCompany(
  id: string,
  name: string,
  data: AppData,
  expectedRevision: number,
): Promise<SaveResult> {
  const { data: rows, error } = await sb()
    .from("companies")
    .update({ name, data })
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select("revision")
  if (error) fail(error)
  if (rows && rows.length > 0) return { ok: true, revision: Number(rows[0].revision) }

  const current = await fetchRevision(id).catch(() => null)
  if (current !== null && current !== expectedRevision) return { ok: false, conflict: true }
  fail("No tienes permiso para modificar esta empresa.")
}

export async function deleteCompany(id: string): Promise<void> {
  const { error } = await sb().from("companies").delete().eq("id", id)
  if (error) fail(error)
}

/**
 * Aviso en vivo cuando alguien guarda. Solo se usa la revisión del aviso: el
 * JSON completo puede no venir si es grande, así que se baja aparte.
 */
export function subscribeCompany(id: string, onRevision: (revision: number) => void): () => void {
  const channel = sb()
    .channel(`company:${id}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "companies", filter: `id=eq.${id}` },
      (payload: any) => {
        const rev = Number(payload?.new?.revision)
        if (Number.isFinite(rev)) onRevision(rev)
      },
    )
    .subscribe()
  return () => {
    void sb().removeChannel(channel)
  }
}

/* ----------------------------- Secciones ----------------------------- */

/**
 * Lo único que reciben los rangos sin acceso completo: los campos de una
 * sección (p. ej. colaboradores sin salarios y el registro diario). El resto
 * de la empresa nunca sale del servidor.
 */
export async function fetchSection(
  companyId: string,
  section: Section,
): Promise<{ payload: Record<string, unknown>; revision: number; updatedAt: string; updatedByEmail: string }> {
  const { data, error } = await sb().rpc("get_company_section", { p_company: companyId, p_section: section })
  if (error) fail(error)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) fail("No tienes acceso a esta empresa.")
  return {
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    updatedByEmail: row.updated_by_email ?? "",
  }
}

export async function saveSection(
  companyId: string,
  section: Section,
  payload: Record<string, unknown>,
  expectedRevision: number,
): Promise<SaveResult> {
  const { data, error } = await sb().rpc("save_company_section", {
    p_company: companyId,
    p_section: section,
    p_payload: payload,
    p_expected_revision: expectedRevision,
  })
  if (error) fail(error)
  if (data === null || data === undefined) return { ok: false, conflict: true }
  return { ok: true, revision: Number(data) }
}

/** Rangos disponibles, para el selector al agregar personas. */
export async function listRoles(): Promise<RoleDef[]> {
  const { data, error } = await sb()
    .from("roles")
    .select("role, label, description, reads_all, writes_all, manages_members, sections, sort")
    .order("sort")
  if (error) fail(error)
  return (data ?? []).map((r: any) => ({ ...toAccess(r), description: r.description ?? "" }))
}

/* ---------------------------- Archivos ------------------------------- */

const BUCKET = "adjuntos"

export async function uploadFile(path: string, file: File): Promise<void> {
  const { error } = await sb().storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  })
  if (error) fail(error)
}

/** El bucket es privado: cada vista necesita un enlace firmado y temporal. */
export async function signedUrl(path: string, seconds: number): Promise<string> {
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, seconds)
  if (error) fail(error)
  return data?.signedUrl ?? ""
}

export async function removeFile(path: string): Promise<void> {
  const { error } = await sb().storage.from(BUCKET).remove([path])
  if (error) fail(error)
}

/* ----------------------------- Miembros ------------------------------ */

export async function listMembers(companyId: string): Promise<CompanyMember[]> {
  const { data, error } = await sb().rpc("list_company_members", { p_company: companyId })
  if (error) fail(error)
  return (data ?? []).map((r: any) => ({ userId: r.user_id, email: r.email, role: r.role }))
}

export async function addMember(companyId: string, user: string, role: CompanyRole): Promise<void> {
  const { error } = await sb().rpc("add_company_member", {
    p_company: companyId,
    p_email: toLoginEmail(user),
    p_role: role,
  })
  if (error) fail(error)
}

export async function removeMember(companyId: string, userId: string): Promise<void> {
  const { error } = await sb().rpc("remove_company_member", { p_company: companyId, p_user: userId })
  if (error) fail(error)
}
