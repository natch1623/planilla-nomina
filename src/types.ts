export type EmployeeCategory = "profesional" | "empleado"

/** `hourly` paga por hora trabajada; `daily` paga una tarifa fija por cada día laborado. */
export type PaymentType = "hourly" | "daily"

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
  paymentType: PaymentType
  hourlyRate: number // usado cuando paymentType es "hourly"
  dailyRate: number // usado cuando paymentType es "daily"
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
  transactions: Transaction[]
  counterparties: Counterparty[]
  budgets: Budget[]
  loans: Loan[]
  goals: FinancialGoal[]
  /** Dinero en caja/banco al inicio, antes del primer movimiento registrado. */
  openingBalance: number
  openingBalanceDate: string // YYYY-MM-DD ('' = sin fecha declarada)
  theme: "light" | "dark" | "system"
  companyName: string
  version: number
}

export type TransactionType = "ingreso" | "gasto"

/**
 * `pagado` ya movió dinero real; `pendiente` es una cuenta por cobrar o por
 * pagar. La diferencia es la base de todo el flujo de caja: el saldo actual
 * solo cuenta lo pagado, y lo pendiente alimenta «por entrar / por salir».
 */
export type TransactionStatus = "pagado" | "pendiente"

export type PaymentMethod = "efectivo" | "transferencia" | "tarjeta" | "cheque" | "otro"

/** Cada cuánto se repite un movimiento. `ninguna` = movimiento único. */
export type Recurrence = "ninguna" | "semanal" | "quincenal" | "mensual" | "anual"

/** Comprobante adjunto, guardado en el propio navegador como data URL. */
export interface Attachment {
  id: string
  name: string
  mime: string
  size: number // bytes del archivo original
  dataUrl: string
}

/** Movimiento contable manual: gasto o ingreso fuera de la nómina. */
export interface Transaction {
  id: string
  date: string // YYYY-MM-DD — cuándo se devengó
  dueDate: string // YYYY-MM-DD — cuándo se cobra/paga ('' = misma que date)
  type: TransactionType
  status: TransactionStatus
  category: string
  description: string
  amount: number
  recurrence: Recurrence
  paymentMethod: PaymentMethod
  counterpartyId: string // '' si no se asoció a nadie
  tags: string[]
  attachments: Attachment[]
}

export type CounterpartyKind = "cliente" | "proveedor"

/** Cliente o proveedor al que se asocian los movimientos. */
export interface Counterparty {
  id: string
  name: string
  kind: CounterpartyKind
  taxId: string // RUC / cédula
  contact: string // teléfono o correo
  notes: string
}

/** Techo de gasto mensual esperado para una categoría. */
export interface Budget {
  id: string
  category: string
  monthlyLimit: number
}

/**
 * Préstamo o adelanto a un colaborador. Las cuotas se descuentan solas de la
 * planilla: no se guarda un historial de pagos, se deriva del índice de
 * quincena, así que recalcular el pasado siempre da el mismo resultado.
 */
export interface Loan {
  id: string
  employeeId: string
  date: string // YYYY-MM-DD en que se entregó
  amount: number // monto total prestado
  installment: number // cuota a descontar por quincena
  /** Primera quincena en la que se descuenta, `${year}-${MM}-${half}`. */
  startPeriodKey: string
  notes: string
  active: boolean // false = condonado o suspendido, deja de descontar
}

export type GoalKind = "ahorro" | "reducir-gastos" | "aumentar-ingresos"

/** Objetivo financiero con fecha límite, para medir avance. */
export interface FinancialGoal {
  id: string
  kind: GoalKind
  title: string
  target: number
  deadline: string // YYYY-MM
  createdAt: string // YYYY-MM-DD
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
  loanDeduction: number // cuota de préstamo o adelanto descontada en el período
  totalDeductions: number // seguro social + educativo + préstamo
  netSalary: number // grossSalary - totalDeductions
  entriesCount: number // días con registro de cualquier tipo
  daysWorked: number // días con horas efectivas
  dayCounts: DayCounts
}
