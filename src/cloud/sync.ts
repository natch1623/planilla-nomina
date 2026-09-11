import type { AppData } from "../types"

/**
 * Reglas de sincronización con la nube, separadas de React y de Supabase para
 * poder probarlas sin red.
 *
 * Modelo: cada empresa es un único JSON (`AppData`) con un número de revisión
 * que el servidor sube en cada guardado. El cliente guarda "si la revisión
 * sigue siendo la que conozco"; si no, otra persona guardó antes y hay que
 * decidir qué hacer en vez de pisarla.
 */

/**
 * Campos que son preferencia de quien mira, no datos de la empresa. Si
 * viajaran a la nube, pasar a otra quincena o cambiar el tema le movería la
 * pantalla a todos los demás.
 */
export const LOCAL_ONLY_FIELDS = ["currentPeriod", "theme"] as const satisfies readonly (keyof AppData)[]

/**
 * ¿El cambio de `prev` a `next` tocó solo preferencias locales?
 *
 * Compara por referencia campo a campo: el estado se actualiza de forma
 * inmutable, así que un campo que no cambió conserva su objeto. Es barato
 * incluso con adjuntos en base64, que un JSON.stringify no lo sería.
 */
export function onlyLocalFieldsChanged(prev: AppData, next: AppData): boolean {
  if (prev === next) return true
  const local = new Set<string>(LOCAL_ONLY_FIELDS)
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const k of keys) {
    if (local.has(k)) continue
    if ((prev as any)[k] !== (next as any)[k]) return false
  }
  return true
}

/** Datos remotos con las preferencias locales de quien los recibe. */
export function withLocalFields(remote: AppData, local: AppData): AppData {
  const out: AppData = { ...remote }
  for (const k of LOCAL_ONLY_FIELDS) (out as any)[k] = local[k]
  return out
}

export type RemoteDecision =
  /** Ya la tenemos (o es más vieja): nada que hacer. */
  | "ignore"
  /** Hay versión nueva y aquí no hay cambios sin subir: se toma sin preguntar. */
  | "apply"
  /** Versión nueva allá y cambios sin subir aquí: hay que preguntar. */
  | "conflict"

export function decideRemote(
  local: { revision: number; dirty: boolean },
  remoteRevision: number,
): RemoteDecision {
  if (remoteRevision <= local.revision) return "ignore"
  return local.dirty ? "conflict" : "apply"
}

/**
 * Un cliente viejo (pestaña abierta antes de un despliegue) no debe escribir
 * sobre datos de una versión más nueva: `normalizeData` descartaría los campos
 * que no conoce y al guardar los borraría para todos.
 */
export function isFromNewerApp(remote: { version?: unknown }, appVersion: number): boolean {
  return typeof remote.version === "number" && remote.version > appVersion
}

/* --------------------------------------------------------------------- */
/* Vínculos perfil local ↔ empresa en la nube                              */
/* --------------------------------------------------------------------- */

/**
 * Qué perfil local corresponde a qué empresa de la nube, y en qué revisión
 * quedó. Vive en su propia clave y no dentro del índice de perfiles para no
 * tocar el formato que ya usa la versión solo-local.
 */
export interface CloudLink {
  companyId: string
  /** Última revisión de la nube que este equipo tiene aplicada. */
  revision: number
  /** Hay cambios locales que todavía no llegaron a la nube. */
  dirty: boolean
}

export type CloudLinks = Record<string, CloudLink>

const LINKS_KEY = "planilla_cloud_links"

export function readLinks(): CloudLinks {
  try {
    const raw = localStorage.getItem(LINKS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: CloudLinks = {}
    for (const [profileId, v] of Object.entries<any>(parsed)) {
      if (v && typeof v.companyId === "string" && v.companyId) {
        out[profileId] = {
          companyId: v.companyId,
          revision: Number.isFinite(v.revision) ? v.revision : 0,
          dirty: v.dirty === true,
        }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function writeLinks(links: CloudLinks): void {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(links))
  } catch (err) {
    console.error("No se pudo guardar el vínculo con la nube", err)
  }
}

/** Perfil local que ya está vinculado a esa empresa, si lo hay. */
export function profileForCompany(links: CloudLinks, companyId: string): string | null {
  for (const [profileId, link] of Object.entries(links)) {
    if (link.companyId === companyId) return profileId
  }
  return null
}
