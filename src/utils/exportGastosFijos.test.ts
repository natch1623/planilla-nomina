import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import type { FixedExpense, FixedExpensePayment } from "../types"
import { buildFixedExpensesWorkbook } from "./exportGastosFijos"

const luz: FixedExpense = {
  id: "luz",
  name: "Luz",
  provider: "ACME Energía",
  accountNumber: "NIS 1",
  estimatedAmount: 80,
  dueDay: 15,
  frequency: 1,
  recordInAccounting: false,
  startMonth: "2026-01",
  notes: "",
  active: true,
  pauses: [],
}

const pay = (month: string, amount: number, partial = false): FixedExpensePayment => ({
  id: `${month}-${amount}`,
  expenseId: "luz",
  month,
  amount,
  partial,
  transactionId: "",
  paidOn: `${month}-10`,
  paymentMethod: "transferencia",
  reference: "",
  notes: "",
  attachments: [],
  createdAt: "",
})

describe("Excel de gastos fijos", () => {
  const wb = buildFixedExpensesWorkbook(
    [luz],
    [pay("2026-01", 80), pay("2026-02", 30, true), pay("2026-02", 60), pay("2025-12", 99)],
    2026,
  )

  it("resume lo pagado por mes, abonos incluidos, y suma el total", () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Resumen 2026"])
    expect(rows[0]).toMatchObject({ Servicio: "Luz", Ene: 80, Feb: 90, Total: 170 })
    expect(rows[1]).toMatchObject({ Servicio: "TOTAL", Total: 170 })
  })

  it("lista cada pago del año, sin los de otros años", () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Pagos)
    expect(rows.map((r) => [r.Mes, r.Monto, r.Tipo])).toEqual([
      ["Enero 2026", 80, "Pago"],
      ["Febrero 2026", 30, "Abono"],
      ["Febrero 2026", 60, "Pago"],
    ])
  })
})
