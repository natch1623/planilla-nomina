import type { CostEntry, CostTemplate } from "../types"
import { monthKey } from "./accounting"

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
 * Suma de los pagos a terceros registrados en caja en un mes calendario
 * dado. Los cobros de caja no entran: esto alimenta "Costos a terceros".
 */
export function costsMonthTotal(costs: CostEntry[], key: string): number {
  return costs
    .filter((c) => c.kind === "pago" && monthKey(c.date) === key)
    .reduce((a, c) => a + c.amount, 0)
}

/** Efecto de un movimiento sobre el efectivo en caja: + si es cobro, − si es pago. */
export function signedAmount(c: CostEntry): number {
  return c.kind === "cobro" ? c.amount : -c.amount
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
