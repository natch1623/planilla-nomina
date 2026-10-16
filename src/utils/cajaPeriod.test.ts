import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import type { CostEntry } from "../types"
import {
  cajaPeriodFor,
  cajaRange,
  entriesInPeriod,
  formatSpan,
  shiftCajaRef,
} from "./cajaPeriod"
import { buildCajaWorkbook } from "./exportCaja"

const span = (p: { start: string; end: string }) => [p.start, p.end]

function entry(id: string, date: string, kind: CostEntry["kind"], amount: number): CostEntry {
  return {
    id,
    date,
    recipientName: `Nombre ${id}`,
    kind,
    taxId: "",
    concept: "",
    quantity: 1,
    amount,
    comment: "",
    processedBy: "",
    createdAt: `${date}T10:00:00.000Z`,
  }
}

describe("períodos de Caja", () => {
  it("calcula el período que contiene la fecha", () => {
    // 2026-10-16 es viernes.
    expect(span(cajaPeriodFor("dia", "2026-10-16"))).toEqual(["2026-10-16", "2026-10-16"])
    expect(span(cajaPeriodFor("semana", "2026-10-16"))).toEqual(["2026-10-12", "2026-10-18"])
    expect(span(cajaPeriodFor("semana", "2026-10-18"))).toEqual(["2026-10-12", "2026-10-18"])
    expect(span(cajaPeriodFor("quincena", "2026-10-15"))).toEqual(["2026-10-01", "2026-10-15"])
    expect(span(cajaPeriodFor("quincena", "2026-02-20"))).toEqual(["2026-02-16", "2026-02-28"])
    expect(span(cajaPeriodFor("mes", "2028-02-10"))).toEqual(["2028-02-01", "2028-02-29"])
    expect(span(cajaPeriodFor("anio", "2026-10-16"))).toEqual(["2026-01-01", "2026-12-31"])
  })

  it("se mueve al período anterior o siguiente cruzando meses y años", () => {
    expect(shiftCajaRef("dia", "2026-12-31", 1)).toBe("2027-01-01")
    expect(shiftCajaRef("semana", "2026-10-16", -1)).toBe("2026-10-09")
    expect(shiftCajaRef("quincena", "2026-01-10", -1)).toBe("2025-12-16")
    expect(shiftCajaRef("quincena", "2026-12-20", 1)).toBe("2027-01-01")
    expect(shiftCajaRef("mes", "2026-01-31", 1)).toBe("2026-02-01")
    expect(shiftCajaRef("mes", "2026-01-31", -1)).toBe("2025-12-01")
    expect(cajaPeriodFor("anio", shiftCajaRef("anio", "2026-10-16", -1)).title).toBe("Año 2025")
  })

  it("nombra el período con sus fechas sin repetir mes ni año", () => {
    expect(formatSpan("2026-10-12", "2026-10-18")).toBe("12 al 18 oct 2026")
    expect(formatSpan("2026-09-28", "2026-10-04")).toBe("28 sep al 4 oct 2026")
    expect(formatSpan("2025-12-29", "2026-01-04")).toBe("29 dic 2025 al 4 ene 2026")
    expect(cajaPeriodFor("dia", "2026-10-16").label).toBe("Viernes 16 oct 2026")
    expect(cajaPeriodFor("semana", "2026-10-16").label).toBe("Semana del 12 al 18 oct 2026")
    expect(cajaPeriodFor("quincena", "2026-10-20").label).toBe(
      "2.ª quincena de octubre 2026 (16 al 31 oct 2026)",
    )
    expect(cajaPeriodFor("mes", "2026-10-20").label).toBe("Octubre 2026 (1 al 31 oct 2026)")
    expect(cajaRange("2026-10-01", "2026-10-16").label).toBe("Del 1 al 16 oct 2026")
  })

  it("el rango manual nunca queda al revés", () => {
    expect(span(cajaRange("2026-10-10", "2026-10-01"))).toEqual(["2026-10-01", "2026-10-10"])
  })

  it("el Excel solo trae los movimientos del período y sus totales cuadran", () => {
    const entries = [
      entry("a", "2026-09-30", "cobro", 999),
      entry("b", "2026-10-01", "cobro", 100),
      entry("c", "2026-10-15", "pago", 40),
      entry("d", "2026-10-16", "cobro", 7),
    ]
    const period = cajaPeriodFor("quincena", "2026-10-05")
    expect(entriesInPeriod(entries, period).map((c) => c.id)).toEqual(["b", "c"])

    const wb = buildCajaWorkbook(entries, [], period)
    expect(wb.SheetNames[0]).toBe("Período")
    const info = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Período"], { header: 1 })
    expect(info).toContainEqual(["Período", period.label])
    expect(info).toContainEqual(["Balance", 60])
    const dias = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Resumen diario"])
    expect(dias.at(-1)).toEqual({ Fecha: "TOTAL", Cobros: 100, Pagos: -40, "Balance diario": 60 })
  })
})
