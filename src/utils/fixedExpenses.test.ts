import { describe, expect, it } from "vitest"
import type { FixedExpense, FixedExpensePayment, Transaction } from "../types"
import { defaultData, mergeAppData, normalizeData } from "../store"
import {
  comparisonFor,
  daysBetween,
  deactivate,
  dueDateFor,
  dueText,
  expectedAmount,
  isBillingMonth,
  monthRows,
  monthsEndingAt,
  overdueBills,
  reactivate,
  removePaymentTransactions,
  stateFor,
  summarizeMonth,
  syncPaymentTransaction,
  unusualIncrease,
} from "./fixedExpenses"

const expense = (over: Partial<FixedExpense> = {}): FixedExpense => ({
  id: "luz",
  name: "Luz",
  provider: "",
  accountNumber: "",
  estimatedAmount: 80,
  dueDay: 15,
  frequency: 1,
  recordInAccounting: false,
  startMonth: "2026-01",
  notes: "",
  active: true,
  pauses: [],
  ...over,
})

const pay = (
  month: string,
  amount: number,
  expenseId = "luz",
  over: Partial<FixedExpensePayment> = {},
): FixedExpensePayment => ({
  id: `${expenseId}-${month}${over.partial ? `-a${amount}` : ""}`,
  expenseId,
  month,
  amount,
  partial: false,
  transactionId: "",
  paidOn: `${month}-10`,
  paymentMethod: "transferencia",
  reference: "",
  notes: "",
  attachments: [],
  createdAt: "",
  ...over,
})

const abono = (month: string, amount: number) => pay(month, amount, "luz", { partial: true })

describe("vencimiento de un gasto fijo", () => {
  it("usa el último día en los meses más cortos", () => {
    expect(dueDateFor(expense({ dueDay: 31 }), "2026-02")).toBe("2026-02-28")
    expect(dueDateFor(expense({ dueDay: 31 }), "2028-02")).toBe("2028-02-29")
    expect(dueDateFor(expense({ dueDay: 0 }), "2026-02")).toBe("")
  })

  it("pasa de pendiente a por vencer y a vencido", () => {
    const e = expense()
    expect(stateFor(e, [], "2026-10", "2026-10-01")).toBe("pendiente")
    expect(stateFor(e, [], "2026-10", "2026-10-12")).toBe("por-vencer")
    expect(stateFor(e, [], "2026-10", "2026-10-15")).toBe("por-vencer")
    expect(stateFor(e, [], "2026-10", "2026-10-16")).toBe("vencido")
    expect(stateFor(e, [pay("2026-10", 90)], "2026-10", "2026-10-30")).toBe("pagado")
  })

  it("sin día fijado, el plazo es el mes entero", () => {
    const e = expense({ dueDay: 0 })
    expect(stateFor(e, [], "2026-10", "2026-10-20")).toBe("pendiente")
    expect(stateFor(e, [], "2026-10", "2026-10-28")).toBe("por-vencer")
    expect(stateFor(e, [], "2026-10", "2026-11-01")).toBe("vencido")
  })

  it("no reclama meses anteriores a cuando se empezó a controlar", () => {
    const e = expense({ startMonth: "2026-10" })
    expect(stateFor(e, [], "2026-09", "2026-10-20")).toBe("no-aplica")
    expect(monthRows([e], [], "2026-09", "2026-10-20")).toEqual([])
  })
})

describe("frecuencia de cobro", () => {
  it("uno bimestral cobra un mes sí y otro no, contando desde que empezó", () => {
    const basura = expense({ frequency: 2, startMonth: "2026-01" })
    expect(["2026-01", "2026-02", "2026-03", "2026-04"].map((m) => isBillingMonth(basura, m))).toEqual([
      true,
      false,
      true,
      false,
    ])
  })

  it("los meses sin factura no aparecen ni cuentan como vencidos", () => {
    const anual = expense({ frequency: 12, startMonth: "2026-03" })
    expect(stateFor(anual, [], "2026-04", "2026-12-01")).toBe("no-aplica")
    expect(stateFor(anual, [], "2027-03", "2027-04-01")).toBe("vencido")
    expect(overdueBills([anual], [], "2026-12-01").map((b) => b.month)).toEqual(["2026-03"])
  })
})

