import { describe, expect, it } from "vitest"
import { defaultData } from "../store"
import type { AppData, Employee, TimeEntry } from "../types"
import { SECTIONS, applySection, isSection, sectionPayload } from "./sections"

const emp = { id: "e1", name: "Ana", hourlyRate: 5 } as Employee
const entry = { id: "t1", employeeId: "e1", date: "2026-09-02" } as TimeEntry

describe("secciones de la nube", () => {
  it("Asistencia sube solo los registros, nunca colaboradores ni tarifas", () => {
    const data: AppData = { ...defaultData, employees: [emp], timeEntries: [entry] }
    expect(sectionPayload("asistencia", data)).toEqual({ timeEntries: [entry] })
  })

  it("Costos sube pagos, plantillas y encargadas, nada más", () => {
    const data = {
      ...defaultData,
      employees: [emp],
      costs: [{ id: "c1" }],
      costTemplates: [{ id: "p1" }],
      costOperators: [{ id: "o1", name: "Maria", pin: "1234" }],
    } as unknown as AppData
    expect(sectionPayload("costos", data)).toEqual({
      costs: [{ id: "c1" }],
      costTemplates: [{ id: "p1" }],
      costOperators: [{ id: "o1", name: "Maria", pin: "1234" }],
    })
  })

  it("aplica solo los campos que la sección declara", () => {
    const base: AppData = { ...defaultData, companyName: "Local" }
    const out = applySection(base, "asistencia", {
      companyName: "Princess",
      timeEntries: [entry],
      // Un servidor mal configurado no debe poder colar esto en la sección.
      loans: [{ id: "x" }],
      transactions: [{ id: "y" }],
    })
    expect(out.companyName).toBe("Princess")
    expect(out.timeEntries).toEqual([entry])
    expect(out.loans).toEqual(base.loans)
    expect(out.transactions).toEqual(base.transactions)
  })

  it("no borra datos locales si la sección llega sin un campo", () => {
    const base: AppData = { ...defaultData, timeEntries: [entry] }
    const out = applySection(base, "asistencia", { companyName: "Princess" })
    expect(out.timeEntries).toEqual([entry])
  })

  it("toma la versión de datos que manda la nube", () => {
    const out = applySection(defaultData, "asistencia", { version: 99 })
    expect(out.version).toBe(99)
  })

  it("cada sección escribe un subconjunto de lo que lee", () => {
    for (const def of Object.values(SECTIONS)) {
      for (const w of def.writes) expect(def.reads).toContain(w)
    }
  })

  it("reconoce solo secciones conocidas", () => {
    expect(isSection("asistencia")).toBe(true)
    expect(isSection("costos")).toBe(true)
    expect(isSection("salarios")).toBe(false)
    expect(isSection(null)).toBe(false)
  })
})
