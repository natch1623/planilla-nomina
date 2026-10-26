import type {
  FixedExpense,
  FixedExpenseFrequency,
  FixedExpensePayment,
  Transaction,
} from "../types"
import { addMonths, monthLabel, monthsBetween } from "./accounting"
import { addDays, formatDate } from "./dates"

/**
 * Cálculos de los gastos fijos: en qué estado está cada servicio en un mes,
 * cuánto se espera que cobre y si una factura vino fuera de lo normal.
 *
 * Todo trabaja con claves de mes `YYYY-MM` y fechas `YYYY-MM-DD` en texto,
 * igual que el resto de la app, para no depender de la zona horaria.
 */

export type FixedExpenseState =
  | "pagado"
  | "vencido"
  | "por-vencer" // vence dentro de los próximos días
  | "pendiente"
  | "no-aplica" // ese mes no se cobra: antes de empezar, de baja o fuera de ciclo

export const FREQUENCY_LABEL: Record<FixedExpenseFrequency, string> = {
  1: "Mensual",
  2: "Cada 2 meses",
  3: "Cada 3 meses",
  6: "Cada 6 meses",
  12: "Una vez al año",
}

/** Días de anticipación con que un pago pendiente pasa a "por vencer". */
export const DUE_SOON_DAYS = 5

/** Cuántas facturas anteriores se promedian para estimar la siguiente. */
const AVERAGE_WINDOW = 3

/** Una factura que supera su referencia en esta proporción se señala. */
export const UNUSUAL_RATIO = 1.25

/** Cuántos meses hacia atrás se buscan pagos atrasados. */
const OVERDUE_LOOKBACK = 24

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Fecha de vencimiento del servicio en un mes; '' si no tiene día fijado. */
export function dueDateFor(expense: FixedExpense, month: string): string {
  if (!expense.dueDay) return ""
  // El día 31 en febrero vence el último día del mes, no el 3 de marzo.
  const day = Math.min(expense.dueDay, daysInMonth(month))
  return `${month}-${String(day).padStart(2, "0")}`
}

/* ------------------------------------------------------------- Pagos */

/** Pagos de un servicio en un mes, del más viejo al más nuevo. */
export function paymentsFor(
  payments: FixedExpensePayment[],
  expenseId: string,
  month: string,
): FixedExpensePayment[] {
  return payments
    .filter((p) => p.expenseId === expenseId && p.month === month)
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.createdAt.localeCompare(b.createdAt))
}

/** El pago que salda el mes (el que no es abono), si lo hay. */
export function paymentFor(
  payments: FixedExpensePayment[],
  expenseId: string,
  month: string,
): FixedExpensePayment | undefined {
  return payments.find((p) => p.expenseId === expenseId && p.month === month && !p.partial)
}

const sum = (ps: FixedExpensePayment[]) => ps.reduce((a, p) => a + p.amount, 0)

/**
 * Lo que costó cada factura saldada de un servicio antes de `month` —abonos
 * incluidos—, de la más reciente a la más vieja.
 */
function previousBills(
  payments: FixedExpensePayment[],
  expenseId: string,
  month: string,
): { month: string; total: number }[] {
  const settled = new Set(
    payments
      .filter((p) => p.expenseId === expenseId && p.month < month && !p.partial)
      .map((p) => p.month),
  )
  return [...settled]
    .sort((a, b) => b.localeCompare(a))
    .map((m) => ({ month: m, total: sum(paymentsFor(payments, expenseId, m)) }))
}

/**
 * Promedio de las últimas facturas antes de `month`, o `null` si todavía no
 * hay ninguna. Es la referencia para estimar.
 */
export function recentAverage(
  payments: FixedExpensePayment[],
  expenseId: string,
  month: string,
): number | null {
  const last = previousBills(payments, expenseId, month).slice(0, AVERAGE_WINDOW)
  if (last.length === 0) return null
  return last.reduce((a, b) => a + b.total, 0) / last.length
}

/**
 * Lo que se espera pagar en un mes sin factura todavía: el promedio de las
 * últimas facturas, y si no hay historial, el monto aproximado declarado.
 */
export function expectedAmount(
  expense: FixedExpense,
  payments: FixedExpensePayment[],
  month: string,
): number {
  return recentAverage(payments, expense.id, month) ?? expense.estimatedAmount
}

