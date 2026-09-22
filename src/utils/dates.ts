/**
 * Utilidades de fecha basadas en cadenas `YYYY-MM-DD`.
 *
 * Todo se calcula con aritmética UTC y se formatea a mano: usar `toISOString()`
 * sobre una fecha local desplaza el día en zonas horarias al este de Greenwich,
 * y una quincena mal recortada es un día de salario que aparece o desaparece.
 */

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
const DAY_NAMES_LONG = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
]

function toUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUTC(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = toUTC(start)
  const endDate = toUTC(end)
  while (cur <= endDate) {
    dates.push(fromUTC(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

export function weekdayIndex(dateStr: string): number {
  return toUTC(dateStr).getUTCDay()
}

export function isWeekend(dateStr: string): boolean {
  const d = weekdayIndex(dateStr)
  return d === 0 || d === 6
}

export function dayNum(dateStr: string): number {
  return parseInt(dateStr.split("-")[2], 10)
}

export function dayName(dateStr: string): string {
  return DAY_NAMES[weekdayIndex(dateStr)]
}

export function dayNameLong(dateStr: string): string {
  return DAY_NAMES_LONG[weekdayIndex(dateStr)]
}

/** `2026-07-31` → `31 jul 2026` */
export function formatDate(dateStr: string): string {
  const months = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ]
  const [y, m, d] = dateStr.split("-")
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`
}

export function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Fecha local (YYYY-MM-DD) de un timestamp ISO, comparable con las fechas de registros. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** "22 sep 2026, 11:21 a. m." a partir de un timestamp ISO. */
export function formatDateTime(iso: string): string {
  const time = new Date(iso).toLocaleTimeString("es-PA", {
    hour: "numeric",
    minute: "2-digit",
  })
  return `${formatDate(localDay(iso))}, ${time}`
}
