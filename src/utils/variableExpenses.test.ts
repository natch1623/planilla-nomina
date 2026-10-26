import { describe, expect, it } from "vitest"
import type { DailyExpense, SupplierPayment } from "../types"
import { defaultData, mergeAppData, normalizeData } from "../store"
import {
  breakdown,
  dailyCategoryOptions,
  dailyTransaction,
  groupByDay,
  inMonth,
  itbmsFromTotal,
  lastDaily,
  removeRecordTransactions,
  rucText,
  supplierDirectory,
  supplierTransaction,
  syncRecordTransaction,
} from "./variableExpenses"

const daily = (date: string, amount: number, over: Partial<DailyExpense> = {}): DailyExpense => ({
  id: `${date}-${amount}`,
  date,
  category: "Gasolina",
  amount,
  paymentMethod: "efectivo",
  paidBy: "",
  notes: "",
  attachments: [],
  transactionId: "",
  createdAt: `${date}T10:00:00.000Z`,
  ...over,
})

const supplier = (date: string, name: string, over: Partial<SupplierPayment> = {}): SupplierPayment => ({
  id: `${date}-${name}`,
  date,
  supplierName: name,
  taxId: "",
  dv: "",
  concept: "",
  invoiceNumber: "",
  amount: 100,
  itbms: 0,
  paymentMethod: "transferencia",
  notes: "",
  attachments: [],
  transactionId: "",
  createdAt: `${date}T10:00:00.000Z`,
  ...over,
})

describe("gastos del día a día", () => {
  const list = [
    daily("2026-10-25", 20),
    daily("2026-10-25", 8, { category: "comida", createdAt: "2026-10-25T15:00:00.000Z" }),
    daily("2026-10-26", 25),
    daily("2026-09-30", 40),
  ]

  it("filtra el mes y agrupa por día, lo más reciente arriba", () => {
    const groups = groupByDay(inMonth(list, "2026-10"))
    expect(groups.map((g) => [g.date, g.total, g.items.length])).toEqual([
      ["2026-10-26", 25, 1],
      ["2026-10-25", 28, 2],
    ])
    // Dentro del día, el último anotado primero.
    expect(groups[1].items[0].category).toBe("comida")
  })

  it("suma por tipo sin importar mayúsculas", () => {
    const b = breakdown(
      [...inMonth(list, "2026-10"), daily("2026-10-27", 5, { category: "Comida" })],
      (x) => x.category,
    )
    expect(b).toEqual([
      { key: "Gasolina", total: 45, count: 2 },
      { key: "comida", total: 13, count: 2 },
    ])
  })

  it("repetir el último toma el más reciente", () => {
    expect(lastDaily(list)?.date).toBe("2026-10-26")
  })

  it("ofrece los tipos de siempre más los que ya se usaron", () => {
    const opts = dailyCategoryOptions([daily("2026-10-01", 3, { category: "Peaje" })])
    expect(opts).toContain("Gasolina")
    expect(opts[opts.length - 1]).toBe("Peaje")
  })

  it("la gasolina va a Transporte en Contabilidad", () => {
    expect(dailyTransaction(daily("2026-10-26", 25, { notes: "Pick-up" }), "t1")).toMatchObject({
      category: "Transporte",
      description: "Gasolina · Pick-up",
      amount: 25,
      type: "gasto",
      status: "pagado",
    })
  })
})

describe("pagos a empresas", () => {
  it("recuerda el RUC y DV del pago más reciente de cada empresa", () => {
    const dir = supplierDirectory([
      supplier("2026-09-01", "ACME, S.A.", { taxId: "111-1-111", dv: "10" }),
      supplier("2026-10-01", "acme, s.a.", { taxId: "111-1-111", dv: "11" }),
      supplier("2026-10-02", "Ferretería", { taxId: "8-123-456" }),
    ])
    expect(dir).toEqual([
      { supplierName: "acme, s.a.", taxId: "111-1-111", dv: "11" },
      { supplierName: "Ferretería", taxId: "8-123-456", dv: "" },
    ])
  })

  it("calcula el ITBMS incluido en el total", () => {
    expect(itbmsFromTotal(107)).toBe(7)
    expect(itbmsFromTotal(0)).toBe(0)
  })

  it("muestra el RUC con su DV", () => {
    expect(rucText("155596713-2-2015", "59")).toBe("155596713-2-2015 DV 59")
    expect(rucText("8-123-456", "")).toBe("8-123-456")
    expect(rucText("", "5")).toBe("")
  })

  it("describe el pago en Contabilidad con empresa, concepto y factura", () => {
    const t = supplierTransaction(
      supplier("2026-10-02", "Ferretería", { concept: "Tornillos", invoiceNumber: "F-12" }),
      "t1",
    )
    expect(t.description).toBe("Ferretería · Tornillos · Factura F-12")
  })
})

describe("anotar en Contabilidad", () => {
  const ids = () => {
    let n = 0
    return () => `tx${++n}`
  }

  it("crea el movimiento solo si la lista se anota, y lo actualiza al corregir", () => {
    const off = syncRecordTransaction(daily("2026-10-26", 25), false, dailyTransaction, [], ids())
    expect(off.transactions).toEqual([])

    const on = syncRecordTransaction(daily("2026-10-26", 25), true, dailyTransaction, [], ids())
    expect(on.record.transactionId).toBe("tx1")
    const recat = on.transactions.map((t) => ({ ...t, category: "Otros gastos" }))
    const again = syncRecordTransaction({ ...on.record, amount: 30 }, true, dailyTransaction, recat, ids())
    expect(again.transactions).toHaveLength(1)
    expect(again.transactions[0]).toMatchObject({ amount: 30, category: "Otros gastos" })
    expect(removeRecordTransactions([again.record], again.transactions)).toEqual([])
  })
})

describe("guardado", () => {
  it("los datos anteriores llegan sin estas listas", () => {
    const out = normalizeData({ employees: [], timeEntries: [] })
    expect(out.dailyExpenses).toEqual([])
    expect(out.supplierPayments).toEqual([])
    expect(out.expenseSettings).toEqual({ dailyToAccounting: false, suppliersToAccounting: false })
  })

  it("descarta registros sin fecha, monto o empresa, y limita el ITBMS al total", () => {
    const out = normalizeData({
      ...defaultData,
      dailyExpenses: [daily("2026-10-26", 0), daily("fecha", 5), daily("2026-10-26", 5)],
      supplierPayments: [
        supplier("2026-10-26", " "),
        supplier("2026-10-26", "ACME", { amount: 10, itbms: 50 }),
      ],
    })
    expect(out.dailyExpenses).toHaveLength(1)
    expect(out.supplierPayments).toHaveLength(1)
    expect(out.supplierPayments[0].itbms).toBe(10)
  })

  it("fusiona por id sin duplicar", () => {
    const a = { ...defaultData, dailyExpenses: [daily("2026-10-26", 25)] }
    const b = { ...defaultData, dailyExpenses: [daily("2026-10-26", 25), daily("2026-10-27", 9)] }
    expect(mergeAppData(a, b).data.dailyExpenses).toHaveLength(2)
  })
})
