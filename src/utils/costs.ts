import type { CostEntry, CostTemplate } from "../types"
import { monthKey } from "./accounting"

/** Consultas comunes sugeridas; el usuario puede escribir cualquier otra. */
export const DEFAULT_COST_CONCEPTS = [
  "Materiales",
  "Mantenimiento",
  "Transporte",
  "Trámite",
  "Servicios profesionales",
  "Consultoría",
  "Suministros de oficina",
  "Otros",
]

/**
 * Sugerencias para "a quién se le pagó": nombres ya guardados como plantilla
 * más cualquier beneficiario que aparezca en pagos anteriores, aunque nunca
 * se haya guardado como plantilla. Igual que con los cargos de colaboradores,
 * no hace falta una pantalla aparte para "definir" un beneficiario — basta
 * con haberlo escrito una vez.
 */
export function recipientOptions(
  costs: CostEntry[],
  templates: CostTemplate[],
): string[] {
  const names = [
    ...templates.map((t) => t.recipientName),
    ...costs.map((c) => c.recipientName),
  ]
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "es"))
}

/**
 * Sugerencias para "consulta": la lista predefinida más cualquier consulta
 * que ya se haya usado en un pago anterior.
 */
export function conceptOptions(costs: CostEntry[]): string[] {
  const custom = costs.map((c) => c.concept.trim()).filter((c) => c.length > 0)
  const set = new Set([...DEFAULT_COST_CONCEPTS, ...custom])
  return [...set].sort((a, b) => a.localeCompare(b, "es"))
}

/** Suma de los pagos a terceros registrados en un mes calendario dado. */
export function costsMonthTotal(costs: CostEntry[], key: string): number {
  return costs
    .filter((c) => monthKey(c.date) === key)
    .reduce((a, c) => a + c.amount, 0)
}

/**
 * Huella SHA-256 del PIN de una encargada, en hexadecimal.
 *
 * El PIN no se guarda en claro: con `costOperators` sincronizando entre
 * varias estaciones (ver memoria del proyecto), cualquier computadora con
 * acceso a Costos vería los PIN de todas las encargadas en localStorage si
 * se guardaran tal cual — y ese PIN es justo lo que da veracidad a
 * `processedBy`. Se compara la huella, nunca el valor original.
 */
export async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