describe("abonos", () => {
  it("un abono no salda el mes; el pago final sí, y se suman", () => {
    const e = expense()
    const parcial = monthRows([e], [abono("2026-10", 30)], "2026-10", "2026-10-26")[0]
    expect(parcial.state).toBe("vencido")
    expect(parcial.paid).toBe(30)

    const saldado = monthRows([e], [abono("2026-10", 30), pay("2026-10", 55)], "2026-10", "2026-10-26")[0]
    expect(saldado.state).toBe("pagado")
    expect(saldado.amount).toBe(85)
  })

  it("lo que falta descuenta lo ya abonado", () => {
    const rows = monthRows([expense()], [abono("2026-10", 30)], "2026-10", "2026-10-26")
    expect(summarizeMonth(rows)).toMatchObject({ paid: 30, pending: 50, pendingCount: 1 })
  })

  it("se pueden guardar varios abonos del mismo mes, pero un solo pago final", () => {
    const out = normalizeData({
      ...defaultData,
      fixedExpenses: [expense()],
      fixedExpensePayments: [
        abono("2026-10", 10),
        abono("2026-10", 20),
        pay("2026-10", 50),
        { ...pay("2026-10", 51), id: "copia" },
      ],
    })
    expect(out.fixedExpensePayments.map((p) => [p.partial, p.amount])).toEqual([
      [true, 10],
      [true, 20],
      [false, 51],
    ])
  })
})

describe("monto esperado y comparación", () => {
  it("promedia las tres últimas facturas anteriores", () => {
    const payments = [pay("2026-06", 10), pay("2026-07", 60), pay("2026-08", 90), pay("2026-09", 120)]
    expect(expectedAmount(expense(), payments, "2026-10")).toBe(90)
  })

  it("sin historial usa el monto aproximado", () => {
    expect(expectedAmount(expense(), [], "2026-10")).toBe(80)
  })

  it("señala una factura muy por encima del promedio", () => {
    const e = expense()
    const payments = [pay("2026-08", 100), pay("2026-09", 100), pay("2026-10", 140)]
    expect(unusualIncrease(e, payments, "2026-10")).toEqual({ ratio: expect.closeTo(0.4), basis: "costumbre" })
    expect(unusualIncrease(e, [pay("2026-08", 100), pay("2026-09", 100), pay("2026-10", 120)], "2026-10")).toBeNull()
    // Con una sola factura previa todavía no hay costumbre.
    expect(unusualIncrease(e, [pay("2026-08", 100), pay("2026-09", 500)], "2026-09")).toBeNull()
  })

  it("en temporada compara con el mismo mes del año pasado", () => {
    // La luz de abril sube cada año por el aire acondicionado.
    const e = expense()
    const payments = [
      pay("2025-04", 190),
      pay("2026-01", 100),
      pay("2026-02", 100),
      pay("2026-03", 100),
      pay("2026-04", 200),
    ]
    expect(comparisonFor(e, payments, "2026-04")).toEqual({ amount: 190, basis: "año-pasado" })
    expect(unusualIncrease(e, payments, "2026-04")).toBeNull()
  })
})

