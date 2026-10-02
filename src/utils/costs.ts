import type { CostEntry, CostTemplate } from "../types"
import { monthKey } from "./accounting"

/**
 * Sugerencias para "a quién se le pagó": nombres ya guardados como plantilla
 * más cualquier beneficiario que aparezca en pagos anteriores. Los nombres
 * eliminados del autocompletado se ocultan sin alterar esos movimientos.
 */
export function recipientOptions(
  costs: CostEntry[],
  templates: CostTemplate[],
): string[] {
  const hidden = new Set(
    templates.filter((t) => t.hidden).map((t) => recipientKey(t.recipientName)),
  )
  const names = [
    ...templates.filter((t) => !t.hidden).map((t) => t.recipientName),
    ...costs.map((c) => c.recipientName),
  ]
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && !hidden.has(recipientKey(n)))
  const unique = new Map<string, string>()
  for (const name of names) {
    if (!unique.has(recipientKey(name))) unique.set(recipientKey(name), name)
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, "es"))
}

function recipientKey(name: string): string {
  return name.trim().toLocaleLowerCase("es")
}

export function saveRecipientTemplate(
  templates: CostTemplate[],
  draft: Pick<CostTemplate, "recipientName" | "taxId">,
): CostTemplate[] {
  const recipientName = draft.recipientName.trim()
  if (!recipientName) return templates
  const key = recipientKey(recipientName)
  const existing = templates.find((t) => recipientKey(t.recipientName) === key)
  const saved: CostTemplate = {
    id: existing?.id ?? crypto.randomUUID(),
    recipientName,
    taxId: draft.taxId.trim(),
  }
  return [...templates.filter((t) => recipientKey(t.recipientName) !== key), saved]
}

export function removeRecipientSuggestion(
  templates: CostTemplate[],
  name: string,
): CostTemplate[] {
  const key = recipientKey(name)
  const existing = templates.find((t) => recipientKey(t.recipientName) === key)
  // Conserva la exclusión para que el historial no vuelva a sugerir el nombre.
  return [
    ...templates.filter((t) => recipientKey(t.recipientName) !== key),
    { id: existing?.id ?? crypto.randomUUID(), recipientName: name.trim(), taxId: "", hidden: true },
  ]
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
