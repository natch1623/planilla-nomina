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
  PayrollAdjustment,
  PayrollAdjustmentKind,
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
export const DATA_VERSION = 10

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
  manualAdjustments: [],
  transactions: [],
  counterparties: [],
  budgets: [],
  loans: [],
  goals: [],
  openingBalance: 0,
  openingBalanceDate: "",
  accountingEnabled: true,
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
    raw.paymentType === "daily" || raw.paymentType === "fixed"
      ? raw.paymentType
      : "hourly"
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
    // Anterior a la v9: los datos existentes no traían este campo y quedan en 0,
    // que es inofensivo porque solo se usa cuando paymentType es "fixed".
    fixedSalary: Math.max(0, num(raw.fixedSalary, 0)),
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
    // Antes de la v7 no se registraba lo cobrado: los préstamos existentes
    // arrancan sin historial y siguen usando la cuota teórica, que es
    // exactamente lo que hacían hasta ahora.
    charges: normalizeCharges(raw.charges),
    notes: str(raw.notes),
    active: bool(raw.active, true),
  }
}

function normalizeAdjustment(
  raw: any,
  employeeIds: Set<string>,
): PayrollAdjustment | null {
  if (!raw || typeof raw !== "object") return null
  const employeeId = str(raw.employeeId)
  if (!employeeIds.has(employeeId)) return null
  const periodKey = /^\d{4}-\d{2}-[12]$/.test(str(raw.periodKey))
    ? str(raw.periodKey)
    : ""
  if (!periodKey) return null
  const amount = Math.max(0, num(raw.amount, 0))
  if (amount <= 0) return null
  const kind: PayrollAdjustmentKind =
    raw.kind === "descuento" ? "descuento" : "bono"
  return {
    id: str(raw.id) || crypto.randomUUID(),
    employeeId,
    periodKey,
    kind,
    amount,
    note: str(raw.note).trim(),
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt
        ? raw.createdAt
        : new Date().toISOString(),
  }
}

function normalizeCharges(raw: any): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const charges: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-[12]$/.test(key)) continue
    const amount = num(value, -1)
    if (amount >= 0) charges[key] = amount
  }
  return charges
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
    ? raw.closedPeriods
        .filter(
          (c: any) =>
            c &&
            typeof c === "object" &&
            typeof c.key === "string" &&
            Array.isArray(c.summaries),
        )
        // Las planillas congeladas antes de existir los ajustes manuales no
        // traen el campo: sin este relleno los totales de los reportes salen
        // como NaN en cuanto se suma una quincena vieja.
        .map((c: any) => ({
          ...c,
          summaries: c.summaries.map((s: any) => ({
            ...s,
            manualAdjustment: Number.isFinite(s?.manualAdjustment)
              ? s.manualAdjustment
              : 0,
            // Antes de separarse las horas extra del salario, el neto ya las
            // incluía: para esas planillas el neto ES lo que se pagó.
            totalPay: Number.isFinite(s?.totalPay) ? s.totalPay : s?.netSalary,
          })),
        }))
    : []

  const manualAdjustments: PayrollAdjustment[] = Array.isArray(
    raw.manualAdjustments,
  )
    ? raw.manualAdjustments
        .map((a: any) => normalizeAdjustment(a, employeeIds))
        .filter(
          (a: PayrollAdjustment | null): a is PayrollAdjustment => a !== null,
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
    manualAdjustments,
    transactions,
    counterparties,
    budgets,
    loans,
    goals,
    openingBalance: num(raw.openingBalance, 0),
    openingBalanceDate: DATE_RE.test(str(raw.openingBalanceDate))
      ? raw.openingBalanceDate
      : "",
    // Los datos anteriores a la v8 se crearon con la contabilidad visible;
    // apagarla sola al actualizar escondería movimientos ya registrados.
    accountingEnabled: bool(raw.accountingEnabled, true),
    theme,
    companyName: str(raw.companyName),
    version: DATA_VERSION,
  }
}

/* ==================================================================== */
/* Perfiles                                                             */
/* ==================================================================== */

/**
 * Cada empresa vive en su propio perfil, con colaboradores, planillas y
 * contabilidad completamente separados.
 *
 * El índice se guarda aparte de los datos, y cada perfil en su propia clave.
 * Un único blob con todo obligaría a reescribir la empresa B —adjuntos
 * incluidos— cada vez que se teclea una hora en la empresa A.
 */
