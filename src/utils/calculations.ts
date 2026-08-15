import type {
  AppData,
  DayCounts,
  DayType,
  Employee,
  EmployeeSummary,
  Loan,
  PayrollAdjustment,
  PayPeriod,
  TimeEntry,
} from "../types"
import { getPeriodDates, periodKey } from "../store"
import { loanDeductionFor } from "./loans"

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

export function adjustmentsForPeriod(
  employeeId: string,
  period: PayPeriod,
  adjustments: PayrollAdjustment[],
): PayrollAdjustment[] {
  const key = periodKey(period)
  return adjustments.filter(
    (adjustment) =>
      adjustment.employeeId === employeeId && adjustment.periodKey === key,
  )
}

export function adjustmentTotalFor(
  employeeId: string,
  period: PayPeriod,
  adjustments: PayrollAdjustment[],
): number {
  return adjustmentsForPeriod(employeeId, period, adjustments).reduce(
    (sum, adjustment) =>
      sum + (adjustment.kind === "bono" ? adjustment.amount : -adjustment.amount),
    0,
  )
}

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

/**
 * Horas entre dos marcas `HH:MM` descontando el almuerzo.
 *
 * Es la única implementación del cálculo de un turno: tanto el registro diario
 * como el horario semanal del colaborador pasan por aquí, así que el manejo del
 * turno nocturno no puede divergir entre ambos.
 */
export function spanHours(
  entryTime: string,
  exitTime: string,
  lunchMinutes: number,
): WorkedHours {
  const empty = { total: 0, crossesMidnight: false, invalid: false }
  if (!entryTime || !exitTime) return empty

  const [entryH, entryM] = entryTime.split(":").map(Number)
  const [exitH, exitM] = exitTime.split(":").map(Number)
  if ([entryH, entryM, exitH, exitM].some((n) => !Number.isFinite(n)))
    return empty

  const entryMins = entryH * 60 + entryM
  let exitMins = exitH * 60 + exitM

  // Entrada y salida iguales es ambiguo —¿cero horas o veinticuatro?— y casi
  // siempre es un tipeo. Tratarlo como turno nocturno pagaba 23 h en silencio,
  // así que se rechaza y la cuadrícula lo marca como registro inválido.
  if (exitMins === entryMins) {
    return { total: 0, crossesMidnight: false, invalid: true }
  }

  // Turno nocturno: la salida cae al día siguiente. Antes esto devolvía 0 horas
  // en silencio, así que una jornada 22:00–06:00 no se pagaba.
  const crossesMidnight = exitMins < entryMins
  if (crossesMidnight) exitMins += 24 * 60

  const worked = (exitMins - entryMins - lunchMinutes) / 60
  if (worked <= 0) return { total: 0, crossesMidnight, invalid: true }
  return { total: worked, crossesMidnight, invalid: false }
}

export function calcWorkedHours(
  entry: Pick<TimeEntry, "entryTime" | "exitTime" | "lunchBreak" | "lunchDuration" | "dayType">,
): WorkedHours {
  if (!usesSchedule(entry.dayType ?? "trabajo")) {
    return { total: 0, crossesMidnight: false, invalid: false }
  }
  return spanHours(
    entry.entryTime,
    entry.exitTime,
    entry.lunchBreak ? entry.lunchDuration : 0,
  )
}

export interface HourSplit {
  regular: number
  overtime: number
}

export function splitHours(total: number, threshold: number): HourSplit {
  if (total <= threshold) return { regular: total, overtime: 0 }
  return { regular: threshold, overtime: total - threshold }
}

/**
 * Días que se asume tiene una quincena al prorratear un salario fijo.
 *
 * Se usa un valor constante y no el conteo real del calendario: la práctica
 * local reparte un salario mensual en dos quincenas de "15 días" cada una,
 * aunque la segunda vaya de 13 a 16 según el mes. Cambiar esto cambiaría
 * cuánto descuenta una ausencia sin que el usuario lo haya pedido.
 */
export const FIXED_SALARY_PERIOD_DAYS = 15

/** Tarifa diaria equivalente de un salario fijo, para prorratear ausencias y el recargo de feriado. */
export function fixedDayRate(employee: Employee): number {
  return employee.fixedSalary / FIXED_SALARY_PERIOD_DAYS
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
  loanDeduction = 0,
  manualAdjustment = 0,
)/** Cuota de préstamo del período; se calcula fuera para no acoplar el motor
 *  de horas al de préstamos. */
