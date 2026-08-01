import type {
  AppData,
  DayCounts,
  DayType,
  Employee,
  EmployeeSummary,
  PayPeriod,
  TimeEntry,
} from "../types"
import { getPeriodDates } from "../store"

/** Los parámetros de cálculo, separados del resto de AppData. */
export interface PayrollRules {
  overtimeThreshold: number
  standardDayHours: number
  holidayRate: number
  payVacations: boolean
  payHolidays: boolean
  paySickLeave: boolean
}

export function rulesFrom(data: AppData): PayrollRules {
  return {
    overtimeThreshold: data.overtimeThreshold,
    standardDayHours: data.standardDayHours,
    holidayRate: data.holidayRate,
    payVacations: data.payVacations,
    payHolidays: data.payHolidays,
    paySickLeave: data.paySickLeave,
  }
}

export const DAY_TYPE_META: Record<DayType, {
  label: string
  short: string
  token: string
}> = {
  trabajo: { label: "Trabajado", short: "Trab.", token: "brand" },
  feriado: { label: "Feriado", short: "Fer.", token: "violet" },
  vacaciones: { label: "Vacaciones", short: "Vac.", token: "teal" },
  incapacidad: { label: "Incapacidad", short: "Inc.", token: "amber" },
  ausencia: { label: "Ausencia", short: "Aus.", token: "danger" },
}

export const DAY_TYPES = Object.keys(DAY_TYPE_META) as DayType[]

/** Los tipos de día que se registran con horario de entrada y salida. */
export function usesSchedule(dayType: DayType): boolean {
  return dayType === "trabajo" || dayType === "feriado"
}

export interface WorkedHours {
  total: number
  /** La salida es menor o igual que la entrada: el turno cruza la medianoche. */
  crossesMidnight: boolean
  /** El almuerzo consume el turno completo. */
  invalid: boolean
}

export function calcWorkedHours(
  entry: Pick<TimeEntry, "entryTime" | "exitTime" | "lunchBreak" | "lunchDuration" | "dayType">,
): WorkedHours {
  const empty = { total: 0, crossesMidnight: false, invalid: false }
  if (!usesSchedule(entry.dayType ?? "trabajo")) return empty
  if (!entry.entryTime || !entry.exitTime) return empty

  const [entryH, entryM] = entry.entryTime.split(":").map(Number)
  const [exitH, exitM] = entry.exitTime.split(":").map(Number)
  if ([entryH, entryM, exitH, exitM].some((n) => !Number.isFinite(n)))
    return empty

  const entryMins = entryH * 60 + entryM
  let exitMins = exitH * 60 + exitM

  // Turno nocturno: la salida cae al día siguiente. Antes esto devolvía 0 horas
  // en silencio, así que una jornada 22:00–06:00 no se pagaba.
  const crossesMidnight = exitMins <= entryMins
  if (crossesMidnight) exitMins += 24 * 60

  const lunch = entry.lunchBreak ? entry.lunchDuration : 0
  const worked = (exitMins - entryMins - lunch) / 60

  if (worked <= 0) return { total: 0, crossesMidnight, invalid: true }
  return { total: worked, crossesMidnight, invalid: false }
}

export interface HourSplit {
  regular: number
  overtime: number
}

export function splitHours(total: number, threshold: number): HourSplit {
  if (total <= threshold) return { regular: total, overtime: 0 }
  return { regular: threshold, overtime: total - threshold }
}

function emptyDayCounts(): DayCounts {
  return { trabajo: 0, feriado: 0, vacaciones: 0, incapacidad: 0, ausencia: 0 }
}

/** ¿Este tipo de día se paga como jornada completa sin trabajar? */
function paidLeaveHours(dayType: DayType, rules: PayrollRules): number {
  if (dayType === "vacaciones")
    return rules.payVacations ? rules.standardDayHours : 0
  if (dayType === "feriado")
    return rules.payHolidays ? rules.standardDayHours : 0
  if (dayType === "incapacidad")
    return rules.paySickLeave ? rules.standardDayHours : 0
  return 0
}