const INDEX_KEY = "planilla_profiles"
const DATA_PREFIX = "planilla_data_"

export interface ProfileMeta {
  id: string
  /** Copia del `companyName` del perfil, para poder listarlos sin abrirlos. */
  name: string
}

export interface ProfileIndex {
  activeId: string
  profiles: ProfileMeta[]
}

/** Cómo se muestra un perfil que todavía no tiene nombre de empresa. */
export function profileLabel(meta: ProfileMeta | undefined): string {
  return meta?.name?.trim() || "Sin nombre"
}

function dataKey(id: string): string {
  return DATA_PREFIX + id
}

function newProfileId(): string {
  return crypto.randomUUID()
}

function readIndex(): ProfileIndex | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
      return null
    }
    const profiles: ProfileMeta[] = parsed.profiles
      .filter((p: any) => p && typeof p.id === "string" && p.id)
      .map((p: any) => ({ id: p.id, name: str(p.name) }))
    if (profiles.length === 0) return null
    const activeId = profiles.some((p) => p.id === parsed.activeId)
      ? parsed.activeId
      : profiles[0].id
    return { activeId, profiles }
  } catch {
    return null
  }
}

export function saveIndex(index: ProfileIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch (err) {
    console.error("No se pudo guardar el índice de perfiles", err)
  }
}

/**
 * Índice de perfiles, creándolo si hace falta.
 *
 * La primera vez migra los datos de la versión sin perfiles: se convierten en
 * el primer perfil en vez de perderse. La clave antigua se conserva hasta que
 * el traslado se confirma, para no dejar al usuario sin nada si el `setItem`
 * falla por cuota.
 */