describe("resumen del mes", () => {
  it("ordena lo urgente arriba y suma pagado y pendiente", () => {
    const expenses = [
      expense(),
      expense({ id: "agua", name: "Agua", dueDay: 5, estimatedAmount: 20 }),
      expense({ id: "net", name: "Internet", dueDay: 28, estimatedAmount: 45 }),
      expense({ id: "vieja", name: "Cable", active: false, pauses: [{ from: "2026-01", to: "" }] }),
    ]
    const rows = monthRows(expenses, [pay("2026-10", 75)], "2026-10", "2026-10-26")
    expect(rows.map((r) => [r.expense.id, r.state])).toEqual([
      ["agua", "vencido"],
      ["net", "por-vencer"],
      ["luz", "pagado"],
    ])
    expect(summarizeMonth(rows)).toEqual({
      paid: 75,
      paidCount: 1,
      pending: 65,
      pendingCount: 2,
      overdueCount: 1,
      total: 140,
    })
  })

  it("lista los meses hacia atrás cruzando el año", () => {
    expect(monthsEndingAt("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"])
  })

  it("reúne lo atrasado de todos los meses, del más viejo al más nuevo", () => {
    const e = expense({ startMonth: "2026-08" })
    const bills = overdueBills([e], [pay("2026-09", 80)], "2026-10-26")
    expect(bills.map((b) => b.month)).toEqual(["2026-08", "2026-10"])
  })
})

describe("vencimiento dicho respecto de hoy", () => {
  it("cuenta días cruzando meses y años", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3)
    expect(daysBetween("2026-10-26", "2026-10-15")).toBe(-11)
  })

  it("dice cuánto falta o cuánto pasó", () => {
    const today = "2026-10-26"
    expect(dueText("2026-10-15", today)).toBe("Venció hace 11 días")
    expect(dueText("2026-10-25", today)).toBe("Venció ayer")
    expect(dueText("2026-10-26", today)).toBe("Vence hoy")
    expect(dueText("2026-10-27", today)).toBe("Vence mañana")
    expect(dueText("2026-10-28", today)).toBe("Vence en 2 días")
    expect(dueText("2026-11-15", today)).toBe("Vence el 15 nov")
    expect(dueText("", today)).toBe("")
  })
})

describe("dar de baja y volver", () => {
  it("un servicio dado de baja sigue mostrando el mes en que se pagó", () => {
    const off = expense({ active: false, pauses: [{ from: "2026-09", to: "" }] })
    const rows = monthRows([off], [pay("2026-09", 70)], "2026-09", "2026-10-26")
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe("pagado")
  })

  it("los meses de baja no cuentan como vencidos al reactivar", () => {
    // Internet: de baja en octubre y noviembre, vuelve en diciembre.
    let net = deactivate(expense(), "2026-10", false)
    expect(net.active).toBe(false)
    expect(monthRows([net], [], "2026-11", "2026-11-20")).toEqual([])

    net = reactivate(net, "2026-12")
    expect(net.active).toBe(true)
    expect(net.pauses).toEqual([{ from: "2026-10", to: "2026-12" }])
    expect(stateFor(net, [], "2026-10", "2026-12-20")).toBe("no-aplica")
    expect(stateFor(net, [], "2026-11", "2026-12-20")).toBe("no-aplica")
    expect(stateFor(net, [], "2026-12", "2026-12-20")).toBe("vencido")
    // Lo que quedó sin pagar antes de la baja se sigue viendo.
    expect(stateFor(net, [], "2026-09", "2026-12-20")).toBe("vencido")
  })

  it("se puede reactivar desde un mes anterior al actual", () => {
    // Volvió en noviembre pero se anota en diciembre.
    const net = reactivate(deactivate(expense(), "2026-09", false), "2026-11")
    expect(net.pauses).toEqual([{ from: "2026-09", to: "2026-11" }])
    expect(stateFor(net, [], "2026-11", "2026-12-20")).toBe("vencido")
  })

  it("si la factura del mes ya se pagó, la baja corre desde el siguiente", () => {
    expect(deactivate(expense(), "2026-10", true).pauses).toEqual([{ from: "2026-11", to: "" }])
  })

  it("una baja deshecha el mismo mes no deja rastro", () => {
    const back = reactivate(deactivate(expense(), "2026-10", false), "2026-10")
    expect(back.pauses).toEqual([])
  })

  it("los dados de baja guardados sin periodos quedan de baja desde este mes", () => {
    const out = normalizeData({ ...defaultData, fixedExpenses: [{ ...expense(), active: false, pauses: undefined }] })
    expect(out.fixedExpenses[0].pauses).toHaveLength(1)
    expect(out.fixedExpenses[0].pauses[0].to).toBe("")
  })
})