export function calcEmployeeSummary(
  employee: Employee,
  entries: TimeEntry[],
  rules: PayrollRules,
): EmployeeSummary {
  const empEntries = entries.filter((e) => e.employeeId === employee.id)

  let regularHours = 0
  let overtimeHours = 0
  let holidayHours = 0
  let leaveHours = 0
  let regularPay = 0
  let overtimePay = 0
  let holidayPay = 0
  let daysWorked = 0
  const dayCounts = emptyDayCounts()

  for (const entry of empEntries) {
    dayCounts[entry.dayType] += 1
    const { total } = calcWorkedHours(entry)

    if (total > 0) {
      daysWorked += 1
      const { regular, overtime } = splitHours(total, rules.overtimeThreshold)
      regularHours += regular
      regularPay += regular * employee.hourlyRate
      overtimeHours += overtime
      overtimePay += overtime * employee.hourlyRate * entry.overtimeRate

      if (entry.dayType === "feriado") {
        holidayHours += total
        // Solo el recargo: la tarifa base ya se contó arriba como imponible.
        holidayPay += total * employee.hourlyRate * (rules.holidayRate - 1)
      }
    } else {
      const paid = paidLeaveHours(entry.dayType, rules)
      if (paid > 0) {
        leaveHours += paid
        regularPay += paid * employee.hourlyRate
      }
    }
  }

  const grossSalary = regularPay + overtimePay + holidayPay
  // Descuentos solo sobre salario base (horas regulares y días pagados), NO sobre recargos
  const socialSecurityDeduction =
    regularPay * (employee.socialSecurityRate / 100)
  const educationDeduction = regularPay * (employee.educationRate / 100)
  const totalDeductions = socialSecurityDeduction + educationDeduction
  const netSalary = grossSalary - totalDeductions

  return {
    employee,
    regularHours,
    overtimeHours,
    holidayHours,
    leaveHours,
    regularPay,
    overtimePay,
    holidayPay,
    grossSalary,
    socialSecurityDeduction,
    educationDeduction,
    totalDeductions,
    netSalary,
    entriesCount: empEntries.length,
    daysWorked,
    dayCounts,
  }
}

export function calcPeriodSummaries(
  employees: Employee[],
  entries: TimeEntry[],
  period: PayPeriod,
  rules: PayrollRules,
): EmployeeSummary[] {
  const { start, end } = getPeriodDates(period)
  const periodEntries = entries.filter((e) => e.date >= start && e.date <= end)
  return employees
    .filter((e) => e.active)
    .map((emp) => calcEmployeeSummary(emp, periodEntries, rules))
}

export interface PeriodTotals {
  gross: number
  net: number
  deductions: number
  socialSecurity: number
  education: number
  regularPay: number
  overtimePay: number
  holidayPay: number
  hours: number
  regularHours: number
  overtimeHours: number
  days: number
}

export function calcTotals(summaries: EmployeeSummary[]): PeriodTotals {
  return summaries.reduce<PeriodTotals>(
    (acc, s) => ({
      gross: acc.gross + s.grossSalary,
      net: acc.net + s.netSalary,
      deductions: acc.deductions + s.totalDeductions,
      socialSecurity: acc.socialSecurity + s.socialSecurityDeduction,
      education: acc.education + s.educationDeduction,
      regularPay: acc.regularPay + s.regularPay,
      overtimePay: acc.overtimePay + s.overtimePay,
      holidayPay: acc.holidayPay + s.holidayPay,
      hours: acc.hours + s.regularHours + s.overtimeHours,
      regularHours: acc.regularHours + s.regularHours,
      overtimeHours: acc.overtimeHours + s.overtimeHours,
      days: acc.days + s.daysWorked,
    }),
    {
      gross: 0,
      net: 0,
      deductions: 0,
      socialSecurity: 0,
      education: 0,
      regularPay: 0,
      overtimePay: 0,
      holidayPay: 0,
      hours: 0,
      regularHours: 0,
      overtimeHours: 0,
      days: 0,
    },
  )
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) n = 0
  return new Intl.NumberFormat("es-PA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function fmtHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0h"
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  if (mins === 0) return `${whole}h`
  if (mins === 60) return `${whole + 1}h`
  return `${whole}h ${mins}m`
}

/** Porcentaje seguro: devuelve 0 en vez de NaN o Infinity cuando el total es cero. */
export function pct(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) return 0
  return (part / total) * 100
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}