export function loadIndex(): ProfileIndex {
  const existing = readIndex()
  if (existing) return existing

  const id = newProfileId()
  let initial: AppData = { ...defaultData }

  try {
    const legacy = localStorage.getItem(STORAGE_KEY)
    if (legacy) {
      initial = normalizeData(JSON.parse(legacy))
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch (err) {
    console.error("No se pudo migrar los datos al primer perfil", err)
  }

  // Todo perfil del índice tiene su entrada de datos desde el principio, venga
  // de una migración o de una instalación nueva. Dejarla para el primer
  // guardado abriría un hueco donde el índice apunta a algo que no existe.
  saveProfileData(id, initial)

  const index: ProfileIndex = {
    activeId: id,
    profiles: [{ id, name: initial.companyName }],
  }
  saveIndex(index)
  return index
}

export function loadProfileData(id: string): AppData {
  try {
    const raw = localStorage.getItem(dataKey(id))
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
export function saveProfileData(id: string, data: AppData): boolean {
  try {
    localStorage.setItem(dataKey(id), JSON.stringify(data))
    return true
  } catch (err) {
    console.error("No se pudo guardar en localStorage", err)
    return false
  }
}

/** El nombre del perfil sigue al de la empresa: es el mismo dato. */
export function syncProfileName(
  index: ProfileIndex,
  id: string,
  companyName: string,
): ProfileIndex | null {
  const meta = index.profiles.find((p) => p.id === id)
  if (!meta || meta.name === companyName) return null
  const next: ProfileIndex = {
    ...index,
    profiles: index.profiles.map((p) =>
      p.id === id ? { ...p, name: companyName } : p,
    ),
  }
  saveIndex(next)
  return next
}

export interface CreatedProfile {
  index: ProfileIndex
  data: AppData
  id: string
}

/** Crea un perfil vacío y lo deja activo. */
export function createProfile(
  index: ProfileIndex,
  name: string,
): CreatedProfile {
  const id = newProfileId()
  const data: AppData = { ...defaultData, companyName: name.trim() }
  saveProfileData(id, data)
  const next: ProfileIndex = {
    activeId: id,
    profiles: [...index.profiles, { id, name: name.trim() }],
  }
  saveIndex(next)
  return { index: next, data, id }
}

/**
 * Crea un perfil con datos ya existentes —una empresa bajada de la nube— y lo
 * deja activo.
 */
export function createProfileWithData(
  index: ProfileIndex,
  data: AppData,
): CreatedProfile {
  const id = newProfileId()
  saveProfileData(id, data)
  const next: ProfileIndex = {
    activeId: id,
    profiles: [...index.profiles, { id, name: data.companyName }],
  }
  saveIndex(next)
  return { index: next, data, id }
}

/**
 * Borra un perfil y sus datos. Nunca borra el último: la aplicación necesita
 * al menos uno, y quedarse sin ninguno dejaría un estado irrecuperable.
 */
export function deleteProfile(
  index: ProfileIndex,
  id: string,
): ProfileIndex | null {
  if (index.profiles.length <= 1) return null
  const remaining = index.profiles.filter((p) => p.id !== id)
  if (remaining.length === index.profiles.length) return null

  try {
    localStorage.removeItem(dataKey(id))
  } catch (err) {
    console.error("No se pudo borrar los datos del perfil", err)
  }

  const next: ProfileIndex = {
    activeId: index.activeId === id ? remaining[0].id : index.activeId,
    profiles: remaining,
  }
  saveIndex(next)
  return next
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

export interface MergePreview {
  newEmployees: number
  updatedEmployees: number
  newEntries: number
  updatedEntries: number
  newAdjustments: number
  newClosedPeriods: number
  skippedClosedPeriods: number
  newTransactions: number
  newCounterparties: number
  newBudgets: number
  newLoans: number
  newGoals: number
}

function mergeById<T extends { id: string }>(
  current: T[],
  incoming: T[],
): { merged: T[]; added: number; updated: number } {
  const map = new Map(current.map((x) => [x.id, x]))
  let added = 0
  let updated = 0
  for (const item of incoming) {
    if (map.has(item.id)) updated++
    else added++
    map.set(item.id, item)
  }
  return { merged: [...map.values()], added, updated }
}

/**
 * Combina un respaldo importado con los datos actuales en vez de
 * reemplazarlos: así se puede cargar el archivo de un tercer colaborador sin
 * borrar lo ya cargado de los primeros dos. Las quincenas cerradas nunca se
 * pisan (son montos ya pagados); todo lo demás se identifica por `id`, salvo
 * los registros diarios, que se identifican por colaborador + fecha porque
 * dos archivos distintos generan ids distintos para "el mismo día".
 */
export function mergeAppData(
  current: AppData,
  incoming: AppData,
): { data: AppData; preview: MergePreview } {
  const employees = mergeById(current.employees, incoming.employees)

  const entryKey = (e: TimeEntry) => `${e.employeeId}__${e.date}`
  const entryMap = new Map(current.timeEntries.map((e) => [entryKey(e), e]))
  let newEntries = 0
  let updatedEntries = 0
  for (const e of incoming.timeEntries) {
    const k = entryKey(e)
    if (entryMap.has(k)) updatedEntries++
    else newEntries++
    entryMap.set(k, e)
  }

  const adjustments = mergeById(
    current.manualAdjustments,
    incoming.manualAdjustments,
  )

  const closedMap = new Map(current.closedPeriods.map((c) => [c.key, c]))
  let newClosedPeriods = 0
  let skippedClosedPeriods = 0
  for (const c of incoming.closedPeriods) {
    if (closedMap.has(c.key)) {
      skippedClosedPeriods++
    } else {
      closedMap.set(c.key, c)
      newClosedPeriods++
    }
  }

  const transactions = mergeById(current.transactions, incoming.transactions)
  const counterparties = mergeById(
    current.counterparties,
    incoming.counterparties,
  )
  const budgets = mergeById(current.budgets, incoming.budgets)
  const loans = mergeById(current.loans, incoming.loans)
  const goals = mergeById(current.goals, incoming.goals)

  const data: AppData = {
    ...current,
    employees: employees.merged,
    timeEntries: [...entryMap.values()],
    manualAdjustments: adjustments.merged,
    closedPeriods: [...closedMap.values()],
    transactions: transactions.merged,
    counterparties: counterparties.merged,
    budgets: budgets.merged,
    loans: loans.merged,
    goals: goals.merged,
  }

  const preview: MergePreview = {
    newEmployees: employees.added,
    updatedEmployees: employees.updated,
    newEntries,
    updatedEntries,
    newAdjustments: adjustments.added + adjustments.updated,
    newClosedPeriods,
    skippedClosedPeriods,
    newTransactions: transactions.added,
    newCounterparties: counterparties.added,
    newBudgets: budgets.added,
    newLoans: loans.added,
    newGoals: goals.added,
  }

  return { data, preview }
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
