import { describe, expect, it } from "vitest"
import type { Employee, PayPeriod, PayrollAdjustment, TimeEntry } from "../types"
import type { PayrollRules } from "./calculations"
import { calcEmployeeSummary } from "./calculations"
import { buildPayslipDoc } from "./exportPayslip"
import { datesBetween } from "./dates"
import { defaultWeeklySchedule } from "../store"

const RULES: PayrollRules = {
  overtimeThreshold: 8,
  standardDayHours: 8,
  holidayRate: 1.5,
  payVacations: true,
  payHolidays: true,
  paySickLeave: false,
}

const EMPLOYEE: Employee = {
  id: "e1",
  name: "María Fernández Gómez",
  idNumber: "8-888-8888",
  position: "Analista de laboratorio",
  startDate: "2024-03-01",
  category: "empleado",
  paymentType: "hourly",
  hourlyRate: 6.5,
  dailyRate: 0,
  fixedSalary: 0,
  schedule: defaultWeeklySchedule(),
  socialSecurityRate: 9.75,
  educationRate: 1.25,
  active: true,
}

/** Todos los días del rango con registro: el caso que más renglones produce. */
function fullEntries(start: string, end: string): TimeEntry[] {
  return datesBetween(start, end).map((date, i) => ({
    id: `t${i}`,
    employeeId: "e1",
    date,
    dayType: i === 2 ? "feriado" : "trabajo",
    entryTime: "08:00",
    exitTime: i % 3 === 0 ? "18:30" : "17:00",
    lunchBreak: true,
    lunchDuration: 60,
    overtimeRate: 1.5,
    notes: i === 4 ? "Cierre de mes" : "",
  }))
}

function adjustments(count: number): PayrollAdjustment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    employeeId: "e1",
    periodKey: "2026-08-2",
    kind: i % 2 === 0 ? ("bono" as const) : ("descuento" as const),
    amount: 10 + i,
    note: `Concepto ${i + 1}`,
    createdAt: "",
  }))
}

describe("comprobante de pago", () => {
  // La segunda quincena de un mes de 31 días es la más larga: 16 renglones de
  // asistencia, y encima los ajustes manuales. Si algo se sale de la hoja,
  // es aquí.
  const period: PayPeriod = { year: 2026, month: 8, half: 2 }
  const entries = fullEntries("2026-08-16", "2026-08-31")

  it("cabe en una sola página con la quincena más larga", () => {
    const s = calcEmployeeSummary(EMPLOYEE, entries, RULES)
    const doc = buildPayslipDoc(s, period, "RYS Bioservices", entries)

    expect(doc.getNumberOfPages()).toBe(1)
  })

  it("sigue cabiendo con préstamo y varios ajustes manuales", () => {
    const s = calcEmployeeSummary(EMPLOYEE, entries, RULES, 30, 25)
    const doc = buildPayslipDoc(
      s,
      period,
      "RYS Bioservices",
      entries,
      adjustments(4),
    )

    expect(doc.getNumberOfPages()).toBe(1)
  })

  it("cabe también sin registros de asistencia", () => {
    const s = calcEmployeeSummary(EMPLOYEE, [], RULES)
    const doc = buildPayslipDoc(s, period, "RYS Bioservices", [])

    expect(doc.getNumberOfPages()).toBe(1)
  })
})