describe("anotar en Contabilidad", () => {
  const ids = () => {
    let n = 0
    return () => `tx${++n}`
  }

  it("crea el gasto solo si el servicio se anota en Contabilidad", () => {
    const off = syncPaymentTransaction(expense(), pay("2026-10", 80), [], ids())
    expect(off.transactions).toEqual([])
    expect(off.payment.transactionId).toBe("")

    const on = syncPaymentTransaction(expense({ recordInAccounting: true }), pay("2026-10", 80), [], ids())
    expect(on.payment.transactionId).toBe("tx1")
    expect(on.transactions[0]).toMatchObject({
      id: "tx1",
      type: "gasto",
      status: "pagado",
      category: "Servicios públicos",
      amount: 80,
      date: "2026-10-10",
      tags: ["Gastos fijos"],
    })
  })

  it("al corregir el pago actualiza su gasto sin pisar lo que se cambió en Movimientos", () => {
    const e = expense({ recordInAccounting: true })
    const first = syncPaymentTransaction(e, pay("2026-10", 80), [], ids())
    const edited: Transaction[] = first.transactions.map((t) => ({ ...t, tags: ["Oficina"] }))
    const again = syncPaymentTransaction(e, { ...first.payment, amount: 95 }, edited, ids())
    expect(again.transactions).toHaveLength(1)
    expect(again.transactions[0]).toMatchObject({ amount: 95, tags: ["Oficina"] })
  })

  it("al quitar el pago quita su gasto", () => {
    const e = expense({ recordInAccounting: true })
    const { payment, transactions } = syncPaymentTransaction(e, pay("2026-10", 80), [], ids())
    expect(removePaymentTransactions([payment], transactions)).toEqual([])
  })
})

describe("gastos fijos en los datos guardados", () => {
  it("los datos anteriores llegan sin gastos fijos", () => {
    const out = normalizeData({ employees: [], timeEntries: [] })
    expect(out.fixedExpenses).toEqual([])
    expect(out.fixedExpensePayments).toEqual([])
  })

  it("los servicios guardados sin frecuencia quedan mensuales", () => {
    const { frequency: _f, recordInAccounting: _r, ...old } = expense()
    const out = normalizeData({ ...defaultData, fixedExpenses: [old] })
    expect(out.fixedExpenses[0]).toMatchObject({ frequency: 1, recordInAccounting: false })
  })

  it("descarta pagos huérfanos y deja uno solo por servicio y mes", () => {
    const out = normalizeData({
      ...defaultData,
      fixedExpenses: [expense(), { name: "  " }],
      fixedExpensePayments: [
        pay("2026-09", 70),
        { ...pay("2026-09", 72), id: "otro" },
        pay("2026-09", 30, "no-existe"),
        { ...pay("2026-13", 30) },
      ],
    })
    expect(out.fixedExpenses).toHaveLength(1)
    expect(out.fixedExpensePayments).toHaveLength(1)
    expect(out.fixedExpensePayments[0].amount).toBe(72)
  })

  it("al fusionar no duplica el pago del mismo mes", () => {
    const current = { ...defaultData, fixedExpenses: [expense()], fixedExpensePayments: [pay("2026-09", 70)] }
    const incoming = {
      ...defaultData,
      fixedExpenses: [expense()],
      fixedExpensePayments: [{ ...pay("2026-09", 71), id: "x" }, pay("2026-10", 80)],
    }
    const merged = mergeAppData(current, incoming).data
    expect(merged.fixedExpensePayments.map((p) => [p.month, p.amount])).toEqual([
      ["2026-09", 71],
      ["2026-10", 80],
    ])
    const kept = mergeAppData(current, incoming, "current").data
    expect(kept.fixedExpensePayments.find((p) => p.month === "2026-09")?.amount).toBe(70)
  })
})
