import type { AppData, ClosedPeriod, EmployeeSummary } from "../types"
import { getPeriodDates, periodKey } from "../store"
import { clearLoanCharges, recordLoanCharges } from "./loans"

export function closePayroll(data: AppData, summaries: EmployeeSummary[]): AppData {
  const key = periodKey(data.currentPeriod)
  if (data.closedPeriods.some(c => c.key === key)) throw new Error("Esta quincena ya está cerrada.")
  const { start, end } = getPeriodDates(data.currentPeriod)
  const previous = data.payrollArchives.filter(c => c.key === key)
    .sort((a,b) => (b.revision ?? 1) - (a.revision ?? 1) || b.closedAt.localeCompare(a.closedAt))[0]
  const closure: ClosedPeriod = {
    id: crypto.randomUUID(), key, period: data.currentPeriod,
    revision: (previous?.revision ?? (previous ? 1 : 0)) + 1,
    ...(previous?.id ? { supersedes: previous.id } : {}),
    closedAt: new Date().toISOString(), summaries,
    snapshot: {
      companyName: data.companyName, employees: data.employees,
      timeEntries: data.timeEntries.filter(e => e.date >= start && e.date <= end),
      manualAdjustments: data.manualAdjustments.filter(a => a.periodKey === key),
      loans: data.loans, overtimeThreshold: data.overtimeThreshold,
      standardDayHours: data.standardDayHours, holidayRate: data.holidayRate,
      payVacations: data.payVacations, payHolidays: data.payHolidays, paySickLeave: data.paySickLeave,
    },
  }
  // Clonar también arrays/empleados: la foto no comparte objetos mutables.
  return { ...data, loans: recordLoanCharges(data.loans, summaries, data.currentPeriod), closedPeriods: [...data.closedPeriods, structuredClone(closure)] }
}

export function reopenPayroll(data: AppData): AppData {
  const key = periodKey(data.currentPeriod)
  const closed = data.closedPeriods.find(c => c.key === key)
  if (!closed) throw new Error("La quincena no está cerrada.")
  return { ...data, loans: clearLoanCharges(data.loans, data.currentPeriod),
    closedPeriods: data.closedPeriods.filter(c => c.key !== key),
    payrollArchives: [...data.payrollArchives, structuredClone(closed)] }
}

export function payrollReportData(data: AppData): AppData {
  const closed = data.closedPeriods.find(c => c.key === periodKey(data.currentPeriod))
  return closed?.snapshot ? { ...data, ...closed.snapshot } : data
}

function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
  return JSON.stringify(value)
}

/** El mismo contrato se impone por trigger en PostgreSQL. */
export function assertPayrollIntegrity(previous: AppData, next: AppData): void {
  const archives = new Set(next.payrollArchives.map(canonical))
  if (previous.payrollArchives.some(c => !archives.has(canonical(c)))) throw new Error("No se puede borrar o modificar el historial de cierres.")
  for (const closed of previous.closedPeriods) {
    const current = next.closedPeriods.find(c => c.key === closed.key)
    if (!current) {
      if (!archives.has(canonical(closed))) throw new Error("Reabrir requiere conservar el cierre anterior en el historial.")
      continue
    }
    if (canonical(closed) !== canonical(current)) {
      if (archives.has(canonical(closed)) && current.id && current.id !== closed.id && (current.revision ?? 0) > (closed.revision ?? 1)) continue
      throw new Error("No se puede modificar un cierre existente.")
    }
    const { start, end } = getPeriodDates(closed.period)
    const entries = (d: AppData) => d.timeEntries.filter(e => e.date >= start && e.date <= end).sort((a,b) => a.id.localeCompare(b.id))
    const adjustments = (d: AppData) => d.manualAdjustments.filter(a => a.periodKey === closed.key).sort((a,b) => a.id.localeCompare(b.id))
    if (canonical(entries(previous)) !== canonical(entries(next)) || canonical(adjustments(previous)) !== canonical(adjustments(next))) throw new Error("No se puede modificar asistencia o ajustes de una quincena cerrada.")
    const charges = (d: AppData) => d.loans.filter(l => closed.key in l.charges).sort((a,b) => a.id.localeCompare(b.id)).map(l => [l.id, l.charges[closed.key]])
    if (canonical(charges(previous)) !== canonical(charges(next))) throw new Error("No se pueden cambiar cuotas cobradas en una quincena cerrada.")
  }
}