: EmployeeSummary {
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

  const isDaily = employee.paymentType === "daily"
  const isFixed = employee.paymentType === "fixed"

  // El salario fijo se otorga completo desde el arranque: las entradas de
  // trabajo no le suman nada porque ya está incluido, y solo una ausencia lo
  // recorta dentro del bucle. Sin esto, un colaborador con salario fijo
  // cobraría cero si no llegara a registrar ni un solo día.
  if (isFixed) regularPay = employee.fixedSalary
  const dayRate = isFixed ? fixedDayRate(employee) : 0

  for (const entry of empEntries) {
    dayCounts[entry.dayType] += 1
    const { total } = calcWorkedHours(entry)

    if (total > 0) {
      daysWorked += 1

      if (isFixed) {
        // Referencia de asistencia: el salario ya cubre el día, así que no
        // hay pago adicional ni horas extra.
        regularHours += total
        if (entry.dayType === "feriado") {
          holidayHours += total
          holidayPay += dayRate * (rules.holidayRate - 1)
        }
      } else if (isDaily) {
        // Tarifa fija por día trabajado: no hay horas extra, las horas
        // registradas quedan solo como referencia de asistencia.
        regularHours += total
        regularPay += employee.dailyRate

        if (entry.dayType === "feriado") {
          holidayHours += total
          holidayPay += employee.dailyRate * (rules.holidayRate - 1)
        }
      } else {
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
      }
    } else if (isFixed && entry.dayType === "ausencia") {
      // La única entrada que le cuesta dinero a un salario fijo: sin esto,
      // "ausencia" dejaría de significar nada distinto de un día libre.
      regularPay -= dayRate
    } else if (isFixed) {
      // Vacaciones, feriado no trabajado e incapacidad: el salario fijo ya los
      // cubre sin importar los interruptores de Configuración, que solo
      // deciden si un colaborador por hora o por día cobra ese día. Se cuentan
      // como referencia, no como pago adicional.
      if (
        entry.dayType === "vacaciones" ||
        entry.dayType === "feriado" ||
        entry.dayType === "incapacidad"
      ) {
        leaveHours += rules.standardDayHours
      }
    } else {
      const paid = paidLeaveHours(entry.dayType, rules)
      if (paid > 0) {
        leaveHours += paid
        regularPay += isDaily ? employee.dailyRate : paid * employee.hourlyRate
      }
    }
  }

  // Solo puede quedar negativo un salario fijo con más ausencias que días
  // tiene la quincena; el resto de tipos de pago nunca resta.
  regularPay = Math.max(0, regularPay)

  // El bruto es el salario del período; las horas extra van por separado
  // porque son un pago adicional, no parte del sueldo.
  const grossSalary = regularPay + holidayPay
  // Descuentos solo sobre salario base (horas regulares y días pagados), NO sobre recargos
  const socialSecurityDeduction =
    regularPay * (employee.socialSecurityRate / 100)
  const educationDeduction = regularPay * (employee.educationRate / 100)

  // Un préstamo no puede dejar el pago en negativo: si la cuota supera lo que
  // queda por entregar, se cobra solo hasta donde alcanza y el resto se arrastra
  // solo, porque el saldo se deriva de lo efectivamente descontado.
  //
  // El tope se mide contra TODO lo que se entrega —extras incluidas—, no contra
  // el bruto: separar las extras del salario es una decisión de presentación y
  // no puede cambiar cuánto se le alcanza a descontar a nadie.
  const afterLegal =
    grossSalary + overtimePay - socialSecurityDeduction - educationDeduction
  const appliedLoan = Math.max(0, Math.min(loanDeduction, afterLegal))
  const appliedManualAdjustment = Math.max(
    -(afterLegal - appliedLoan),
    manualAdjustment,
  )

  const totalDeductions =
    socialSecurityDeduction + educationDeduction + appliedLoan
  const netSalary = grossSalary - totalDeductions + appliedManualAdjustment
  const totalPay = netSalary + overtimePay

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
    loanDeduction: appliedLoan,
    totalDeductions,
    manualAdjustment: appliedManualAdjustment,
    netSalary,
    totalPay,
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
  loans: Loan[] = [],
  adjustments: PayrollAdjustment[] = [],
): EmployeeSummary[] {
  const { start, end } = getPeriodDates(period)
  const periodEntries = entries.filter((e) => e.date >= start && e.date <= end)
  return employees
    .filter((e) => e.active)
    .map((emp) =>
      calcEmployeeSummary(
        emp,
        periodEntries,
        rules,
        loanDeductionFor(emp.id, period, loans),
        adjustmentTotalFor(emp.id, period, adjustments),
      ),
    )
}

export interface PeriodTotals {
  /** Salario bruto sin horas extra. */
  gross: number
  /** Salario neto sin horas extra. */
  net: number
  /** Lo que sale de caja: neto + horas extra. */
  totalPay: number
  deductions: number
  socialSecurity: number
  education: number
  loans: number
  /** Neto de bonos menos descuentos manuales; puede quedar negativo. */
  adjustments: number
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
      // Una planilla cerrada antes de separarse las extras no trae el campo:
      // en ella el neto ya las incluía.
      totalPay: acc.totalPay + (s.totalPay ?? s.netSalary),
      deductions: acc.deductions + s.totalDeductions,
      socialSecurity: acc.socialSecurity + s.socialSecurityDeduction,
      education: acc.education + s.educationDeduction,
      loans: acc.loans + s.loanDeduction,
      // Una planilla cerrada antes de existir los ajustes no trae el campo.
      adjustments: acc.adjustments + (s.manualAdjustment || 0),
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
      totalPay: 0,
      deductions: 0,
      socialSecurity: 0,
      education: 0,
      loans: 0,
      adjustments: 0,
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
