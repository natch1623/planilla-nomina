import type { CostCashCount, CostEntry } from "../types"
import { addDays, dayNameLong, formatDate, localDay, weekdayIndex } from "./dates"

/**
 * Períodos para exportar Caja. Todos salvo el rango manual se calculan a
 * partir de una fecha de referencia: el período es el que la contiene.
 */
export type CajaPeriodKind =
  | "dia"
  | "semana"
  | "quincena"
  | "mes"
  | "anio"
  | "rango"

export interface CajaPeriod {
  kind: CajaPeriodKind
  /** Primer día, `YYYY-MM-DD`, incluido. */
  start: string
  /** Último día, `YYYY-MM-DD`, incluido. */
  end: string
  /** Nombre corto para la pantalla, p. ej. "1.ª quincena de octubre 2026". */
  title: string
  /** Nombre con las fechas, para el archivo o la impresión. */
  label: string
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
]

const pad = (n: number) => String(n).padStart(2, "0")

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parts(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number)
  return { year, month, day }
}

/**
 * "12 al 18 oct 2026", "28 sep al 4 oct 2026" o, entre años,
 * "29 dic 2025 al 4 ene 2026": sin repetir lo que comparten las dos fechas.
 */
export function formatSpan(start: string, end: string): string {
  if (start === end) return formatDate(start)
  const [a, b] = [formatDate(start), formatDate(end)]
  const [ad, am, ay] = a.split(" ")
  const [, bm, by] = b.split(" ")
  if (ay !== by) return `${a} al ${b}`
  if (am !== bm) return `${ad} ${am} al ${b}`
  return `${ad} al ${b}`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Día, semana y rango ya nombran sus fechas; al resto se les agregan. */
function make(
  kind: CajaPeriodKind,
  start: string,
  end: string,
  title: string,
): CajaPeriod {
  const namesDates = kind === "dia" || kind === "semana" || kind === "rango"
  const label = namesDates ? title : `${title} (${formatSpan(start, end)})`
  return { kind, start, end, title, label }
}

/** Período de un tipo que contiene la fecha de referencia. */
export function cajaPeriodFor(
  kind: Exclude<CajaPeriodKind, "rango">,
  ref: string,
): CajaPeriod {
  const { year, month, day } = parts(ref)
  const ym = `${year}-${pad(month)}`
  switch (kind) {
    case "dia":
      return make(kind, ref, ref, `${dayNameLong(ref)} ${formatDate(ref)}`)
    case "semana": {
      // Semana de lunes a domingo.
      const start = addDays(ref, -((weekdayIndex(ref) + 6) % 7))
      const end = addDays(start, 6)
      return make(kind, start, end, `Semana del ${formatSpan(start, end)}`)
    }
    case "quincena": {
      const first = day <= 15
      const start = `${ym}-${first ? "01" : "16"}`
      const end = `${ym}-${first ? "15" : pad(lastDayOfMonth(year, month))}`
      return make(
        kind,
        start,
        end,
        `${first ? "1.ª" : "2.ª"} quincena de ${MONTHS[month - 1]} ${year}`,
      )
    }
    case "mes":
      return make(
        kind,
        `${ym}-01`,
        `${ym}-${pad(lastDayOfMonth(year, month))}`,
        `${cap(MONTHS[month - 1])} ${year}`,
      )
    case "anio":
      return make(kind, `${year}-01-01`, `${year}-12-31`, `Año ${year}`)
  }
}

/** Rango manual; si "desde" quedó después de "hasta", se intercambian. */
export function cajaRange(from: string, to: string): CajaPeriod {
  const [start, end] = from <= to ? [from, to] : [to, from]
  return make(
    "rango",
    start,
    end,
    start === end
      ? `${dayNameLong(start)} ${formatDate(start)}`
      : `Del ${formatSpan(start, end)}`,
  )
}

/**
 * Mueve la fecha de referencia al período anterior (`delta` = -1) o al
 * siguiente (+1). Para mes y quincena se queda en un día que existe en
 * todos los meses, así que nunca salta dos meses de golpe.
 */
export function shiftCajaRef(
  kind: Exclude<CajaPeriodKind, "rango">,
  ref: string,
  delta: number,
): string {
  const { year, month, day } = parts(ref)
  switch (kind) {
    case "dia":
      return addDays(ref, delta)
    case "semana":
      return addDays(ref, 7 * delta)
    case "quincena": {
      // Índice absoluto de quincena, como en la planilla.
      const idx = year * 24 + (month - 1) * 2 + (day <= 15 ? 0 : 1) + delta
      const y = Math.floor(idx / 24)
      const rest = idx - y * 24
      const m = Math.floor(rest / 2) + 1
      return `${y}-${pad(m)}-${rest % 2 === 0 ? "01" : "16"}`
    }
    case "mes": {
      const idx = year * 12 + (month - 1) + delta
      const y = Math.floor(idx / 12)
      return `${y}-${pad(idx - y * 12 + 1)}-01`
    }
    case "anio":
      return `${year + delta}-${pad(month)}-01`
  }
}

export function inCajaPeriod(date: string, period: CajaPeriod): boolean {
  return date >= period.start && date <= period.end
}

export function entriesInPeriod(
  entries: CostEntry[],
  period: CajaPeriod,
): CostEntry[] {
  return entries.filter((c) => inCajaPeriod(c.date, period))
}

/** Arqueos hechos dentro del período, según la fecha local en que se hicieron. */
export function cashCountsInPeriod(
  counts: CostCashCount[],
  period: CajaPeriod,
): CostCashCount[] {
  return counts.filter((s) => inCajaPeriod(localDay(s.at), period))
}

/** Pedazo para nombres de archivo: `2026-10-01_a_2026-10-15` o un solo día. */
export function cajaPeriodSlug(period: CajaPeriod): string {
  return period.start === period.end
    ? period.start
    : `${period.start}_a_${period.end}`
}
