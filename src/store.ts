import type {
  AppData,
  Attachment,
  Budget,
  ClosedPeriod,
  Counterparty,
  CounterpartyKind,
  DayType,
  Employee,
  FinancialGoal,
  GoalKind,
  Loan,
  PayPeriod,
  PaymentMethod,
  PaymentType,
  Recurrence,
  TimeEntry,
  Transaction,
  TransactionStatus,
  TransactionType,
  WeeklySchedule,
} from "./types"

const STORAGE_KEY = "planilla_data"
const DATA_VERSION = 6

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

const now = new Date()
const currentDay = now.getDate()

const defaultPeriod: PayPeriod = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  half: currentDay <= 15 ? 1 : 2,
}

export const defaultData: AppData = {
  employees: [],
  timeEntries: [],
  currentPeriod: defaultPeriod,
  overtimeThreshold: 8,
  standardDayHours: 8,
  holidayRate: 1.5,
  payVacations: true,
  payHolidays: true,
  paySickLeave: false,
  closedPeriods: [],
  transactions: [],
  counterparties: [],
  budgets: [],
  loans: [],
  goals: [],
  openingBalance: 0,
  openingBalanceDate: "",
  theme: "system",
  companyName: "",
  version: DATA_VERSION,
}

const DAY_TYPES: DayType[] = [
  "trabajo",
  "feriado",
  "vacaciones",
  "incapacidad",
  "ausencia",
]

export interface PeriodDates {
  start: string
  end: string
}

/** Lunes a viernes de 8 a 5 con una hora de almuerzo; fin de semana libre. */
export function defaultWeeklySchedule(): WeeklySchedule {
  return Array.from({ length: 7 }, (_, weekday) => ({
    works: weekday >= 1 && weekday <= 5,
    entryTime: "08:00",
    exitTime: "17:00",
    lunchBreak: true,
    lunchDuration: 60,
  }))
}

function normalizeSchedule(raw: any): WeeklySchedule {
  const fallback = defaultWeeklySchedule()
  if (!Array.isArray(raw)) return fallback
  // Siempre 7 posiciones: un arreglo corto o largo rompería la búsqueda por día.
  return fallback.map((base, weekday) => {
    const day = raw[weekday]
    if (!day || typeof day !== "object") return base
    return {
      works: bool(day.works, base.works),
      entryTime: TIME_RE.test(str(day.entryTime))
        ? day.entryTime
        : base.entryTime,
      exitTime: TIME_RE.test(str(day.exitTime)) ? day.exitTime : base.exitTime,
      lunchBreak: bool(day.lunchBreak, base.lunchBreak),
      lunchDuration: Math.min(
        600,
        Math.max(0, num(day.lunchDuration, base.lunchDuration)),
      ),
    }
  })
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value))
  return Number.isFinite(n) ? n : fallback
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function normalizeEmployee(raw: any): Employee | null {
  if (!raw || typeof raw !== "object") return null
  const name = str(raw.name).trim()
  if (!name) return null
  const category = raw.category === "profesional" ? "profesional" : "empleado"
  const paymentType: PaymentType =
    raw.paymentType === "daily" ? "daily" : "hourly"
  return {
    id: str(raw.id) || crypto.randomUUID(),
    name,
    idNumber: str(raw.idNumber),
    position: str(raw.position),
    startDate: str(raw.startDate),
    category,
    paymentType,
    hourlyRate: Math.max(0, num(raw.hourlyRate, 0)),
    dailyRate: Math.max(0, num(raw.dailyRate, 0)),
    // Los datos anteriores a la v3 no traían horario: se les asigna el estándar.
    schedule: normalizeSchedule(raw.schedule),
    socialSecurityRate: Math.max(
      0,
      num(raw.socialSecurityRate, category === "empleado" ? 9.75 : 0),
    ),
    educationRate: Math.max(
      0,
      num(raw.educationRate, category === "empleado" ? 1.25 : 0),
    ),
    active: bool(raw.active, true),
  }
}