export interface Comparison {
  amount: number
  /** Contra qué se compara, para decirlo en el aviso. */
  basis: "año-pasado" | "costumbre"
}

/**
 * Con qué comparar una factura para decir si vino alta. Si hay factura del
 * mismo mes del año anterior, esa: la luz de abril se compara con la de
 * abril, porque en temporada seca el aire acondicionado la sube cada año y
 * contra los meses frescos siempre parecería un sobresalto. Si no, el
 * promedio reciente; `withEstimate` acepta además el monto aproximado (sirve
 * para avisar mientras se escribe, aunque aún no haya costumbre).
 */
export function comparisonFor(
  expense: FixedExpense,
  payments: FixedExpensePayment[],
  month: string,
  withEstimate = false,
): Comparison | null {
  const lastYear = addMonths(month, -12)
  if (paymentFor(payments, expense.id, lastYear)) {
    return { amount: sum(paymentsFor(payments, expense.id, lastYear)), basis: "año-pasado" }
  }
  const bills = previousBills(payments, expense.id, month)
  // Con una sola factura previa no hay costumbre todavía.
  if (bills.length >= 2) {
    const avg = recentAverage(payments, expense.id, month)
    if (avg) return { amount: avg, basis: "costumbre" }
  }
  if (withEstimate) {
    const expected = expectedAmount(expense, payments, month)
    if (expected > 0) return { amount: expected, basis: "costumbre" }
  }
  return null
}

/**
 * Cuánto se pasó la factura de un mes saldado de su referencia, como
 * fracción (0.4 = 40 % más), y contra qué. `null` si está dentro de lo
 * normal o no hay con qué comparar.
 */
export function unusualIncrease(
  expense: FixedExpense,
  payments: FixedExpensePayment[],
  month: string,
): { ratio: number; basis: Comparison["basis"] } | null {
  if (!paymentFor(payments, expense.id, month)) return null
  const ref = comparisonFor(expense, payments, month)
  const total = sum(paymentsFor(payments, expense.id, month))
  if (!ref || total <= ref.amount * UNUSUAL_RATIO) return null
  return { ratio: total / ref.amount - 1, basis: ref.basis }
}

/* ------------------------------------------------- Bajas y frecuencia */

/** ¿Estaba dado de baja el servicio ese mes? */
export function isPaused(expense: FixedExpense, month: string): boolean {
  return expense.pauses.some((p) => month >= p.from && (!p.to || month < p.to))
}

/**
 * ¿Llega factura ese mes? Cuenta desde el mes en que se empezó a controlar:
 * uno bimestral que empezó en enero cobra en enero, marzo, mayo…
 */
export function isBillingMonth(expense: FixedExpense, month: string): boolean {
  if (month < expense.startMonth) return false
  return monthsBetween(expense.startMonth, month) % expense.frequency === 0
}

/**
 * Da de baja un servicio. Si la factura de este mes ya se pagó, la baja
 * corre desde el siguiente: ese mes sí se cobró.
 */
export function deactivate(
  expense: FixedExpense,
  month: string,
  paidThisMonth: boolean,
): FixedExpense {
  if (!expense.active) return expense
  const from = paidThisMonth ? addMonths(month, 1) : month
  return { ...expense, active: false, pauses: [...expense.pauses, { from, to: "" }] }
}

/**
 * Vuelve a cobrarse desde `month`. Los meses de baja quedan registrados y
 * no aparecen como vencidos; una baja deshecha el mismo mes no deja rastro.
 */
export function reactivate(expense: FixedExpense, month: string): FixedExpense {
  if (expense.active) return expense
  const pauses = expense.pauses
    .map((p) => (p.to ? p : { ...p, to: month }))
    .filter((p) => p.to > p.from)
  return { ...expense, active: true, pauses }
}

/** Desde qué mes está de baja, o '' si está activo. */
export function pausedSince(expense: FixedExpense): string {
  return expense.pauses.find((p) => !p.to)?.from ?? ""
}

/* -------------------------------------------------------------- Estado */

