import type { TimeEntry } from "../types"
import { DAY_TYPE_META, calcWorkedHours, fmtHours, usesSchedule } from "./calculations"
import { dayName, dayNum, datesBetween } from "./dates"

/** Un renglón de asistencia: un turno registrado, o un día sin marcación. */
export interface AttendanceRecord {
  date: string // YYYY-MM-DD
  dayLabel: string // "03 Lun"
  typeLabel: string // "Trabajado", "Feriado", … o "Sin registro"
  entryTime: string // HH:MM o "—"
  exitTime: string
  hours: number // horas netas del turno
  hoursLabel: string
  lunchMinutes: number
  overtimeRate: number
  note: string
  /** Falso en los días que el colaborador no marcó. */
  hasEntry: boolean
  /** Observaciones ya redactadas: almuerzo, recargo, turno nocturno, nota. */
  detail: string
}

function formatRate(rate: number): string {
  return rate.toFixed(2).replace(/\.00$/, "").replace(/0$/, "")
}

/**
 * Asistencia día por día de un colaborador dentro del período.
 *
 * Se recorre el calendario y no las entradas para que un día sin marcar se vea
 * como tal: si solo se listaran los registros existentes, un día faltante
 * pasaría desapercibido y el comprobante dejaría de ser una rendición completa
 * de la quincena.
 */
export function attendanceFor(
  entries: TimeEntry[],
  employeeId: string,
  start: string,
  end: string,
): { records: AttendanceRecord[]; totalHours: number } {
  const byDate = new Map<string, TimeEntry[]>()
  for (const e of entries) {
    if (e.employeeId !== employeeId) continue
    if (e.date < start || e.date > end) continue
    const list = byDate.get(e.date)
    if (list) list.push(e)
    else byDate.set(e.date, [e])
  }

  const records: AttendanceRecord[] = []
  let totalHours = 0

  for (const date of datesBetween(start, end)) {
    const dayLabel = `${String(dayNum(date)).padStart(2, "0")} ${dayName(date)}`
    const dayEntries = byDate.get(date)

    if (!dayEntries || dayEntries.length === 0) {
      records.push({
        date,
        dayLabel,
        typeLabel: "Sin registro",
        entryTime: "—",
        exitTime: "—",
        hours: 0,
        hoursLabel: "—",
        lunchMinutes: 0,
        overtimeRate: 1,
        note: "",
        hasEntry: false,
        detail: "Sin marcación",
      })
      continue
    }

    for (const entry of dayEntries) {
      const worked = calcWorkedHours(entry)
      const timed = usesSchedule(entry.dayType)
      const lunchMinutes = timed && entry.lunchBreak ? entry.lunchDuration : 0
      totalHours += worked.total

      const details: string[] = []
      if (timed && worked.invalid) details.push("Registro inválido")
      if (lunchMinutes > 0) details.push(`Almuerzo ${lunchMinutes} min`)
      if (timed && entry.overtimeRate !== 1) {
        details.push(`Extra x${formatRate(entry.overtimeRate)}`)
      }
      if (timed && worked.crossesMidnight) details.push("Cruza medianoche")
      if (entry.notes.trim()) details.push(`Nota: ${entry.notes.trim()}`)
      if (details.length === 0) {
        details.push(
          timed
            ? worked.total > 0
              ? `${fmtHours(worked.total)} netas`
              : "—"
            : "Día completo",
        )
      }

      records.push({
        date,
        dayLabel,
        typeLabel: DAY_TYPE_META[entry.dayType].label,
        entryTime: timed ? entry.entryTime || "—" : "—",
        exitTime: timed ? entry.exitTime || "—" : "—",
        hours: worked.total,
        hoursLabel: worked.total > 0 ? fmtHours(worked.total) : "—",
        lunchMinutes,
        overtimeRate: entry.overtimeRate,
        note: entry.notes.trim(),
        hasEntry: true,
        detail: details.join(" · "),
      })
    }
  }

  return { records, totalHours }
}

/**
 * La misma asistencia como filas de texto para las tablas del PDF.
 *
 * Un día con dos turnos repite la fecha vacía en el segundo renglón para que la
 * columna se lea en vertical sin duplicados.
 */
export function attendanceRows(
  entries: TimeEntry[],
  employeeId: string,
  start: string,
  end: string,
): { rows: string[][]; totalHours: number } {
  const { records, totalHours } = attendanceFor(entries, employeeId, start, end)
  const rows = records.map((r, i) => [
    i > 0 && records[i - 1].date === r.date ? "" : r.dayLabel,
    r.typeLabel,
    r.entryTime,
    r.exitTime,
    r.hoursLabel,
    r.detail,
  ])
  return { rows, totalHours }
}
