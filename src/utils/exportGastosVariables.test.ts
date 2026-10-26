import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import type { DailyExpense, SupplierPayment } from "../types"
import { buildDailyWorkbook, buildSuppliersWorkbook } from "./exportGastosVariables"

const daily = (date: string, category: string, amount: number): DailyExpense => ({
  id: `${date}-${category}-${amount}`,
  date,
  category,
  amount,
  paymentMethod: "efectivo",
  paidBy: "",
  notes: "",
  attachments: [],
  transactionId: "",
  createdAt: `${date}T10:00:00.000Z`,
})

const pago = (date: string, name: string, amount: number, itbms: number): SupplierPayment => ({
  id: `${date}-${name}`,
  date,
  supplierName: name,
  taxId: "155596713-2-2015",
  dv: "59",
  concept: "Compra",
  invoiceNumber: "F-1",
  amount,
  itbms,
  paymentMethod: "transferencia",
  notes: "",
  attachments: [],
  transactionId: "",
  createdAt: `${date}T10:00:00.000Z`,
})

const rows = (wb: XLSX.WorkBook, sheet: string) =>
  XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet])

describe("Excel del día a día", () => {
  const wb = buildDailyWorkbook(
    [daily("2026-01-05", "Gasolina", 20), daily("2026-02-05", "Gasolina", 25), daily("2026-02-06", "Comida", 8), daily("2025-12-30", "Gasolina", 99)],
    2026,
  )

  it("lista los gastos del año y nada de otros años", () => {
    expect(rows(wb, "Gastos 2026").map((r) => [r.Fecha, r.Tipo, r.Monto])).toEqual([
      ["2026-01-05", "Gasolina", 20],
      ["2026-02-05", "Gasolina", 25],
      ["2026-02-06", "Comida", 8],
    ])
  })

  it("resume por tipo y mes", () => {
    const t = rows(wb, "Por tipo")
    expect(t[0]).toMatchObject({ Tipo: "Gasolina", Ene: 20, Feb: 25, Total: 45 })
    expect(t[2]).toMatchObject({ Tipo: "TOTAL", Feb: 33, Total: 53 })
  })
})

describe("Excel de pagos a empresas", () => {
  const wb = buildSuppliersWorkbook([pago("2026-03-01", "ACME", 107, 7), pago("2026-03-15", "ACME", 53.5, 3.5)], 2026)

  it("separa subtotal, ITBMS y total, con RUC y DV", () => {
    expect(rows(wb, "Pagos 2026")[0]).toMatchObject({
      Empresa: "ACME",
      RUC: "155596713-2-2015",
      DV: "59",
      Subtotal: 100,
      ITBMS: 7,
      Total: 107,
    })
  })

  it("suma por empresa para el contador", () => {
    expect(rows(wb, "Por empresa")[0]).toMatchObject({ Empresa: "ACME", Pagos: 2, Subtotal: 150, ITBMS: 10.5, Total: 160.5 })
  })
})
