import type { Employee } from "../types"

/** Cargos comunes sugeridos al agregar un colaborador; el usuario puede escribir cualquier otro. */
export const DEFAULT_POSITIONS = [
  "Administrativo",
  "Asistente",
  "Ayudante",
  "Chofer",
  "Contador(a)",
  "Gerente",
  "Mensajero",
  "Operario",
  "Recepcionista",
  "Supervisor",
  "Técnico",
  "Vendedor",
  "Vigilante",
]

/**
 * Sugerencias para el campo de cargo: la lista predefinida más cualquier
 * cargo que el usuario ya haya escrito en otros colaboradores. Así "definir
 * un cargo" no exige una pantalla aparte — basta con escribirlo una vez.
 */
export function positionOptions(employees: Employee[]): string[] {
  const custom = employees
    .map((e) => e.position.trim())
    .filter((p) => p.length > 0)
  const set = new Set([...DEFAULT_POSITIONS, ...custom])
  return [...set].sort((a, b) => a.localeCompare(b, "es"))
}
