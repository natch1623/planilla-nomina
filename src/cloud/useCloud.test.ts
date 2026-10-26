// @vitest-environment happy-dom
import { act, createElement, useCallback, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultData, loadProfileData, saveProfileData } from "../store"
import type { AppData } from "../types"
import { readLinks, writeLinks } from "./sync"
import { useCloud, type Cloud } from "./useCloud"
import * as api from "./client"
import { readStored } from "../persistence"
import type { Section } from "./sections"

vi.mock("./client", async () => ({
  ...await vi.importActual("./client"), cloudAvailable: true,
  getSession: vi.fn(), onSessionChange: vi.fn(() => () => {}),
  listCompanies: vi.fn(), fetchRevision: vi.fn(), fetchCompany: vi.fn(),
  saveCompany: vi.fn(), subscribeCompany: vi.fn(),
  fetchSection: vi.fn(),
}))

const access = { role: "owner", label: "Administrador", readsAll: true, writesAll: true, managesMembers: true, sections: [] }
const profiles = [{ id: "a", name: "A" },{ id: "b", name: "B" }]
const companies = profiles.map(p => ({ id: `c${p.id}`, name: p.name, revision: 10, updatedAt: "", updatedByEmail: "", access }))
const a: AppData = { ...defaultData, companyName: "A", openingBalance: 100 }
const b: AppData = { ...defaultData, companyName: "B", openingBalance: 900 }
const noop = () => {}
const supportedSections: Section[] = ["asistencia","costos"]
let root: Root
let cloud: Cloud
let edit: (value: number) => void
let select: (id: string) => void
let current: AppData
let persisted: (value: boolean) => void
const listeners = new Map<string, (revision: number) => void>()
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const snapshot = (value: number, revision = 11) => ({ data: { ...a, openingBalance: value }, revision, updatedAt: "", updatedByEmail: "" })
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

function Host() {
  const [state, setState] = useState({ id: "a", data: a })
  const [saved, setSaved] = useState(true)
  const setData = useCallback((data: AppData) => setState(s => ({ ...s, data })), [])
  current = state.data
  edit = value => setState(s => { const data = { ...s.data, openingBalance: value }; saveProfileData(s.id, data); return { ...s, data } })
  select = id => setState({ id, data: loadProfileData(id) })
  persisted = setSaved
  cloud = useCloud({ activeId: state.id, data: state.data, setData, notify: noop,
    openAsNewProfile: () => "new", switchProfile: noop, forgetProfiles: noop, supportedSections, profiles, adoptMerged: noop, persisted: saved })
  return null
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.clearAllMocks()
  localStorage.clear()
  readStored("planilla_data_a"); readStored("planilla_data_b")
  saveProfileData("a", a); saveProfileData("b", b)
  readLinks(); writeLinks({ a: { companyId: "ca", revision: 10, dirty: false }, b: { companyId: "cb", revision: 10, dirty: false } })
  vi.mocked(api.getSession).mockResolvedValue({ user: { email: "prueba@example.invalid" } } as any)
  vi.mocked(api.listCompanies).mockResolvedValue(companies)
  vi.mocked(api.fetchRevision).mockResolvedValue(10)
  vi.mocked(api.fetchCompany).mockResolvedValue(snapshot(200))
  vi.mocked(api.saveCompany).mockResolvedValue({ ok: true, revision: 11 })
  vi.mocked(api.subscribeCompany).mockImplementation((id, cb) => { listeners.set(id, cb); return () => { listeners.delete(id) } })
  root = createRoot(document.createElement("div"))
  await act(async () => { root.render(createElement(Host)) })
  await settle()
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })

describe("sincronización montada en React", () => {
  it("una descarga conserva la edición 999 hecha mientras esperaba", async () => {
    const remote = deferred<api.CloudSnapshot>()
    vi.mocked(api.fetchCompany).mockReturnValueOnce(remote.promise)
    await act(async () => { listeners.get("ca")!(11) })
    await act(async () => edit(999))
    await act(async () => remote.resolve(snapshot(200)))
    expect(current.openingBalance).toBe(999)
    expect(cloud.status).toBe("conflict")
    expect(cloud.link?.dirty).toBe(true)
  })
  it("un conflicto tardío de A no se presenta ni aplica en B", async () => {
    const save = deferred<api.SaveResult>()
    vi.mocked(api.saveCompany).mockReturnValueOnce(save.promise)
    await act(async () => edit(101))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    await act(async () => select("b"))
    await act(async () => save.resolve({ ok: false, conflict: true }))
    await act(async () => cloud.resolveConflict("cloud"))
    expect(current.companyName).toBe("B")
    expect(current.openingBalance).toBe(900)
    expect(cloud.conflict).toBeNull()
    expect(loadProfileData("b").openingBalance).toBe(900)
  })
  it("descarta una respuesta antigua incluso después de A → B → A", async () => {
    const remote = deferred<api.CloudSnapshot>()
    vi.mocked(api.fetchCompany).mockReturnValueOnce(remote.promise)
    await act(async () => { listeners.get("ca")!(11) })
    await act(async () => select("b"))
    await act(async () => select("a"))
    await act(async () => remote.resolve(snapshot(200)))
    expect(current.openingBalance).toBe(100)
    expect(cloud.link?.revision).toBe(10)
  })
  it("solo marca sincronizado el documento realmente enviado", async () => {
    const save = deferred<api.SaveResult>()
    vi.mocked(api.saveCompany).mockReturnValueOnce(save.promise)
    await act(async () => edit(1500))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    await act(async () => edit(1700))
    await act(async () => save.resolve({ ok: true, revision: 11 }))
    expect(current.openingBalance).toBe(1700)
    expect(cloud.link?.dirty).toBe(true)
    expect(cloud.status).toBe("pending")
  })
  it("no sube mientras el documento no está guardado localmente", async () => {
    await act(async () => persisted(false))
    await act(async () => edit(1500))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(api.saveCompany).not.toHaveBeenCalled()
    await act(async () => persisted(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(api.saveCompany).toHaveBeenCalledTimes(1)
    expect(cloud.status).toBe("synced")
  })
  it("adopta una reapertura autorizada aunque la proyección no incluya el archivo privado", async () => {
    // Una descarga confirmada también debe poder reemplazar una proyección local.
    const closed = { ...b, closedPeriods: [{ key: "2026-10-1",period: { year: 2026,month: 10,half: 1 as const },closedAt: "2026-10-16T12:00:00Z",summaries: [] }] }
    saveProfileData("b",closed)
    vi.mocked(api.listCompanies).mockResolvedValue([companies[0],{ ...companies[1],access: { ...access,role: "asistencia",readsAll: false,writesAll: false,managesMembers: false,sections: ["asistencia"] } }])
    await act(async () => cloud.refreshCompanies())
    await act(async () => select("b"))
    vi.mocked(api.fetchSection).mockResolvedValueOnce({ payload: { companyName: "B",employees: [],timeEntries: [],closedPeriods: [],version: b.version },revision: 11,updatedAt: "",updatedByEmail: "" })
    await act(async () => { listeners.get("cb")!(11) })
    expect(current.closedPeriods).toHaveLength(0)
    expect(cloud.status).toBe("synced")
    expect(loadProfileData("b").closedPeriods).toHaveLength(0)
    expect(api.fetchSection).toHaveBeenCalledWith("cb","asistencia")
  })
  it("si falla guardar el vínculo, conserva la edición y detiene las subidas", async () => {
    const original = localStorage.setItem.bind(localStorage)
    const spy = vi.spyOn(localStorage,"setItem").mockImplementation((key,value) => {
      if (key.startsWith("planilla_previous:planilla_cloud_links")) throw new Error("quota")
      original(key,value)
    })
    await act(async () => edit(1500))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(current.openingBalance).toBe(1500)
    expect(api.saveCompany).not.toHaveBeenCalled()
    expect(cloud.status).toBe("error")
    spy.mockRestore()
  })
})
