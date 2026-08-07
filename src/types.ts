export type EmployeeCategory = "profesional" | "empleado"

/** Qué ocurrió en un día del período. `trabajo` usa entrada/salida; el resto son días completos. */
export type DayType = "trabajo" | "feriado" | "vacaciones" | "incapacidad" | "ausencia"

/** El horario habitual de un colaborador para un día de la semana. */
export interface DaySchedule {
  works: boolean // false = día libre
  entryTime: string // HH:MM
  exitTime: string // HH:MM
  lunchBreak: boolean
  lunchDuration: number // minutos
}

/**
 * Horario semanal: siempre 7 posiciones, indexadas igual que `Date.getDay()`
 * (0 = domingo … 6 = sábado), para poder buscar el día directamente sin
 * traducir índices en cada llamada.
 */
export type WeeklySchedule = DaySchedule[]

export interface Employee {
  id: string
  name: string
  idNumber: string // cédula / pasaporte
  position: string // cargo
  startDate: string // fecha de ingreso, YYYY-MM-DD ('' si no se registró)
  category: EmployeeCategory
  hourlyRate: number
  schedule: WeeklySchedule // horario habitual, usado para prellenar el registro
  // Deductions (only for empleados, but customizable)
  socialSecurityRate: number // default 9.75 for empleados, 0 for profesionales
  educationRate: number // default 1.25 for empleados, 0 for profesionales
  active: boolean
}

export interface TimeEntry {
  id: string
  employeeId: string
  date: string // YYYY-MM-DD
  dayType: DayType
  entryTime: string // HH:MM — solo aplica a dayType 'trabajo' y 'feriado'
  exitTime: string // HH:MM
  lunchBreak: boolean
  lunchDuration: number // in minutes, default 60
  overtimeRate: number // multiplier, e.g. 1.5 means 50% extra. 1.0 = normal pay
  notes: string
}

export interface PayPeriod {
  year: number
  month: number
  half: 1 | 2 // 1 = days 1-15, 2 = days 16-end
}

/** Planilla congelada: el cálculo queda fijo aunque después cambien tarifas o registros. */
export interface ClosedPeriod {
  key: string // `${year}-${month}-${half}`
  period: PayPeriod
  closedAt: string // ISO timestamp
  summaries: EmployeeSummary[]
}

export interface AppData {
  employees: Employee[]
  timeEntries: TimeEntry[]
  currentPeriod: PayPeriod
  overtimeThreshold: number // hours per day before overtime kicks in, default 8
  standardDayHours: number // jornada usada para pagar días completos (vacaciones, feriado no trabajado)
  holidayRate: number // multiplicador de las horas trabajadas en feriado
  payVacations: boolean // ¿se paga la jornada estándar en día de vacaciones?
  payHolidays: boolean // ¿se paga el feriado no trabajado?
  paySickLeave: boolean // ¿el patrono paga la incapacidad? (en Panamá suele pagarla la CSS)
  closedPeriods: ClosedPeriod[]
  theme: "light" | "dark" | "system"
  companyName: string
  version: number
}

/** Conteo de días por tipo dentro del período. */
export type DayCounts = Record<DayType, number>

export interface EmployeeSummary {
  employee: Employee
  regularHours: number
  overtimeHours: number
  holidayHours: number // horas efectivamente trabajadas en día feriado
  leaveHours: number // horas pagadas sin trabajar (vacaciones / feriado / incapacidad)
  regularPay: number // base imponible (horas regulares + días pagados)
  overtimePay: number // pago de extras (sin descuentos)
  holidayPay: number // recargo por trabajar en feriado (sin descuentos)
  grossSalary: number // regularPay + overtimePay + holidayPay
  socialSecurityDeduction: number // solo sobre regularPay
  educationDeduction: number // solo sobre regularPay
  totalDeductions: number
  netSalary: number // grossSalary - totalDeductions
  entriesCount: number // días con registro de cualquier tipo
  daysWorked: number // días con horas efectivas
  dayCounts: DayCounts
}
