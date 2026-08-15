import type {
  AppData,
  PayPeriod,
  PaymentMethod,
  Recurrence,
  Transaction,
  TransactionType,
} from "../types"
import {
  calcPeriodSummaries,
  calcTotals,
  type PayrollRules,
} from "./calculations"
import { getPeriodDates, periodKey } from "../store"
import { todayISO } from "./dates"

/* ------------------------------------------------------- Catálogos */

export const EXPENSE_CATEGORIES = [
  "Alquiler",
  "Servicios públicos",
  "Suministros",
  "Mercadería / Inventario",
  "Transporte",
  "Impuestos",
  "Mantenimiento",
  "Marketing",
  "Seguros",
  "Honorarios profesionales",
  "Otros gastos",
]

export const INCOME_CATEGORIES = [
  "Ventas",
  "Servicios prestados",
  "Consultoría",
  "Alquileres cobrados",
  "Otros ingresos",
]

export function categoriesFor(type: TransactionType): string[] {
  return type === "ingreso" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cheque: "Cheque",
  otro: "Otro",
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  ninguna: "No se repite",
  semanal: "Cada semana",
  quincenal: "Cada quincena",
  mensual: "Cada mes",
  anual: "Cada año",
}

/* ------------------------------------------------------ Meses */

/** `2026-07-31` → `2026-07` */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

const MONTHS_SHORT = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
]

/** `2026-07` → `Jul 2026` */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number)
  return `${MONTHS_SHORT[m - 1]} ${y}`
}

export function currentMonthKey(): string {
  return monthKey(todayISO())
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number)
  const index = y * 12 + (m - 1) + delta
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, "0")}`
}

/** Diferencia en meses entre dos claves `YYYY-MM` (b − a). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number)
  const [by, bm] = b.split("-").map(Number)
  return (by - ay) * 12 + (bm - am)
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  const n = monthsBetween(from, to)
  for (let i = 0; i <= n; i++) out.push(addMonths(from, i))
  return out
}

/** Último día del mes de una clave `YYYY-MM`, como `YYYY-MM-DD`. */
export function monthEnd(key: string): string {
  const [y, m] = key.split("-").map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${key}-${String(last).padStart(2, "0")}`
}

export function monthStart(key: string): string {
  return `${key}-01`
}

/* ------------------------------------------------- Recurrencias */

