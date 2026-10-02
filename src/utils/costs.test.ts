import { describe, expect, it } from "vitest"
import type { CostEntry, CostTemplate } from "../types"
import { normalizeData } from "../store"
import { recipientOptions, removeRecipientSuggestion, saveRecipientTemplate } from "./costs"

describe("autocompletar de Caja", () => {
  const costs = [
    { id: "c1", recipientName: "Proveedor Uno", amount: 50 },
    { id: "c2", recipientName: "proveedor uno", amount: 25 },
    { id: "c3", recipientName: "Proveedor Dos", amount: 10 },
  ] as CostEntry[]
  const templates: CostTemplate[] = [
    { id: "t1", recipientName: "Proveedor Uno", taxId: "123" },
  ]

  it("elimina también los nombres del historial sin borrar movimientos", () => {
    const hidden = removeRecipientSuggestion(templates, " PROVEEDOR UNO ")
    expect(recipientOptions(costs, hidden)).toEqual(["Proveedor Dos"])
    expect(hidden[0].id).toBe("t1")
    expect(costs).toHaveLength(3)
    expect(costs[0].amount).toBe(50)
    expect(templates[0].hidden).toBeUndefined()
  })

  it("puede quitar una sugerencia que nunca se guardó como plantilla", () => {
    const hidden = removeRecipientSuggestion(templates, "Proveedor Dos")
    expect(recipientOptions(costs, hidden)).toEqual(["Proveedor Uno"])
  })

  it("permite agregar un nombre eliminado y actualizar sus datos sin duplicarlo", () => {
    const hidden = removeRecipientSuggestion(templates, "Proveedor Uno")
    const saved = saveRecipientTemplate(hidden, { recipientName: " Proveedor Uno ", taxId: " 456 " })
    expect(saved).toEqual([{ id: "t1", recipientName: "Proveedor Uno", taxId: "456" }])
    expect(recipientOptions(costs, saved)).toEqual(["Proveedor Dos", "Proveedor Uno"])
  })

  it("guarda un nombre nuevo sin necesitar un movimiento", () => {
    const saved = saveRecipientTemplate([], { recipientName: "Nuevo proveedor", taxId: "789" })
    expect(recipientOptions([], saved)).toEqual(["Nuevo proveedor"])
  })

  it("conserva las exclusiones al cargar un respaldo o datos de nube", () => {
    const hidden = removeRecipientSuggestion(templates, "Proveedor Uno")
    const loaded = normalizeData(JSON.parse(JSON.stringify({ costTemplates: hidden })))
    expect(loaded.costTemplates).toEqual(hidden)
    expect(recipientOptions(costs, loaded.costTemplates)).toEqual(["Proveedor Dos"])
  })
})
