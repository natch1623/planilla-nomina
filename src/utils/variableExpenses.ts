import type { DailyExpense, SupplierPayment, Transaction } from "../types"

/**
 * Gastos que no se repiten con fecha fija: los del día a día (gasolina,
 * comida) y los pagos a empresas. Se ven por mes, agrupados por día.
 */

/** Los más comunes; se pueden escribir otros. */
export const DAILY_CATEGORIES = [
  "Gasolina",
  "Comida",
  "Transporte",
  "Materiales",
  "Mantenimiento",
  "Otros",
]

/** ITBMS de Panamá sobre compras en general. */
export const ITBMS_RATE = 0.07

const round2 = (n: number) => Math.round(n * 100) / 100

/** El ITBMS que viene incluido en un total: total − total / 1.07. */
export function itbmsFromTotal(total: number, rate = ITBMS_RATE): number {
  return total > 0 ? round2(total - total / (1 + rate)) : 0
}

export const sameText = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/* ------------------------------------------------------------ Listas */

export function inMonth<T extends { date: string }>(list: T[], month: string): T[] {
  return list.filter((x) => x.date.startsWith(`${month}-`))
}

export interface DayGroup<T> {
  date: string
  items: T[]
  total: number
}

/** Agrupados por día, del más reciente al más viejo; dentro del día, el último anotado arriba. */
export function groupByDay<T extends { date: string; amount: number; createdAt: string }>(
  list: T[],
): DayGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const x of list) map.set(x.date, [...(map.get(x.date) ?? []), x])
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({
      date,
      items: [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      total: round2(items.reduce((s, x) => s + x.amount, 0)),
    }))
}

export interface Breakdown {
  key: string
  total: number
  count: number
}

/**
 * Totales por tipo de gasto o por empresa, de mayor a menor. Agrupa sin
 * importar mayúsculas: "gasolina" y "Gasolina" son lo mismo.
 */
export function breakdown<T extends { amount: number }>(
  list: T[],
  keyOf: (x: T) => string,
): Breakdown[] {
  const map = new Map<string, Breakdown>()
  for (const x of list) {
    const label = keyOf(x).trim()
    const k = label.toLowerCase()
    const b = map.get(k) ?? { key: label, total: 0, count: 0 }
    b.total = round2(b.total + x.amount)
    b.count++
    map.set(k, b)
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
}

/** El último gasto del día a día anotado: lo que "Repetir el último" copia. */
export function lastDaily(list: DailyExpense[]): DailyExpense | undefined {
  return [...list].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  )[0]
}

/** Tipos para elegir: los de siempre más los que ya se usaron. */
export function dailyCategoryOptions(list: DailyExpense[]): string[] {
  const out = [...DAILY_CATEGORIES]
  for (const b of breakdown(list, (x) => x.category)) {
    if (!out.some((c) => sameText(c, b.key))) out.push(b.key)
  }
  return out
}

/** Nombres para "quién lo pagó", de los ya usados. */
export function payerOptions(list: DailyExpense[]): string[] {
  return breakdown(
    list.filter((x) => x.paidBy.trim()),
    (x) => x.paidBy,
  ).map((b) => b.key)
}

export interface SupplierInfo {
  supplierName: string
  taxId: string
  dv: string
}

/**
 * Empresas a las que ya se les pagó, con el RUC y DV del pago más reciente:
 * al escribir el nombre se completan solos y no hay que buscarlos en la
 * factura cada vez.
 */
export function supplierDirectory(list: SupplierPayment[]): SupplierInfo[] {
  const map = new Map<string, SupplierPayment>()
  for (const p of list) {
    const k = p.supplierName.trim().toLowerCase()
    const prev = map.get(k)
    if (!prev || `${p.date}${p.createdAt}` > `${prev.date}${prev.createdAt}`) map.set(k, p)
  }
  return [...map.values()]
    .map(({ supplierName, taxId, dv }) => ({ supplierName, taxId, dv }))
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName))
}

/** "155596713-2-2015 DV 59" o lo que haya; '' sin RUC. */
export function rucText(taxId: string, dv: string): string {
  if (!taxId) return ""
  return dv ? `${taxId} DV ${dv}` : taxId
}

/* --------------------------------------------------------- Contabilidad */

/** A qué categoría de Contabilidad va cada tipo del día a día. */
function dailyAccountingCategory(category: string): string {
  const c = category.trim().toLowerCase()
  if (c === "gasolina" || c === "transporte") return "Transporte"
  if (c === "materiales") return "Suministros"
  if (c === "mantenimiento") return "Mantenimiento"
  return "Otros gastos"
}

export function dailyTransaction(e: DailyExpense, id: string): Transaction {
  return {
    id,
    date: e.date,
    dueDate: "",
    type: "gasto",
    status: "pagado",
    category: dailyAccountingCategory(e.category),
    description: [e.category, e.notes].filter(Boolean).join(" · "),
    amount: e.amount,
    recurrence: "ninguna",
    paymentMethod: e.paymentMethod,
    counterpartyId: "",
    tags: ["Gastos", "Del día a día"],
    attachments: [],
  }
}

export function supplierTransaction(p: SupplierPayment, id: string): Transaction {
  return {
    id,
    date: p.date,
    dueDate: "",
    type: "gasto",
    status: "pagado",
    category: "Otros gastos",
    description: [
      p.supplierName,
      p.concept,
      p.invoiceNumber && `Factura ${p.invoiceNumber}`,
    ]
      .filter(Boolean)
      .join(" · "),
    amount: p.amount,
    recurrence: "ninguna",
    paymentMethod: p.paymentMethod,
    counterpartyId: "",
    tags: ["Gastos", "Pagos a empresas"],
    attachments: [],
  }
}

/**
 * Deja Contabilidad al día con un gasto guardado: si ya tenía su movimiento
 * lo actualiza —respetando la categoría y etiquetas que se hayan cambiado
 * en Movimientos—; si no, lo crea cuando la lista se anota en Contabilidad.
 */
export function syncRecordTransaction<T extends { transactionId: string }>(
  record: T,
  enabled: boolean,
  build: (record: T, id: string) => Transaction,
  transactions: Transaction[],
  newId: () => string,
): { record: T; transactions: Transaction[] } {
  const existing = record.transactionId
    ? transactions.find((t) => t.id === record.transactionId)
    : undefined
  if (existing) {
    const { date, amount, paymentMethod, description } = build(record, existing.id)
    return {
      record,
      transactions: transactions.map((t) =>
        t.id === existing.id ? { ...t, date, amount, paymentMethod, description } : t,
      ),
    }
  }
  if (!enabled) return { record: { ...record, transactionId: "" }, transactions }
  const id = newId()
  return {
    record: { ...record, transactionId: id },
    transactions: [...transactions, build(record, id)],
  }
}

/** Quita de Contabilidad los movimientos de gastos que se borraron. */
export function removeRecordTransactions(
  removed: { transactionId: string }[],
  transactions: Transaction[],
): Transaction[] {
  const ids = new Set(removed.map((r) => r.transactionId).filter(Boolean))
  return ids.size ? transactions.filter((t) => !ids.has(t.id)) : transactions
}
