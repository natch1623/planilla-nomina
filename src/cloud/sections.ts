import type { AppData } from "../types"

/**
 * Secciones: partes acotadas de una empresa que un rango puede ver y editar
 * sin recibir el resto. Tienen que coincidir con `section_payload` y
 * `save_company_section` de `supabase/schema.sql`, que es donde de verdad se
 * decide qué viaja; aquí solo se arma y se aplica.
 */
export type Section = "asistencia" | "costos"

export interface SectionDef {
  /** Pestaña de la app que abre esta sección. */
  tab: string
  /** Campos de AppData que llegan en la sección. */
  reads: string[]
  /** Campos que se envían al guardar (subconjunto de `reads`). */
  writes: string[]
}

export const SECTIONS: Record<Section, SectionDef> = {
  asistencia: {
    tab: "registro",
    reads: [
      "companyName",
      "employees",
      "timeEntries",
      "closedPeriods",
      "overtimeThreshold",
      "standardDayHours",
      "holidayRate",
      "payVacations",
      "payHolidays",
      "paySickLeave",
    ],
    writes: ["timeEntries"],
  },
  costos: {
    tab: "costos",
    reads: ["companyName", "costs", "costTemplates"],
    writes: ["costs", "costTemplates"],
  },
}

export function isSection(value: unknown): value is Section {
  return typeof value === "string" && value in SECTIONS
}

/** Lo que se sube al guardar una sección: solo sus campos editables. */
export function sectionPayload(section: Section, data: AppData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of SECTIONS[section].writes) out[k] = (data as any)[k]
  return out
}

/**
 * Aplica sobre `base` lo que llegó de la nube para una sección. Solo toca
 * los campos que la sección declara: si el servidor mandara algo más, se
 * ignora.
 */
export function applySection(base: AppData, section: Section, payload: Record<string, unknown>): AppData {
  const out: any = { ...base }
  for (const k of SECTIONS[section].reads) {
    if (payload[k] !== undefined && payload[k] !== null) out[k] = payload[k]
  }
  if (typeof payload.version === "number") out.version = payload.version
  return out
}
