import type {
  AppData,
  ClosedPeriod,
  DayType,
  Employee,
  PayPeriod,
  TimeEntry,
} from "./types"

const STORAGE_KEY = "planilla_data"
const DATA_VERSION = 2

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
  return {
    id: str(raw.id) || crypto.randomUUID(),
    name,
    idNumber: str(raw.idNumber),
    position: str(raw.position),
    startDate: str(raw.startDate),
    category,
    hourlyRate: Math.max(0, num(raw.hourlyRate, 0)),
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

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

export function saveData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.error("No se pudo guardar en localStorage", err)
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

export function periodLabel(period: PayPeriod, short = false): string {
  const month = short
    ? MONTHS_ES[period.month - 1].slice(0, 3)
    : MONTHS_ES[period.month - 1]
  return `${month} ${period.year} · Q${period.half}`
}

/** Avanza o retrocede quincenas, cruzando meses y años. */
export function shiftPeriod(period: PayPeriod, delta: number): PayPeriod {
  // Cada período son 2 mitades: se calcula todo en "índice de quincena absoluto".
  const index =
    period.year * 24 + (period.month - 1) * 2 + (period.half - 1) + delta
  const year = Math.floor(index / 24)
  const rest = index - year * 24
  return {
    year,
    month: Math.floor(rest / 2) + 1,
    half: (rest % 2 === 0 ? 1 : 2) as 1 | 2,
  }
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
