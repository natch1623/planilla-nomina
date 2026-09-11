import { beforeEach, describe, expect, it } from "vitest"
import { defaultData } from "../store"
import type { AppData } from "../types"
import {
  decideRemote,
  isFromNewerApp,
  onlyLocalFieldsChanged,
  profileForCompany,
  readLinks,
  withLocalFields,
  writeLinks,
} from "./sync"

function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    get length() {
      return store.size
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  return store
}

const base: AppData = { ...defaultData, companyName: "RyS" }

describe("onlyLocalFieldsChanged", () => {
  it("navegar de quincena o cambiar el tema no es un cambio de la empresa", () => {
    const next = { ...base, currentPeriod: { year: 2026, month: 1, half: 2 as const }, theme: "dark" as const }
    expect(onlyLocalFieldsChanged(base, next)).toBe(true)
  })

  it("cualquier otro campo sí cuenta", () => {
    expect(onlyLocalFieldsChanged(base, { ...base, employees: [] })).toBe(false)
    expect(onlyLocalFieldsChanged(base, { ...base, companyName: "Otra" })).toBe(false)
  })

  it("el mismo objeto no es un cambio", () => {
    expect(onlyLocalFieldsChanged(base, base)).toBe(true)
  })
})

describe("withLocalFields", () => {
  it("toma los datos de la nube pero conserva la quincena y el tema de quien mira", () => {
    const local = { ...base, currentPeriod: { year: 2026, month: 3, half: 1 as const }, theme: "dark" as const }
    const remote = {
      ...base,
      companyName: "RyS remota",
      currentPeriod: { year: 2025, month: 12, half: 2 as const },
      theme: "light" as const,
    }
    const out = withLocalFields(remote, local)
    expect(out.companyName).toBe("RyS remota")
    expect(out.currentPeriod).toEqual(local.currentPeriod)
    expect(out.theme).toBe("dark")
  })
})

describe("decideRemote", () => {
  it("ignora revisiones que ya se tienen", () => {
    expect(decideRemote({ revision: 5, dirty: false }, 5)).toBe("ignore")
    expect(decideRemote({ revision: 5, dirty: true }, 4)).toBe("ignore")
  })

  it("aplica sin preguntar si aquí no hay cambios pendientes", () => {
    expect(decideRemote({ revision: 5, dirty: false }, 6)).toBe("apply")
  })

  it("pregunta si hay versión nueva allá y cambios sin subir aquí", () => {
    expect(decideRemote({ revision: 5, dirty: true }, 6)).toBe("conflict")
  })
})

describe("isFromNewerApp", () => {
  it("detecta datos de una versión más nueva de la app", () => {
    expect(isFromNewerApp({ version: 11 }, 10)).toBe(true)
    expect(isFromNewerApp({ version: 10 }, 10)).toBe(false)
    expect(isFromNewerApp({ version: 9 }, 10)).toBe(false)
    expect(isFromNewerApp({}, 10)).toBe(false)
  })
})

describe("vínculos con la nube", () => {
  beforeEach(() => {
    installStorage()
  })

  it("se guardan y se leen", () => {
    writeLinks({ p1: { companyId: "c1", revision: 3, dirty: true } })
    expect(readLinks()).toEqual({ p1: { companyId: "c1", revision: 3, dirty: true } })
  })

  it("descarta entradas corruptas en vez de romper la app", () => {
    localStorage.setItem(
      "planilla_cloud_links",
      JSON.stringify({ ok: { companyId: "c1", revision: 2 }, malo: { revision: 1 }, nulo: null }),
    )
    expect(readLinks()).toEqual({ ok: { companyId: "c1", revision: 2, dirty: false } })
    localStorage.setItem("planilla_cloud_links", "{no es json")
    expect(readLinks()).toEqual({})
  })

  it("encuentra el perfil local de una empresa", () => {
    const links = { p1: { companyId: "c1", revision: 1, dirty: false } }
    expect(profileForCompany(links, "c1")).toBe("p1")
    expect(profileForCompany(links, "c2")).toBeNull()
  })
})