function normalizeEntry(raw: any, employeeIds: Set<string>): TimeEntry | null {
  if (!raw || typeof raw !== "object") return null
  const date = str(raw.date)
  const employeeId = str(raw.employeeId)
  if (!DATE_RE.test(date) || !employeeIds.has(employeeId)) return null

  // v1 no tenía dayType: todo registro existente era un día trabajado.
  const dayType: DayType = DAY_TYPES.includes(raw.dayType)
    ? raw.dayType
    : "trabajo"
  const entryTime = TIME_RE.test(str(raw.entryTime)) ? raw.entryTime : ""
  const exitTime = TIME_RE.test(str(raw.exitTime)) ? raw.exitTime : ""

  // Un día de trabajo sin horas válidas no aporta nada y ensucia la cuadrícula.
  if (dayType === "trabajo" && (!entryTime || !exitTime)) return null

  return {
    id: str(raw.id) || crypto.randomUUID(),
    employeeId,
    date,
    dayType,
    entryTime,
    exitTime,
    lunchBreak: bool(raw.lunchBreak, true),
    lunchDuration: Math.min(600, Math.max(0, num(raw.lunchDuration, 60))),
    overtimeRate: Math.max(1, num(raw.overtimeRate, 1.5)),
    notes: str(raw.notes),
  }
}

const TRANSACTION_TYPES: TransactionType[] = ["ingreso", "gasto"]
const TRANSACTION_STATUSES: TransactionStatus[] = ["pagado", "pendiente"]
const PAYMENT_METHODS: PaymentMethod[] = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "cheque",
  "otro",
]
const RECURRENCES: Recurrence[] = [
  "ninguna",
  "semanal",
  "quincenal",
  "mensual",
  "anual",
]

/**
 * Los adjuntos viven dentro de localStorage, que ronda los 5 MB para todo el
 * dominio. Sin un tope, tres fotos de factura dejarían la aplicación sin
 * espacio para la planilla, que es el dato que de verdad no se puede perder.
 */
export const MAX_ATTACHMENT_BYTES = 400 * 1024
export const MAX_ATTACHMENTS_PER_TX = 4

function normalizeAttachment(raw: any): Attachment | null {
  if (!raw || typeof raw !== "object") return null
  const dataUrl = str(raw.dataUrl)
  if (!dataUrl.startsWith("data:")) return null
  return {
    id: str(raw.id) || crypto.randomUUID(),
    name: str(raw.name) || "adjunto",
    mime: str(raw.mime),
    size: Math.max(0, num(raw.size, 0)),
    dataUrl,
  }
}

function normalizeTransaction(raw: any): Transaction | null {
  if (!raw || typeof raw !== "object") return null
  const date = str(raw.date)
  if (!DATE_RE.test(date)) return null
  const type: TransactionType = TRANSACTION_TYPES.includes(raw.type)
    ? raw.type
    : "gasto"
  const amount = Math.max(0, num(raw.amount, 0))
  if (amount <= 0) return null

  // Antes de la v6 solo existía `recurring: boolean`, que significaba mensual.
  const recurrence: Recurrence = RECURRENCES.includes(raw.recurrence)
    ? raw.recurrence
    : raw.recurring === true
      ? "mensual"
      : "ninguna"

  const dueDate = DATE_RE.test(str(raw.dueDate)) ? raw.dueDate : date

  return {
    id: str(raw.id) || crypto.randomUUID(),
    date,
    dueDate,
    type,
    // Los movimientos previos a la v6 ya habían ocurrido: se dan por pagados.
    status: TRANSACTION_STATUSES.includes(raw.status) ? raw.status : "pagado",
    category: str(raw.category) || "Otros",
    description: str(raw.description),
    amount,
    recurrence,
    paymentMethod: PAYMENT_METHODS.includes(raw.paymentMethod)
      ? raw.paymentMethod
      : "efectivo",
    counterpartyId: str(raw.counterpartyId),
    tags: Array.isArray(raw.tags)
      ? raw.tags
          .map((t: unknown) => str(t).trim())
          .filter(Boolean)
          .slice(0, 12)
      : [],
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments
          .map(normalizeAttachment)
          .filter((a: Attachment | null): a is Attachment => a !== null)
          .slice(0, MAX_ATTACHMENTS_PER_TX)
      : [],
  }
}

function normalizeCounterparty(raw: any): Counterparty | null {
  if (!raw || typeof raw !== "object") return null
  const name = str(raw.name).trim()
  if (!name) return null
  const kind: CounterpartyKind =
    raw.kind === "proveedor" ? "proveedor" : "cliente"
  return {
    id: str(raw.id) || crypto.randomUUID(),
    name,
    kind,
    taxId: str(raw.taxId),
    contact: str(raw.contact),
    notes: str(raw.notes),
  }
}

