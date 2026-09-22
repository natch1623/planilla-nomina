import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import type { CostCashCount, CostEntry } from "../types"
import { buildCajaWorkbook } from "./exportCaja"

function entry(
  id: string,
  date: string,
  kind: CostEntry["kind"],
  amount: number,
): CostEntry {
  return {
    id,
    date,
    recipientName: `Nombre ${id}`,
    kind,
    taxId: "",
    concept: "Consulta",
    quantity: 1,
    amount,
    comment: "",
    processedBy: "Maria",
    createdAt: `${date}T10:00:00.000Z`,
  }
}

const rows = (wb: XLSX.WorkBook, sheet: string) =>
  XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet])

describe("exportación de Caja", () => {
  const entries = [
    entry("a", "2026-09-22", "pago", 50),
    entry("b", "2026-09-21", "cobro", 80),
    entry("c", "2026-09-22", "cobro", 30),
  ]

  it("los cobros suman y los pagos restan, en orden de fecha", () => {
    const mov = rows(buildCajaWorkbook(entries, []), "Movimientos")
    expect(mov.map((r) => [r.Fecha, r.Tipo, r.Monto])).toEqual([
      ["2026-09-21", "Cobro", 80],
      ["2026-09-22", "Pago", -50],
      ["2026-09-22", "Cobro", 30],
    ])
  })

  it("resume cada día con su balance y un total", () => {
    const dias = rows(buildCajaWorkbook(entries, []), "Resumen diario")
    expect(dias).toEqual([
      { Fecha: "2026-09-21", Cobros: 80, Pagos: 0, "Balance diario": 80 },
      { Fecha: "2026-09-22", Cobros: 30, Pagos: -50, "Balance diario": -20 },
      { Fecha: "TOTAL", Cobros: 110, Pagos: -50, "Balance diario": 60 },
    ])
  })

  it("agrega los arqueos solo si hay", () => {
    expect(buildCajaWorkbook(entries, []).SheetNames).not.toContain("Arqueos")
    const count: CostCashCount = {
      id: "x",
      kind: "cierre",
      operatorName: "Maria",
      at: "2026-09-22T20:00:00.000Z",
      cashOnHand: 120.5,
      notes: "Todo bien",
    }
    const arq = rows(buildCajaWorkbook(entries, [count]), "Arqueos")
    expect(arq).toHaveLength(1)
    expect(arq[0]).toMatchObject({
      Encargada: "Maria",
      Tipo: "Cierre de turno",
      Efectivo: 120.5,
      Detalles: "Todo bien",
    })
  })
})