export function stateFor(
  expense: FixedExpense,
  monthPayments: FixedExpensePayment[],
  month: string,
  today: string,
): FixedExpenseState {
  if (monthPayments.some((p) => !p.partial)) return "pagado"
  const charged =
    isBillingMonth(expense, month) && !isPaused(expense, month)
  // Un abono en un mes que no se cobra (p. ej. un adelanto) igual se muestra.
  if (!charged && monthPayments.length === 0) return "no-aplica"
  const due = dueDateFor(expense, month)
  // Sin día de vencimiento, el mes entero es el plazo.
  const deadline = due || `${month}-${String(daysInMonth(month)).padStart(2, "0")}`
  if (deadline < today) return "vencido"
  if (deadline <= addDays(today, DUE_SOON_DAYS)) return "por-vencer"
  return "pendiente"
}

export interface FixedExpenseMonthRow {
  expense: FixedExpense
  state: FixedExpenseState
  dueDate: string
  /** Todos los pagos del mes: abonos y el que lo salda. */
  payments: FixedExpensePayment[]
  /** El pago que salda el mes, si lo hay. */
  payment?: FixedExpensePayment
  /** Suma de lo pagado ese mes, abonos incluidos. */
  paid: number
  /** Si está saldado, lo pagado; si no, lo que se espera que cueste la factura. */
  amount: number
}

/**
 * Servicios del mes con su estado. Un mes que no se cobra —de baja o fuera
 * de su ciclo— no aparece, salvo que tenga pagos: su historial se respeta.
 */
export function monthRows(
  expenses: FixedExpense[],
  payments: FixedExpensePayment[],
  month: string,
  today: string,
): FixedExpenseMonthRow[] {
  const rows: FixedExpenseMonthRow[] = []
  for (const expense of expenses) {
    const monthPayments = paymentsFor(payments, expense.id, month)
    const state = stateFor(expense, monthPayments, month, today)
    if (state === "no-aplica") continue
    const payment = monthPayments.find((p) => !p.partial)
    const paid = sum(monthPayments)
    rows.push({
      expense,
      state,
      dueDate: dueDateFor(expense, month),
      payments: monthPayments,
      payment,
      paid,
      amount: payment ? paid : expectedAmount(expense, payments, month),
    })
  }
  return rows.sort(compareRows)
}

const STATE_ORDER: Record<FixedExpenseState, number> = {
  vencido: 0,
  "por-vencer": 1,
  pendiente: 2,
  pagado: 3,
  "no-aplica": 4,
}

/** Lo urgente arriba; dentro de cada grupo, por fecha de vencimiento. */
function compareRows(a: FixedExpenseMonthRow, b: FixedExpenseMonthRow): number {
  return (
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
    a.expense.name.localeCompare(b.expense.name)
  )
}

export interface FixedExpenseMonthSummary {
  paid: number // todo lo pagado en el mes, abonos incluidos
  paidCount: number // servicios saldados
  pending: number // estimado de lo que falta
  pendingCount: number
  overdueCount: number
  total: number // pagado + pendiente estimado
}

export function summarizeMonth(rows: FixedExpenseMonthRow[]): FixedExpenseMonthSummary {
  const s: FixedExpenseMonthSummary = {
    paid: 0,
    paidCount: 0,
    pending: 0,
    pendingCount: 0,
    overdueCount: 0,
    total: 0,
  }
  for (const r of rows) {
    s.paid += r.paid
    if (r.state === "pagado") {
      s.paidCount++
    } else {
      // Lo que falta es la factura esperada menos lo ya abonado.
      s.pending += Math.max(0, r.amount - r.paid)
      s.pendingCount++
      if (r.state === "vencido") s.overdueCount++
    }
  }
  s.total = s.paid + s.pending
  return s
}

export interface OverdueBill {
  expense: FixedExpense
  month: string
}

/**
 * Facturas vencidas sin saldar de cualquier mes hasta hoy, de la más vieja
 * a la más nueva. Es lo que alimenta el número de la pestaña: sin él, lo
 * atrasado solo se veía entrando y yendo mes por mes.
 */
