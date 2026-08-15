import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import type { Employee, EmployeeSummary, PayPeriod } from "../types"
import { calcEmployeeSummary } from "./calculations"
import type { PayrollRules } from "./calculations"
import { defaultWeeklySchedule } from "../store"
import { buildPayrollWorkbook } from "./exportExcel"

const PERIOD: PayPeriod = { year: 2026, month: 8, half: 1 }

const RULES: PayrollRules = {
  overtimeThreshold: 8,
  standardDayHours: 8,
  holidayRate: 1.5,
  payVacations: true,
  payHolidays: true,
  paySickLeave: false,
}

function employee(id: string, name: string): Employee {
  return {
    id,
    name,
    idNumber: "8-123-456",
    position: "Técnico",
    startDate: "2026-01-01",
    category: "empleado",
    paymentType: "hourly",
    hourlyRate: 10,
    dailyRate: 0,
    fixedSalary: 0,
    schedule: defaultWeeklySchedule(),
    socialSecurityRate: 9.75,
    educationRate: 1.25,
    active: true,
  }
}

function summaryFor(id: string, name: string): EmployeeSummary {
  return calcEmployeeSummary(
    employee(id, name),
    [
      {
        id: `${id}-t1`,
        employeeId: id,
        date: "2026-08-03",
        dayType: "trabajo",
        entryTime: "08:00",
        exitTime: "17:00",
        lunchBreak: true,
        lunchDuration: 60,
        overtimeRate: 1.5,
        notes: "",
      },
    ],
    RULES,
  )
}

const SUMMARIES = [summaryFor("e1", "Ana Ruiz"), summaryFor("e2", "Luis Gómez")]

function cell(ws: XLSX.WorkSheet, address: string) {
  return ws[address] as XLSX.CellObject | undefined
}

describe("buildPayrollWorkbook", () => {
  it("abre con el resumen y luego el detalle", () => {
    const wb = buildPayrollWorkbook(SUMMARIES, PERIOD)
    expect(wb.SheetNames).toEqual(["Resumen", "Planilla", "Días", "Info"])
  })

  it("guarda los montos como número, no como texto", () => {
    const ws = buildPayrollWorkbook(SUMMARIES, PERIOD).Sheets.Planilla
    // Columna X = "Salario neto", primera fila de datos.
    const neto = cell(ws, "X2")

    expect(neto?.t).toBe("n")
    expect(neto?.v).toBeCloseTo(71.2, 10)
  })

  it("da formato de moneda a las columnas de dinero", () => {
    const ws = buildPayrollWorkbook(SUMMARIES, PERIOD).Sheets.Planilla

    expect(cell(ws, "X2")?.z).toBe('"$"#,##0.00')
    expect(cell(ws, "R2")?.z).toBe('"$"#,##0.00') // Salario bruto
  })

  it("da formato de horas, no de moneda, a las columnas de horas", () => {
    const ws = buildPayrollWorkbook(SUMMARIES, PERIOD).Sheets.Planilla
    expect(cell(ws, "L2")?.z).toBe("0.00") // Horas regulares
  })

  it("no toca el encabezado", () => {
    const ws = buildPayrollWorkbook(SUMMARIES, PERIOD).Sheets.Planilla
    expect(cell(ws, "X1")?.v).toBe("Salario neto")
    expect(cell(ws, "X1")?.z).toBeUndefined()
  })

  it("cierra la planilla con la fila de totales", () => {
    const ws = buildPayrollWorkbook(SUMMARIES, PERIOD).Sheets.Planilla
    // Dos colaboradores: fila 2 y 3 de datos, totales en la 4.
    expect(cell(ws, "A4")?.v).toBe("TOTALES")
    expect(cell(ws, "X4")?.v).toBeCloseTo(142.4, 10)
  })

  it("deja la fila de totales fuera del autofiltro", () => {
    const ws = buildPayrollWorkbook(SUMMARIES, PERIOD).Sheets.Planilla
    const filter = ws["!autofilter"] as { ref: string } | undefined
    const range = XLSX.utils.decode_range(filter!.ref)

    // Encabezado + dos colaboradores: hasta la fila 3 (índice 2).
    expect(range.e.r).toBe(SUMMARIES.length)
  })

  it("congela el encabezado y la columna de nombres", () => {
    const ws = buildPayrollWorkbook(SUMMARIES, PERIOD).Sheets.Planilla
    expect(ws["!freeze"]).toEqual({ xSplit: 1, ySplit: 1 })
  })

  it("pone moneda solo en las filas de dinero del resumen", () => {
    const ws = buildPayrollWorkbook(SUMMARIES, PERIOD).Sheets.Resumen

    // Fila 17 = "TOTAL A PAGAR"; fila 3 = "Colaboradores", que es un conteo.
    expect(cell(ws, "B17")?.z).toBe('"$"#,##0.00')
    expect(cell(ws, "B3")?.z).toBeUndefined()
    expect(cell(ws, "A17")?.v).toBe("TOTAL A PAGAR")
    expect(cell(ws, "B3")?.v).toBe(2)
  })

  it("agrega la hoja de asistencia cuando se pasan los registros", () => {
    const entries = [
      {
        id: "e1-t1",
        employeeId: "e1",
        date: "2026-08-03",
        dayType: "trabajo" as const,
        entryTime: "08:00",
        exitTime: "17:00",
        lunchBreak: true,
        lunchDuration: 60,
        overtimeRate: 1.5,
        notes: "Turno completo",
      },
    ]
    const wb = buildPayrollWorkbook(SUMMARIES, PERIOD, entries)

    expect(wb.SheetNames).toContain("Asistencia")
    const ws = wb.Sheets.Asistencia
    // Encabezado + 15 días por cada uno de los dos colaboradores.
    expect(cell(ws, "A2")?.v).toBe("Ana Ruiz")
    expect(cell(ws, "B4")?.v).toBe("2026-08-03")
    expect(cell(ws, "E4")?.v).toBe("08:00")
    expect(cell(ws, "F4")?.v).toBe("17:00")
    expect(cell(ws, "H4")?.v).toBeCloseTo(8, 10)
    expect(cell(ws, "D2")?.v).toBe("Sin registro")
  })

  it("omite la hoja de asistencia si no se pasan registros", () => {
    const wb = buildPayrollWorkbook(SUMMARIES, PERIOD)
    expect(wb.SheetNames).not.toContain("Asistencia")
  })

  it("no se rompe sin colaboradores", () => {
    const wb = buildPayrollWorkbook([], PERIOD)
    // Sin filas no hay hoja de días que valga la pena.
    expect(wb.SheetNames).toEqual(["Resumen", "Planilla", "Info"])
  })
})