function normalizeBudget(raw: any): Budget | null {
  if (!raw || typeof raw !== "object") return null
  const category = str(raw.category).trim()
  if (!category) return null
  return {
    id: str(raw.id) || crypto.randomUUID(),
    category,
    monthlyLimit: Math.max(0, num(raw.monthlyLimit, 0)),
  }
}

function normalizeLoan(raw: any, employeeIds: Set<string>): Loan | null {
  if (!raw || typeof raw !== "object") return null
  const employeeId = str(raw.employeeId)
  // Un préstamo sin dueño no se puede descontar de ninguna planilla.
  if (!employeeIds.has(employeeId)) return null
  const date = DATE_RE.test(str(raw.date)) ? raw.date : ""
  if (!date) return null
  const amount = Math.max(0, num(raw.amount, 0))
  if (amount <= 0) return null
  return {
    id: str(raw.id) || crypto.randomUUID(),
    employeeId,
    date,
    amount,
    installment: Math.max(0, num(raw.installment, 0)),
    startPeriodKey: str(raw.startPeriodKey) || periodKeyForDate(date),
    notes: str(raw.notes),
    active: bool(raw.active, true),
  }
}

const GOAL_KINDS: GoalKind[] = ["ahorro", "reducir-gastos", "aumentar-ingresos"]

function normalizeGoal(raw: any): FinancialGoal | null {
  if (!raw || typeof raw !== "object") return null
  const title = str(raw.title).trim()
  if (!title) return null
  return {
    id: str(raw.id) || crypto.randomUUID(),
    kind: GOAL_KINDS.includes(raw.kind) ? raw.kind : "ahorro",
    title,
    target: Math.max(0, num(raw.target, 0)),
    deadline: /^\d{4}-\d{2}$/.test(str(raw.deadline)) ? raw.deadline : "",
    createdAt: DATE_RE.test(str(raw.createdAt)) ? raw.createdAt : "",
  }
}

function normalizePeriod(raw: any): PayPeriod {
  if (!raw || typeof raw !== "object") return defaultPeriod
  const year = Math.round(num(raw.year, defaultPeriod.year))
  const month = Math.round(num(raw.month, defaultPeriod.month))
  return {
    year: year >= 2000 && year <= 2100 ? year : defaultPeriod.year,
    month: month >= 1 && month <= 12 ? month : defaultPeriod.month,
    half: raw.half === 2 ? 2 : 1,
  }
}

/**
 * Acepta cualquier objeto y devuelve un AppData usable. Se usa tanto al leer
 * localStorage como al importar un archivo, para que un JSON ajeno no pueda
 * dejar la aplicación en un estado imposible de recuperar.
 */
export function normalizeData(raw: any): AppData {
  if (!raw || typeof raw !== "object") return { ...defaultData }

  const employees: Employee[] = Array.isArray(raw.employees)
    ? raw.employees
        .map(normalizeEmployee)
        .filter((e: Employee | null): e is Employee => e !== null)
    : []
  const employeeIds = new Set<string>(employees.map((e) => e.id))

  const timeEntries: TimeEntry[] = Array.isArray(raw.timeEntries)
    ? raw.timeEntries
        .map((e: any) => normalizeEntry(e, employeeIds))
        .filter((e: TimeEntry | null): e is TimeEntry => e !== null)
    : []

  const closedPeriods: ClosedPeriod[] = Array.isArray(raw.closedPeriods)
    ? raw.closedPeriods.filter(
        (c: any) =>
          c &&
          typeof c === "object" &&
          typeof c.key === "string" &&
          Array.isArray(c.summaries),
      )
    : []

  const transactions: Transaction[] = Array.isArray(raw.transactions)
    ? raw.transactions
        .map(normalizeTransaction)
        .filter((t: Transaction | null): t is Transaction => t !== null)
    : []

  const counterparties: Counterparty[] = Array.isArray(raw.counterparties)
    ? raw.counterparties
        .map(normalizeCounterparty)
        .filter((c: Counterparty | null): c is Counterparty => c !== null)
    : []

  const budgets: Budget[] = Array.isArray(raw.budgets)
    ? raw.budgets
        .map(normalizeBudget)
        .filter((b: Budget | null): b is Budget => b !== null)
    : []

  const loans: Loan[] = Array.isArray(raw.loans)
    ? raw.loans
        .map((l: any) => normalizeLoan(l, employeeIds))
        .filter((l: Loan | null): l is Loan => l !== null)
    : []

  const goals: FinancialGoal[] = Array.isArray(raw.goals)
    ? raw.goals
        .map(normalizeGoal)
        .filter((g: FinancialGoal | null): g is FinancialGoal => g !== null)
    : []

  const theme =
    raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system"

  return {
    employees,
    timeEntries,
    currentPeriod: normalizePeriod(raw.currentPeriod),
    overtimeThreshold: Math.min(24, Math.max(1, num(raw.overtimeThreshold, 8))),
    standardDayHours: Math.min(24, Math.max(1, num(raw.standardDayHours, 8))),
    holidayRate: Math.max(1, num(raw.holidayRate, 1.5)),
    payVacations: bool(raw.payVacations, true),
    payHolidays: bool(raw.payHolidays, true),
    paySickLeave: bool(raw.paySickLeave, false),
    closedPeriods,
    transactions,
    counterparties,
    budgets,
    loans,
    goals,
    openingBalance: num(raw.openingBalance, 0),
    openingBalanceDate: DATE_RE.test(str(raw.openingBalanceDate))
      ? raw.openingBalanceDate
      : "",
    theme,
    companyName: str(raw.companyName),
    version: DATA_VERSION,
  }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultData }
    return normalizeData(JSON.parse(raw))
  } catch {
    return { ...defaultData }
  }
}