export function overdueBills(
  expenses: FixedExpense[],
  payments: FixedExpensePayment[],
  today: string,
): OverdueBill[] {
  const current = today.slice(0, 7)
  const out: OverdueBill[] = []
  for (const expense of expenses) {
    let month = expense.startMonth
    const oldest = addMonths(current, -OVERDUE_LOOKBACK + 1)
    if (month < oldest) month = oldest
    for (; month <= current; month = addMonths(month, 1)) {
      const state = stateFor(expense, paymentsFor(payments, expense.id, month), month, today)
      if (state === "vencido") out.push({ expense, month })
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || a.expense.name.localeCompare(b.expense.name))
}

/* --------------------------------------------------------- Contabilidad */

/** Las facturas de servicios van a "Servicios públicos"; el alquiler, a la suya. */
function accountingCategory(expense: FixedExpense): string {
  return expense.name.trim().toLowerCase() === "alquiler" ? "Alquiler" : "Servicios públicos"
}

/**
 * El gasto que representa un pago en Contabilidad. Se identifica con la
 * etiqueta "Gastos fijos" y el mes en la descripción, para reconocerlo en
 * Movimientos.
 */
export function paymentTransaction(
  expense: FixedExpense,
  payment: FixedExpensePayment,
  id: string,
): Transaction {
  return {
    id,
    date: payment.paidOn,
    dueDate: "",
    type: "gasto",
    status: "pagado",
    category: accountingCategory(expense),
    description: `${expense.name} · ${monthLabel(payment.month)}${payment.partial ? " (abono)" : ""}`,
    amount: payment.amount,
    recurrence: "ninguna",
    paymentMethod: payment.paymentMethod,
    counterpartyId: "",
    tags: ["Gastos fijos"],
    attachments: [],
  }
}

/**
 * Deja Contabilidad al día con un pago guardado: actualiza su gasto si ya
 * tenía uno, o lo crea si el servicio se anota en Contabilidad. Devuelve el
 * pago con su `transactionId` y la lista de movimientos resultante.
 */
export function syncPaymentTransaction(
  expense: FixedExpense,
  payment: FixedExpensePayment,
  transactions: Transaction[],
  newId: () => string,
): { payment: FixedExpensePayment; transactions: Transaction[] } {
  const existing = payment.transactionId
    ? transactions.find((t) => t.id === payment.transactionId)
    : undefined
  if (existing) {
    const updated = { ...existing, ...pick(paymentTransaction(expense, payment, existing.id)) }
    return {
      payment,
      transactions: transactions.map((t) => (t.id === existing.id ? updated : t)),
    }
  }
  if (!expense.recordInAccounting) return { payment: { ...payment, transactionId: "" }, transactions }
  const id = newId()
  return {
    payment: { ...payment, transactionId: id },
    transactions: [...transactions, paymentTransaction(expense, payment, id)],
  }
}

/**
 * Lo que un pago decide en su gasto. El resto (etiquetas, cliente o
 * proveedor, adjuntos) se respeta si alguien lo cambió en Movimientos.
 */
function pick(t: Transaction) {
  const { date, amount, paymentMethod, description } = t
  return { date, amount, paymentMethod, description }
}

/** Quita de Contabilidad los gastos de pagos que se borraron. */
export function removePaymentTransactions(
  removed: FixedExpensePayment[],
  transactions: Transaction[],
): Transaction[] {
  const ids = new Set(removed.map((p) => p.transactionId).filter(Boolean))
  return ids.size ? transactions.filter((t) => !ids.has(t.id)) : transactions
}

/* --------------------------------------------------------------- Fechas */

/** Días de `from` a `to` (negativo si `to` ya pasó). */
export function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number)
  const [by, bm, bd] = to.split("-").map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/**
 * El vencimiento dicho respecto de hoy: "Venció hace 11 días" se entiende
 * sin sacar cuentas; "Vence el 15 oct" obliga a mirar el calendario. Lo
 * lejano sí va con fecha, porque "en 23 días" no ayuda a ubicarlo.
 * '' si el servicio no tiene día de vencimiento.
 */
export function dueText(dueDate: string, today: string): string {
  if (!dueDate) return ""
  const days = daysBetween(today, dueDate)
  if (days < -1) return `Venció hace ${-days} días`
  if (days === -1) return "Venció ayer"
  if (days === 0) return "Vence hoy"
  if (days === 1) return "Vence mañana"
  if (days <= 7) return `Vence en ${days} días`
  return `Vence el ${formatDate(dueDate).replace(/ \d{4}$/, "")}`
}

/** Los `count` meses que terminan en `lastMonth`, del más viejo al más reciente. */
export function monthsEndingAt(lastMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(lastMonth, i - count + 1))
}
