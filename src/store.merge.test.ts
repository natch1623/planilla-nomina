import { describe, expect, it } from "vitest"
import type { AppData, ClosedPeriod, Employee, TimeEntry } from "./types"
import { defaultData, mergeAppData } from "./store"

// Solo importan los campos que usa la fusión; el resto se completa con casts.
const emp = (id: string, name: string) => ({ id, name }) as Employee
const entry = (id: string, employeeId: string, date: string, notes = "") =>
  ({ id, employeeId, date, notes }) as TimeEntry
const closed = (key: string, closedAt: string) =>
  ({ key, closedAt, summaries: [] }) as unknown as ClosedPeriod

function data(partial: Partial<AppData>): AppData {
  return { ...defaultData, ...partial }
}

describe("mergeAppData", () => {
  it("agrega colaboradores y registros nuevos sin borrar los existentes", () => {
    const current = data({
      employees: [emp("a", "Ana")],
      timeEntries: [entry("1", "a", "2026-09-01")],
    })
    const incoming = data({
      employees: [emp("b", "Beto")],
      timeEntries: [entry("2", "b", "2026-09-01")],
    })

    const { data: merged, preview } = mergeAppData(current, incoming)

    expect(merged.employees.map((e) => e.id).sort()).toEqual(["a", "b"])
    expect(merged.timeEntries).toHaveLength(2)
    expect(preview.newEmployees).toBe(1)
    expect(preview.newEntries).toBe(1)
    expect(preview.updatedEntries).toBe(0)
  })

  it("identifica el registro diario por colaborador y fecha, no por id", () => {
    const current = data({
      employees: [emp("a", "Ana")],
      timeEntries: [entry("id-local", "a", "2026-09-01", "viejo")],
    })
    const incoming = data({
      employees: [emp("a", "Ana")],
      timeEntries: [entry("id-otro-archivo", "a", "2026-09-01", "nuevo")],
    })

    const { data: merged, preview } = mergeAppData(current, incoming)

    expect(merged.timeEntries).toHaveLength(1)
    expect(merged.timeEntries[0].notes).toBe("nuevo")
    expect(preview.updatedEntries).toBe(1)
    expect(preview.updatedEmployees).toBe(1)
  })

  it("nunca pisa una quincena cerrada que ya existe", () => {
    const current = data({ closedPeriods: [closed("2026-9-1", "pagada")] })
    const incoming = data({
      closedPeriods: [closed("2026-9-1", "otra"), closed("2026-9-2", "nueva")],
    })

    const { data: merged, preview } = mergeAppData(current, incoming)

    const byKey = new Map(merged.closedPeriods.map((c) => [c.key, c.closedAt]))
    expect(byKey.get("2026-9-1")).toBe("pagada")
    expect(byKey.get("2026-9-2")).toBe("nueva")
    expect(preview.skippedClosedPeriods).toBe(1)
    expect(preview.newClosedPeriods).toBe(1)
  })

  it("conserva la configuración actual en vez de la del archivo", () => {
    const current = data({ companyName: "Mi empresa", overtimeThreshold: 8 })
    const incoming = data({ companyName: "Otra", overtimeThreshold: 10 })

    const { data: merged } = mergeAppData(current, incoming)

    expect(merged.companyName).toBe("Mi empresa")
    expect(merged.overtimeThreshold).toBe(8)
  })

  it("con winner 'current' agrega lo nuevo pero no pisa lo repetido", () => {
    const current = data({
      employees: [emp("a", "Ana (nube)")],
      timeEntries: [entry("1", "a", "2026-09-01", "nube")],
    })
    const incoming = data({
      employees: [emp("a", "Ana (local)"), emp("b", "Beto")],
      timeEntries: [entry("2", "a", "2026-09-01", "local"), entry("3", "a", "2026-09-02")],
    })

    const { data: merged, preview } = mergeAppData(current, incoming, "current")

    expect(merged.employees.find((e) => e.id === "a")?.name).toBe("Ana (nube)")
    expect(merged.employees).toHaveLength(2)
    expect(merged.timeEntries.find((e) => e.date === "2026-09-01")?.notes).toBe("nube")
    expect(merged.timeEntries).toHaveLength(2)
    expect(preview.newEmployees).toBe(1)
    expect(preview.updatedEmployees).toBe(1)
    expect(preview.newEntries).toBe(1)
  })
})