/**
 * Devuelve `false` cuando el navegador rechaza guardar (casi siempre por cuota
 * llena). Desde que se pueden adjuntar comprobantes eso dejó de ser hipotético,
 * y el usuario tiene que enterarse: si no, seguiría trabajando creyendo que sus
 * cambios quedaron guardados.
 */
export function saveData(data: AppData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    return true
  } catch (err) {
    console.error("No se pudo guardar en localStorage", err)
    return false
  }
}

export function exportJSON(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `planilla_${data.currentPeriod.year}_${String(data.currentPeriod.month).padStart(2, "0")}_q${data.currentPeriod.half}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function importJSON(file: File): Promise<AppData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      let parsed: any
      try {
        parsed = JSON.parse(e.target?.result as string)
      } catch {
        reject(new Error("El archivo no es un JSON válido."))
        return
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray(parsed.employees)
      ) {
        reject(
          new Error(
            "El archivo no parece un respaldo de planilla (falta la lista de colaboradores).",
          ),
        )
        return
      }
      resolve(normalizeData(parsed))
    }
    reader.onerror = () => reject(new Error("Error al leer el archivo"))
    reader.readAsText(file)
  })
}

export function getPeriodDates(period: PayPeriod): PeriodDates {
  const year = period.year
  const month = period.month
  if (period.half === 1) {
    return {
      start: `${year}-${String(month).padStart(2, "0")}-01`,
      end: `${year}-${String(month).padStart(2, "0")}-15`,
    }
  } else {
    const lastDay = new Date(year, month, 0).getDate()
    return {
      start: `${year}-${String(month).padStart(2, "0")}-16`,
      end: `${year}-${String(month).padStart(2, "0")}-${lastDay}`,
    }
  }
}

export function periodKey(period: PayPeriod): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}-${period.half}`
}

/** La quincena en la que cae una fecha `YYYY-MM-DD`. */
export function periodForDate(dateStr: string): PayPeriod {
  const [year, month, day] = dateStr.split("-").map(Number)
  return { year, month, half: day <= 15 ? 1 : 2 }
}

export function periodKeyForDate(dateStr: string): string {
  return periodKey(periodForDate(dateStr))
}

/**
 * Índice absoluto de quincena, para poder restar dos períodos y saber cuántas
 * quincenas los separan sin recorrer el calendario.
 */
export function periodIndex(period: PayPeriod): number {
  return period.year * 24 + (period.month - 1) * 2 + (period.half - 1)
}

export function periodFromIndex(index: number): PayPeriod {
  const year = Math.floor(index / 24)
  const rest = index - year * 24
  return {
    year,
    month: Math.floor(rest / 2) + 1,
    half: (rest % 2 === 0 ? 1 : 2) as 1 | 2,
  }
}

export function periodLabel(period: PayPeriod, short = false): string {
  const month = short
    ? MONTHS_ES[period.month - 1].slice(0, 3)
    : MONTHS_ES[period.month - 1]
  return `${month} ${period.year} · Q${period.half}`
}

/** Avanza o retrocede quincenas, cruzando meses y años. */
export function shiftPeriod(period: PayPeriod, delta: number): PayPeriod {
  return periodFromIndex(periodIndex(period) + delta)
}

export const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]