function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`
}

/** La fecha en la que el dinero se mueve: el vencimiento manda sobre el devengo. */
export function cashDate(tx: Transaction): string {
  return tx.dueDate || tx.date
}

/**
 * Cuántas veces cae un movimiento recurrente dentro de un mes dado.
 *
 * Se enumeran las fechas reales en vez de usar un promedio (4.33 semanas al
 * mes): así un gasto semanal cae 5 veces en los meses que de verdad tienen 5
 * ocurrencias, y la proyección no arrastra un sesgo constante.
 */
export function occurrencesInMonth(tx: Transaction, key: string): number {
  if (tx.recurrence === "ninguna") return 0

  const from = cashDate(tx)
  const start = monthStart(key)
  const end = monthEnd(key)
  if (from > end) return 0

  if (tx.recurrence === "mensual") return 1
  if (tx.recurrence === "anual") {
    return monthsBetween(monthKey(from), key) % 12 === 0 ? 1 : 0
  }

  const step = tx.recurrence === "semanal" ? 7 : 14
  let cursor = from
  let count = 0
  // Tope de seguridad: ni el ciclo más corto puede caer 40 veces en un mes.
  for (let i = 0; i < 400 && cursor <= end; i++) {
    if (cursor >= start) count++
    cursor = addDaysISO(cursor, step)
  }
  return count
}

/** Fechas concretas en que un movimiento recurrente cae dentro de un rango. */
export function occurrenceDates(
  tx: Transaction,
  from: string,
  to: string,
): string[] {
  const out: string[] = []
  const base = cashDate(tx)

  if (tx.recurrence === "ninguna") {
    if (base >= from && base <= to) out.push(base)
    return out
  }

  if (tx.recurrence === "mensual" || tx.recurrence === "anual") {
    const stepMonths = tx.recurrence === "mensual" ? 1 : 12
    const day = base.slice(8)
    let key = monthKey(base)
    for (let i = 0; i < 400; i++) {
      const end = monthEnd(key)
      // Un cobro fijado el día 31 cae el último día en los meses más cortos.
      const candidate = `${key}-${day}` > end ? end : `${key}-${day}`
      if (candidate > to) break
      if (candidate >= from) out.push(candidate)
      key = addMonths(key, stepMonths)
    }
    return out
  }

  const step = tx.recurrence === "semanal" ? 7 : 14
  let cursor = base
  for (let i = 0; i < 1000 && cursor <= to; i++) {
    if (cursor >= from) out.push(cursor)
    cursor = addDaysISO(cursor, step)
  }
  return out
}

/* ------------------------------------------------------- Nómina */

/** Neto pagado de una quincena, usando la foto congelada si ya se cerró. */
function periodNetCost(
  period: PayPeriod,
  data: AppData,
  rules: PayrollRules,
): number {
  const key = periodKey(period)
  const closed = data.closedPeriods.find((c) => c.key === key)
  if (closed) return calcTotals(closed.summaries).totalPay
  const summaries = calcPeriodSummaries(
    data.employees,
    data.timeEntries,
    period,
    rules,
    data.loans,
    data.manualAdjustments,
  )
  return calcTotals(summaries).totalPay
}

/** Costo de nómina (neto pagado) de un mes calendario: sus dos quincenas. */
export function payrollCostForMonth(
  key: string,
  data: AppData,
  rules: PayrollRules,
): number {
  const [year, month] = key.split("-").map(Number)
  return (
    periodNetCost({ year, month, half: 1 }, data, rules) +
    periodNetCost({ year, month, half: 2 }, data, rules)
  )
}

/** Nómina ya devengada hasta hoy: solo las quincenas que ya terminaron. */
export function payrollPaidThrough(
  data: AppData,
  rules: PayrollRules,
  today = todayISO(),
): number {
  const seen = new Set<string>()
  let total = 0
  for (const entry of data.timeEntries) {
    const [y, m] = entry.date.split("-").map(Number)
    const day = Number(entry.date.slice(8))
    const period: PayPeriod = { year: y, month: m, half: day <= 15 ? 1 : 2 }
    const key = periodKey(period)
    if (seen.has(key)) continue
    seen.add(key)
    // Solo cuenta como salida real la quincena que ya cerró en el calendario.
    if (getPeriodDates(period).end <= today) {
      total += periodNetCost(period, data, rules)
    }
  }
  return total
}

/** Nómina de quincenas en curso o futuras: dinero comprometido, aún no pagado. */
export function payrollCommitted(
  data: AppData,
  rules: PayrollRules,
  today = todayISO(),
): number {
  const seen = new Set<string>()
  let total = 0
  for (const entry of data.timeEntries) {
    const [y, m] = entry.date.split("-").map(Number)
    const day = Number(entry.date.slice(8))
    const period: PayPeriod = { year: y, month: m, half: day <= 15 ? 1 : 2 }
    const key = periodKey(period)
    if (seen.has(key)) continue
    seen.add(key)
    if (getPeriodDates(period).end > today) {
      total += periodNetCost(period, data, rules)
    }
  }
  return total
}

/* --------------------------------------------------- Serie mensual */

export interface MonthSummary {
  key: string
  label: string
  /** Devengado: todo lo facturado del mes, cobrado o no. */
  ingresos: number
  /** Solo lo efectivamente cobrado. */
  ingresosCobrados: number
  gastosManual: number
  gastosManualPagados: number
  gastosNomina: number
  gastosTotal: number
  /** Utilidad contable: ingresos − gastos, sin importar si se cobró. */
  balance: number
  /** Flujo real de caja del mes. */
  flujoNeto: number
  projected: boolean
}

function emptyMonth(key: string, projected = false): MonthSummary {
  return {
    key,
    label: monthLabel(key),
    ingresos: 0,
    ingresosCobrados: 0,
    gastosManual: 0,
    gastosManualPagados: 0,
    gastosNomina: 0,
    gastosTotal: 0,
    balance: 0,
    flujoNeto: 0,
    projected,
  }
}

function finishMonth(m: MonthSummary): MonthSummary {
  m.gastosTotal = m.gastosManual + m.gastosNomina
  m.balance = m.ingresos - m.gastosTotal
  m.flujoNeto = m.ingresosCobrados - m.gastosManualPagados - m.gastosNomina
  return m
}

/** Serie mensual real: movimientos registrados + costo de nómina, mes a mes. */
export function buildMonthlySeries(
  data: AppData,
  rules: PayrollRules,
  monthsBack = 12,
): MonthSummary[] {
  const cur = currentMonthKey()
  const keys: string[] = []
  for (let i = monthsBack - 1; i >= 0; i--) keys.push(addMonths(cur, -i))

  return keys.map((key) => {
    const m = emptyMonth(key)
    for (const t of data.transactions) {
      if (monthKey(t.date) !== key) continue
      if (t.type === "ingreso") {
        m.ingresos += t.amount
        if (t.status === "pagado") m.ingresosCobrados += t.amount
      } else {
        m.gastosManual += t.amount
        if (t.status === "pagado") m.gastosManualPagados += t.amount
      }
    }
    m.gastosNomina = payrollCostForMonth(key, data, rules)
    return finishMonth(m)
  })
}

/* ------------------------------------------------------ Proyección */

export interface ProjectionOptions {
  monthsAhead?: number
  /** Meses recientes que se promedian para la parte no comprometida. */
  lookback?: number
}

/**
 * Proyecta meses futuros combinando tres fuentes, de la más firme a la más
 * incierta:
 *
 *  1. Compromisos ya registrados con vencimiento futuro (lo que se sabe que
 *     entra o sale sí o sí).
 *  2. Movimientos recurrentes, expandidos a sus fechas reales.
 *  3. El promedio reciente de lo que no está cubierto por 1 ni 2, para no
 *     proyectar cero en un negocio que claramente sigue operando.
 *
 * Antes solo existía (3), así que un alquiler recurrente o una factura ya
 * emitida a 60 días desaparecían de la proyección.
 */
export function projectFutureMonths(
  history: MonthSummary[],
  data: AppData,
  rules: PayrollRules,
  { monthsAhead = 6, lookback = 3 }: ProjectionOptions = {},
): MonthSummary[] {
  const today = todayISO()
  const cur = currentMonthKey()

  // Promedio de la parte "no explicada": lo puntual y no recurrente.
  const sample = history
    .filter((m) => m.key < cur)
    .filter((m) => m.ingresos > 0 || m.gastosManual > 0 || m.gastosNomina > 0)
    .slice(-lookback)

  const avg = (pick: (m: MonthSummary) => number) =>
    sample.length ? sample.reduce((a, m) => a + pick(m), 0) / sample.length : 0

  const recurring = data.transactions.filter((t) => t.recurrence !== "ninguna")
  const recurringMonthly = (type: TransactionType, key: string) =>
    recurring
      .filter((t) => t.type === type)
      .reduce((sum, t) => sum + t.amount * occurrencesInMonth(t, key), 0)

  // El promedio histórico ya incluye lo recurrente que se registró; restarlo
  // evita contar dos veces el mismo alquiler.
  const recurringNow = {
    ingreso: recurringMonthly("ingreso", cur),
    gasto: recurringMonthly("gasto", cur),
  }
  const baseIngresos = Math.max(
    0,
    avg((m) => m.ingresos) - recurringNow.ingreso,
  )
  const baseGastos = Math.max(
    0,
    avg((m) => m.gastosManual) - recurringNow.gasto,
  )
  const baseNomina = avg((m) => m.gastosNomina)

  const out: MonthSummary[] = []
  for (let i = 1; i <= monthsAhead; i++) {
    const key = addMonths(cur, i)
    const m = emptyMonth(key, true)

    // 1. Compromisos concretos con vencimiento en ese mes.
    for (const t of data.transactions) {
      if (t.status !== "pendiente") continue
      const due = cashDate(t)
      if (due <= today || monthKey(due) !== key) continue
      if (t.type === "ingreso") m.ingresos += t.amount
      else m.gastosManual += t.amount
    }

    // 2. Recurrentes expandidos a sus fechas reales.
    m.ingresos += recurringMonthly("ingreso", key)
    m.gastosManual += recurringMonthly("gasto", key)

    // 3. Base promedio de lo puntual.
    m.ingresos += baseIngresos
    m.gastosManual += baseGastos

    const nominaReal = payrollCostForMonth(key, data, rules)
    m.gastosNomina = nominaReal > 0 ? nominaReal : baseNomina

    // Una proyección es una expectativa de caja: se asume que se cobra y paga.
    m.ingresosCobrados = m.ingresos
    m.gastosManualPagados = m.gastosManual
    out.push(finishMonth(m))
  }
  return out
}
