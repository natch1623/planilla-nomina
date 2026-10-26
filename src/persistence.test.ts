import { beforeEach, describe, expect, it, vi } from "vitest"
import { createProfile, defaultData, loadIndex, loadProfileData, recoverProfileIndex, restoreProfileRaw, saveIndex, saveProfileData, storageFailure } from "./store"
import { readStored, writeStored } from "./persistence"

let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  globalThis.localStorage = {
    get length() { return values.size }, key: i => [...values.keys()][i] ?? null,
    getItem: k => values.get(k) ?? null, setItem: (k, v) => void values.set(k, String(v)),
    removeItem: k => void values.delete(k), clear: () => values.clear(),
  }
})

describe("persistencia sin fallback destructivo", () => {
  it("conserva 1250 tras una recarga válida", () => {
    const { activeId } = loadIndex()
    expect(saveProfileData(activeId, { ...defaultData, openingBalance: 1250 })).toBe(true)
    expect(loadProfileData(activeId).openingBalance).toBe(1250)
  })
  it.each(['{"employees":[', '{}', 'null', '{"employees":[],"timeEntries":"error"}'])("no transforma %s en una empresa vacía", raw => {
    values.set("planilla_data_p", raw)
    expect(() => loadProfileData("p")).toThrow()
    expect(values.get("planilla_data_p")).toBe(raw)
  })
  it("no descarta registros inválidos al abrir una copia guardada", () => {
    const raw = JSON.stringify({ ...defaultData, employees: [{ id: "e", name: "" }] })
    values.set("planilla_data_p", raw)
    expect(() => loadProfileData("p")).toThrow()
    expect(values.get("planilla_data_p")).toBe(raw)
  })
  it.each(["planilla_data_", "planilla_profiles"])("conserva el original legacy si falla %s", failing => {
    const raw = JSON.stringify({ ...defaultData, openingBalance: 1250 })
    values.set("planilla_data", raw)
    const original = localStorage.setItem
    localStorage.setItem = (key, value) => { if (key.startsWith(failing)) throw new Error("QuotaExceededError"); original(key, value) }
    expect(() => loadIndex()).toThrow()
    expect(values.get("planilla_data")).toBe(raw)
    if (failing === "planilla_data_") expect(values.has("planilla_profiles")).toBe(false)
  })
  it("recupera el índice sin perder empresas de 1250 y 900", () => {
    values.set("planilla_data_a", JSON.stringify({ ...defaultData, companyName: "A", openingBalance: 1250 }))
    values.set("planilla_data_b", JSON.stringify({ ...defaultData, companyName: "B", openingBalance: 900 }))
    values.set("planilla_profiles", "{dañado")
    expect(() => loadIndex()).toThrow()
    recoverProfileIndex()
    expect(loadIndex().profiles).toHaveLength(2)
    expect(loadProfileData("a").openingBalance).toBe(1250)
    expect(loadProfileData("b").openingBalance).toBe(900)
    expect([...values.values()]).toContain("{dañado")
  })
  it("una segunda copia obsoleta no vuelve de 1500 a 1250", () => {
    values.set("planilla_data_a", JSON.stringify({ ...defaultData, openingBalance: 1250 }))
    loadProfileData("a")
    const other = JSON.stringify({ ...defaultData, openingBalance: 1500 })
    values.set("planilla_data_a", other)
    expect(saveProfileData("a", { ...defaultData, openingBalance: 1250, companyName: "Nuevo" })).toBe(false)
    expect(storageFailure()?.kind).toBe("changed")
    expect(values.get("planilla_data_a")).toBe(other)
  })
  it("si falla el guardado de 1500, conserva 1250 y su copia anterior", () => {
    const id = loadIndex().activeId
    saveProfileData(id, { ...defaultData, openingBalance: 1250 })
    const original = localStorage.setItem
    localStorage.setItem = (key, value) => { if (key === `planilla_data_${id}`) throw new Error("quota"); original(key, value) }
    expect(saveProfileData(id, { ...defaultData, openingBalance: 1500 })).toBe(false)
    expect(loadProfileData(id).openingBalance).toBe(1250)
    expect(JSON.parse(values.get(`planilla_previous:planilla_data_${id}`)!).openingBalance).toBe(1250)
  })
  it("no crea un perfil visible cuando no cabe su documento", () => {
    const index = loadIndex()
    localStorage.setItem = vi.fn(() => { throw new Error("quota") })
    expect(() => createProfile(index, "Otra")).toThrow()
    expect(JSON.parse(values.get("planilla_profiles")!).profiles).toHaveLength(1)
  })
  it("restaurar conserva los bytes dañados y valida antes de reemplazar", () => {
    values.set("planilla_data_a", "{dañado")
    expect(() => restoreProfileRaw("a", "{}")).toThrow()
    restoreProfileRaw("a", JSON.stringify({ ...defaultData, openingBalance: 1250 }))
    expect(loadProfileData("a").openingBalance).toBe(1250)
    expect([...values.values()]).toContain("{dañado")
  })
  it("no sustituye índices escritos por otra pestaña", () => {
    const index = loadIndex()
    values.set("planilla_profiles", "cambio externo")
    expect(() => saveIndex(index)).toThrow("pestaña")
  })
  it("conserva el original si tampoco cabe su copia anterior", () => {
    readStored("x"); writeStored("x", "1250")
    localStorage.setItem = () => { throw new Error("quota") }
    expect(() => writeStored("x", "1500", true)).toThrow()
    expect(values.get("x")).toBe("1250")
  })
  it("no resucita un documento eliminado por otra pestaña", () => {
    values.set("x", "original")
    readStored("x")
    values.delete("x")
    expect(() => writeStored("x","obsoleto")).toThrow("pestaña")
    expect(values.has("x")).toBe(false)
  })
})
